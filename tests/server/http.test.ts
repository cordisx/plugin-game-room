import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { game, harness } from './helpers.js'
import { createGameServer } from '../../server/http.js'
test('two users play with seat-only views, version concurrency, idempotency and private replay', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const room = await h.room()
  const path = `/v1/rooms/${room.id}`
  assert.equal(room.status, 'playing')
  assert.deepEqual(room.observation, { hand: 'private-0', n: 0, legalActions: [{ type: 'move' }] })
  assert.equal((await h.request(path, h.stranger.token)).status, 403)
  assert.equal((await h.request(path + '/replay', h.stranger.token)).status, 403)
  assert.equal(
    (await h.request(path + '/actions', h.bob.token, {
      expectedVersion: room.version,
      idempotencyKey: 'wrong-seat',
      action: { type: 'move' },
    })).status,
    403,
  )
  assert.equal(
    (await h.request(path + '/actions', h.alice.token, {
      expectedVersion: room.version,
      idempotencyKey: 'bad',
      action: { type: 'invalid' },
    })).body.error.code,
    'invalid_action',
  )
  const input = { expectedVersion: room.version, idempotencyKey: 'move-a', action: { type: 'move' } }
  const [a, b] = await Promise.all([
    h.request(path + '/actions', h.alice.token, input),
    h.request(path + '/actions', h.alice.token, input),
  ])
  assert.equal(a.status, 200)
  assert.deepEqual(a.body, b.body)
  assert.equal(a.body.version, room.version + 1)
  assert.equal(
    (await h.request(path + '/actions', h.alice.token, { ...input, action: { type: 'other' } })).body.error.code,
    'idempotency_conflict',
  )
  assert.equal(
    (await h.request(path + '/actions', h.bob.token, {
      expectedVersion: room.version,
      idempotencyKey: 'stale',
      action: { type: 'move' },
    })).body.error.code,
    'version_conflict',
  )
  const end = await h.request(path + '/actions', h.bob.token, {
    expectedVersion: a.body.version,
    idempotencyKey: 'move-b',
    action: { type: 'move' },
  })
  assert.equal(end.body.status, 'finished')
  assert.deepEqual(end.body.result.winners, [1])
  const replay = await h.request(path + '/replay', h.alice.token)
  assert(!JSON.stringify(replay.body).includes('private-1'))
  assert(!JSON.stringify(replay.body).includes('seed'))
  assert(!JSON.stringify((await h.request('/v1/rooms')).body).includes('private-'))
  const next = await h.request(path + '/next-match', h.alice.token, {})
  assert.equal(next.body.status, 'waiting')
  assert.equal(next.body.id, room.id)
  assert.notEqual(next.body.matchId, room.matchId)
  assert.equal(next.body.handNo, 2)
  assert(next.body.seats.every((s: { ready: boolean }) => !s.ready))
})
test('sessions revoke, source namespaces, immutable package versions and non-executable scene source', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const hs = await h.request('/v1/handshake')
  assert(h.alice.account.id.startsWith(hs.body.serverId + ':account:'))
  const meta = await h.request('/v1/packages', h.alice.token, game())
  assert.equal(meta.status, 200)
  assert(!Object.hasOwn(meta.body, 'rules'))
  assert.equal((await h.request('/v1/packages', h.alice.token, game())).body.hash, meta.body.hash)
  const changed = game()
  changed.ui.render += '\n// changed'
  assert.equal((await h.request('/v1/packages', h.alice.token, changed)).body.error.code, 'immutable_version')
  const html = await fetch(h.url + meta.body.uiUrl)
  assert.match(html.headers.get('content-type')!, /application\/json/)
  assert.equal((await html.json()).format, 'scene-v1')
  assert.match(html.headers.get('content-disposition')!, /attachment/)
  assert.match(html.headers.get('cache-control')!, /immutable/)
  await h.request('/v1/session', h.alice.token, undefined, 'DELETE')
  assert.equal((await h.request('/v1/me', h.alice.token)).status, 401)
  assert.equal(
    (await h.request('/v1/sessions', undefined, { name: 'alice', password: 'incorrect-password' })).status,
    401,
  )
})
test('durable room, sessions, randomness and timeout recover after process restart', async t => {
  let now = 1000000
  const dir = mkdtempSync(join(tmpdir(), 'game-room-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const database = join(dir, 'state.sqlite')
  const h = await harness({ database, now: () => now })
  const room = await h.room(game(), { turnTimeoutMs: 1000 })
  const serverId = h.app.store.serverId
  const original = h.app.engine.load(room.id)
  await h.app.close()
  now += 1001
  const restarted = createGameServer({ database, now: () => now, tickMs: 0 })
  t.after(() => restarted.close())
  assert.equal(restarted.store.serverId, serverId)
  assert.equal(restarted.accounts.authenticate(h.alice.token).id, h.alice.account.id)
  assert.equal(restarted.engine.load(room.id).seed, original.seed)
  assert.equal(restarted.engine.load(room.id).cursor, 1)
  await restarted.engine.serial(() => restarted.engine.tick())
  const ended = restarted.engine.view(restarted.engine.load(room.id), h.alice.account.id)
  assert.equal(ended.status, 'finished')
  assert.deepEqual(ended.result?.winners, [1])
})
test('waiting seats may leave and history is authenticated; no token pretending without economy', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const meta = (await h.request('/v1/packages', h.alice.token, game())).body
  const token = await h.request('/v1/rooms', h.alice.token, { packageHash: meta.hash, mode: 'token', stake: 5 })
  assert.equal(token.status, 503)
  assert.equal(token.body.error.code, 'economy_unavailable')
  const r = (await h.request('/v1/rooms', h.alice.token, { packageHash: meta.hash, mode: 'score' })).body
  assert.equal((await h.request('/v1/me/rooms', h.alice.token)).body.rooms.length, 1)
  assert.deepEqual((await h.request(`/v1/rooms/${r.id}/leave`, h.alice.token, {})).body, { left: true })
  assert.equal((await h.request(`/v1/rooms/${r.id}`, h.alice.token)).status, 403)
})
test('Agent grant isolates seat, enforces action budget, survives exact retries and revokes itself', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const room = await h.room()
  const path = `/v1/rooms/${room.id}`
  assert.equal(
    (await h.request(path + '/agent-grants', h.bob.token, {
      seatId: room.selfSeatId,
      expiresAt: Date.now() + 60000,
      maxActions: 1,
    })).status,
    403,
  )
  const grant = (await h.request(path + '/agent-grants', h.alice.token, {
    seatId: room.selfSeatId,
    expiresAt: Date.now() + 60000,
    maxActions: 1,
  })).body
  assert.equal((await h.request('/v1/me', grant.token)).status, 401)
  assert.equal((await h.request('/v1/agent/observation', h.alice.token)).status, 401)
  assert.equal((await h.request('/v1/agent/observation', grant.token)).body.selfSeatId, room.selfSeatId)
  const input = { expectedVersion: room.version, idempotencyKey: 'agent-1', action: { type: 'move' } }
  const move = await h.request('/v1/agent/actions', grant.token, input)
  assert.equal(move.status, 200)
  assert.deepEqual((await h.request('/v1/agent/actions', grant.token, input)).body, move.body)
  assert.equal(
    (h.app.store.db.prepare('SELECT used FROM grants WHERE id=?').get(grant.grantId) as { used: number }).used,
    1,
  )
  await h.request('/v1/agent/revoke', grant.token, {})
  assert.equal((await h.request('/v1/agent/observation', grant.token)).body.error.code, 'grant_revoked')
  assert.equal((await h.request('/v1/agent/revoke', grant.token, {})).status, 200)
})
