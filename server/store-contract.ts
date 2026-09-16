export type SqlValue = string | number | bigint | null | Uint8Array
export type SqlRow = Record<string, SqlValue>
export interface SqlStatement {
  get(...values: SqlValue[]): SqlRow | undefined | Promise<SqlRow | undefined>
  all(...values: SqlValue[]): SqlRow[] | Promise<SqlRow[]>
  run(...values: SqlValue[]): unknown | Promise<unknown>
}
export interface GameStore {
  readonly serverId: string
  readonly db: { prepare(sql: string): SqlStatement; exec(sql: string): unknown }
  id(kind: string): string
  atomic<T>(fn: () => T | Promise<T>): T | Promise<T>
  requireChanges(sql: string, values: SqlValue[], changes: number, code: string): void | Promise<void>
  close(): void | Promise<void>
}
