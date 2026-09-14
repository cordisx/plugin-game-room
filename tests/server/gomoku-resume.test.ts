import test from 'node:test'
import assert from 'node:assert/strict'
import { resumedPosition, undoPackage } from '../../server/gomoku-resume.js'
import { harness } from './helpers.js'
await test('finished AI game resumes in the same room and match, rewinds a round, and rejects duplicate or unauthorized commands', async t => {
  let now = 1000000
  const h = await harness({ now: () => now })
  t.after(() => h.app.close())
  const meta = (await h.request('/v1/packages', h.alice.token, undoPackage)).body
  const created =
    (await h.request('/v1/rooms', h.alice.token, { packageHash: meta.hash, mode: 'score', botCount: 1 })).body
  const path = `/v1/rooms/${created.id}`
  let view = (await h.request(path + '/start', h.alice.token, {})).body
  assert.equal(view.status, 'playing', JSON.stringify(view))
  view = (await h.request(path + '/actions', h.alice.token, {
    expectedVersion: view.version,
    idempotencyKey: 'first-stone',
    action: { type: 'place', x: 7, y: 7 },
  })).body
  await h.app.engine.serial(() => h.app.engine.tick())
  view = (await h.request(path, h.alice.token)).body
  assert.equal(view.observation.moves, 2)
  // Simulate a legacy journal: old rules had no history array.
  const legacy = await h.app.engine.load(created.id)
  const position = structuredClone(legacy.state) as Record<string, unknown>
  delete position.history
  const rows = await h.app.store.db.prepare('SELECT body FROM events WHERE room_id=? ORDER BY version').all(
    created.id,
  ) as { body: string }[]
  assert.equal((resumedPosition({ ...legacy, state: position as never }, 0, rows) as Record<string, unknown>).moves, 0)
  assert.throws(() => resumedPosition({ ...legacy, state: position as never }, 0, []), /undo_history_unavailable/)
  now += 601000
  await h.app.engine.serial(() => h.app.engine.tick())
  view = (await h.request(path, h.alice.token)).body
  assert.equal(view.status, 'finished')
  const input = { expectedVersion: view.version }
  assert.equal((await h.request(path + '/undo-resume', h.bob.token, input)).status, 403)
  const resumed = await h.request(path + '/undo-resume', h.alice.token, input)
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body))
  assert.equal(resumed.body.id, view.id)
  assert.equal(resumed.body.matchId, view.matchId)
  assert.deepEqual(resumed.body.seats.map((s: { id: string }) => s.id), view.seats.map((s: { id: string }) => s.id))
  assert.equal(resumed.body.status, 'playing')
  assert.equal(resumed.body.observation.moves, 0)
  assert.equal(resumed.body.turn, 0)
  assert.equal(resumed.body.result, null)
  assert.equal((await h.request(path + '/undo-resume', h.alice.token, input)).status, 409)
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal((await h.request(path, h.alice.token)).body.status, 'playing')
  const replay = (await h.request(path + '/replay', h.alice.token)).body
  assert.equal(replay.events.at(-1).kind, 'undo_resumed')
})
