import test from 'node:test'
import assert from 'node:assert/strict'
import { game, harness } from './helpers.js'

await test('only the owner can close a room, and closing is durable and idempotent', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const pkg = (await h.request('/v1/packages', h.alice.token, game())).body
  const room = (await h.request('/v1/rooms', h.alice.token, { packageHash: pkg.hash, mode: 'score' })).body
  const path = `/v1/rooms/${room.id}`
  await h.request(path + '/join', h.bob.token, {})
  assert.equal((await h.request(path + '/close', h.bob.token, {})).status, 403)
  assert.equal((await h.request(path + '/close', h.stranger.token, {})).status, 403)
  assert.equal((await h.request(path + '/close', h.alice.token, {})).status, 200)
  const closed = (await h.request(path, h.bob.token)).body
  assert.equal(closed.status, 'aborted')
  assert.equal(typeof closed.closedAt, 'number')
  assert.equal((await h.request(path + '/close', h.alice.token, {})).status, 200)
  assert.equal((await h.request(path, h.alice.token)).body.version, closed.version)
  for (const op of ['join', 'ready', 'start', 'next-match']) {
    const response = await h.request(path + '/' + op, h.alice.token, { ready: true })
    assert.equal(response.status, 409, op)
    assert.equal(response.body.error.code, 'room_closed', op)
  }
  assert.equal((await h.request('/v1/rooms')).body.rooms.some((r: { id: string }) => r.id === room.id), false)
  assert.equal(
    (await h.request('/v1/me/rooms', h.bob.token)).body.rooms.some((r: { id: string }) => r.id === room.id),
    true,
  )
})

await test('closing a playing score room stops actions for every player', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const room = await h.room()
  const path = `/v1/rooms/${room.id}`
  assert.equal((await h.request(path + '/close', h.alice.token, {})).status, 200)
  const response = await h.request(path + '/actions', h.alice.token, {
    expectedVersion: room.version,
    idempotencyKey: 'closed-action',
    action: { type: 'move' },
  })
  assert.equal(response.status, 409)
  assert.equal(response.body.error.code, 'room_closed')
})
