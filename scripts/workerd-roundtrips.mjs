import { applyWorkersMigrations } from './apply-workers-migrations.mjs'
import { Miniflare } from 'miniflare'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { D1Store } from '../dist/server/workers/d1-store.js'
const mf = new Miniflare({
  modules: true,
  script: 'export default {fetch(){return new Response("ok")}}',
  compatibilityDate: '2026-07-30',
  d1Databases: ['DB'],
})
try {
  const db = await mf.getD1Database('DB')
  await applyWorkersMigrations(db)
  const counts = { sessions: 0, batches: 0, reads: 0 }
  const tracked = {}
  tracked.withSession = constraint => {
    assert.equal(constraint, 'first-primary')
    counts.sessions++
    const session = db.withSession(constraint)
    return {
      batch(statements) {
        counts.batches++
        return session.batch(statements.map(statement => statement.raw))
      },
      prepare(sql) {
        const wrap = raw => ({
          raw,
          bind(...values) {
            return wrap(raw.bind(...values))
          },
          all(...args) {
            counts.reads++
            return raw.all(...args)
          },
          first(...args) {
            counts.reads++
            return raw.first(...args)
          },
          run(...args) {
            return raw.run(...args)
          },
        })
        return wrap(session.prepare(sql))
      },
    }
  }
  const a = await D1Store.open(tracked), b = await D1Store.open(tracked)
  assert.equal(a.serverId, b.serverId)
  assert.equal(counts.sessions, 2)
  assert.equal(counts.batches, 1, 'cold init one batch; warm identity zero queries')
  await db.prepare('INSERT INTO rooms VALUES (?,?)').bind('perf', '1').run()
  const sql = 'SELECT body FROM rooms WHERE id=?'
  const before = counts.reads
  const first = await Promise.all([a.db.prepare(sql).get('perf'), a.db.prepare(sql).get('perf')])
  assert.deepEqual(first, [{ body: '1' }, { body: '1' }])
  assert.equal(counts.reads - before, 1, 'concurrent duplicate reads use one D1 roundtrip')
  await a.db.prepare('UPDATE rooms SET body=? WHERE id=?').run('2', 'perf')
  assert.deepEqual(await a.db.prepare(sql).get('perf'), { body: '2' })
  await db.prepare('UPDATE rooms SET body=? WHERE id=?').bind('3', 'perf').run()
  await a.atomic(async () => {
    assert.deepEqual(
      await a.db.prepare(sql).get('perf'),
      { body: '3' },
      'atomic preconditions read fresh despite prior request cache',
    )
    await a.db.prepare('UPDATE rooms SET body=? WHERE id=?').run('4', 'perf')
  })
  assert.deepEqual(await b.db.prepare(sql).get('perf'), { body: '4' }, 'another request owns independent reads')
  console.log(
    'PASS actual D1: cold identity1 batch/warm0, duplicate reads1, write invalidation, fresh atomic guards, request isolation',
  )
} finally {
  await mf.dispose()
}
