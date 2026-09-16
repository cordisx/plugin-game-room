import { randomUUID } from 'node:crypto'
import { ApiError, requireThat } from '../errors.js'
import type { GameStore, SqlRow, SqlStatement, SqlValue } from '../store-contract.js'

export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}
export interface D1Session {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown>
}
export interface D1Binding extends D1Session {
  withSession(constraint: 'first-primary'): D1Session
}
const identities = new WeakMap<D1Binding, Promise<string>>()
const rowBudget = 1_900_000
function checkValues(values: SqlValue[]) {
  let bytes = 0
  for (const value of values) {
    if (typeof value === 'string') bytes += new TextEncoder().encode(value).byteLength
    else if (value instanceof Uint8Array) bytes += value.byteLength
    else bytes += 8
  }
  requireThat(bytes <= rowBudget, 'persistence_limit', 422)
}
interface Read {
  sql: string
  values: SqlValue[]
  rows: SqlRow[]
}
interface Write {
  sql: string
  values: SqlValue[]
  changes?: number
  code?: string
}
interface Unit {
  reads: Read[]
  writes: Write[]
}
const column = (name: string) => `"${name.replaceAll('"', '""')}"`

/** One store per request. Critical reads start on the primary; no isolate-local room mirror. */
export class D1Store implements GameStore {
  private unit?: Unit
  private queue: Promise<unknown> = Promise.resolve()
  private constructor(private readonly session: D1Session, readonly serverId: string) {}
  static async open(binding: D1Binding) {
    const session = binding.withSession('first-primary')
    let identity = identities.get(binding)
    if (!identity) {
      identity = session.batch([
        session.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)').bind('serverId', randomUUID()),
        session.prepare('SELECT value FROM meta WHERE key=?').bind('serverId'),
      ]).then(result => {
        const batches = result as { results: { value: string }[] }[]
        const value = batches[1]?.results[0]?.value
        if (!value) throw new Error('server_identity_missing')
        return value
      })
      identities.set(binding, identity)
      void identity.catch(() => identities.delete(binding))
    }
    const serverId = await identity
    return new D1Store(session, serverId)
  }
  id(kind: string) {
    return `${this.serverId}:${kind}:${randomUUID()}`
  }
  private readonly reads = new Map<string, Promise<SqlRow[]>>()
  private async read(sql: string, values: SqlValue[]) {
    const key = JSON.stringify([sql, values])
    let pending = this.reads.get(key)
    if (!pending) {
      const unit = this.unit
      pending = this.session.prepare(sql).bind(...values).all<SqlRow>().then(result => {
        unit?.reads.push({ sql, values, rows: result.results })
        return result.results
      })
      this.reads.set(key, pending)
      void pending.catch(() => this.reads.delete(key))
    }
    return structuredClone(await pending)
  }
  readonly db = {
    prepare: (sql: string): SqlStatement => ({
      get: async (...values) => (await this.read(sql, values))[0],
      all: async (...values) => this.read(sql, values),
      run: async (...values) => {
        checkValues(values)
        this.reads.clear()
        if (this.unit) {
          this.unit.writes.push({ sql, values })
          return
        }
        return this.session.prepare(sql).bind(...values).run()
      },
    }),
    exec: (_sql: string): never => {
      throw new Error('d1_schema_requires_migration')
    },
  }
  atomic<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      this.reads.clear()
      const unit: Unit = { reads: [], writes: [] }
      this.unit = unit
      try {
        const result = await fn()
        if (unit.writes.length) await this.commit(unit)
        return result
      } finally {
        this.unit = undefined
        this.reads.clear()
      }
    })
    this.queue = next.catch(() => {})
    return next
  }
  async requireChanges(sql: string, values: SqlValue[], changes: number, code: string) {
    if (!this.unit) throw new Error('change_requirement_outside_transaction')
    this.unit.writes.push({ sql, values, changes, code })
  }
  private async commit(unit: Unit) {
    const id = randomUUID()
    const batch: D1Statement[] = []
    // Re-evaluate precise read predicates inside the same SQLite transaction as every write.
    // CHECK throws; UPDATE affecting zero rows alone would not abort D1.batch.
    for (const read of unit.reads) {
      const query = read.sql.trim().replace(/;$/, '')
      const conditions = [`(SELECT COUNT(*) FROM (${query}))=?`]
      const bindings: SqlValue[] = [...read.values, read.rows.length]
      const grouped = new Map<string, { row: SqlRow; count: number }>()
      for (const row of read.rows) {
        const key = JSON.stringify(row)
        const item = grouped.get(key)
        if (item) item.count++
        else grouped.set(key, { row, count: 1 })
      }
      for (const { row, count } of grouped.values()) {
        const entries = Object.entries(row)
        conditions.push(
          `(SELECT COUNT(*) FROM (${query}) WHERE ${entries.map(([key]) => `${column(key)} IS ?`).join(' AND ')})=?`,
        )
        bindings.push(...read.values, ...entries.map(([, value]) => value), count)
      }
      batch.push(
        this.session.prepare(
          `INSERT INTO transaction_reads(id,valid) SELECT ?,CASE WHEN ${conditions.join(' AND ')} THEN 1 ELSE 0 END`,
        ).bind(id, ...bindings),
      )
    }
    for (const write of unit.writes) {
      batch.push(this.session.prepare(write.sql).bind(...write.values))
      if (write.changes !== undefined) {
        batch.push(
          this.session.prepare(
            'INSERT INTO transaction_writes(id,valid) SELECT ?,CASE WHEN changes()=? THEN 1 ELSE 0 END',
          ).bind(id, write.changes),
        )
      }
    }
    batch.push(this.session.prepare('DELETE FROM transaction_reads WHERE id=?').bind(id))
    batch.push(this.session.prepare('DELETE FROM transaction_writes WHERE id=?').bind(id))
    try {
      await this.session.batch(batch)
    } catch (error) {
      const message = String(error)
      if (message.includes('read_conflict')) throw new ApiError(409, 'version_conflict')
      if (message.includes('write_requirement')) {
        throw new ApiError(
          403,
          unit.writes.find(write => write.code)?.code ?? 'write_conflict',
        )
      }
      throw error
    }
  }
  close() {}
}
