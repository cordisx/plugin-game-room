import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGameServer } from '../../server/http.js'
import { game, harness } from './helpers.js'
await test('a durable valid guest token restores the same owner through public HTTP after server restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'guest-session-'))
  const database = join(directory, 'fixture.sqlite')
  const h = await harness({ database })
  let closed = false
  t.after(async () => {
    if (!closed) {
      await h.app.close()
    }
    rmSync(directory, { recursive: true, force: true })
  })
  const guest = (await h.request('/v1/guests', undefined, {})).body
  const packageHash = (await h.request('/v1/packages', h.alice.token, game())).body.hash
  const created = await h.request('/v1/rooms', guest.token, { packageHash, mode: 'score' })
  assert.equal(created.status, 200)
  const path = `/v1/rooms/${created.body.id}`
  const original = await h.app.engine.load(created.body.id)
  assert.equal(original.creatorAccountId, guest.account.id)
  await h.request(path + '/join', h.bob.token, {})
  await h.request(path + '/ready', h.bob.token, { ready: true })
  await h.app.close()
  closed = true
  const restored = createGameServer({ database, tickMs: 0 })
  try {
    await new Promise<void>(resolve => restored.server.listen(0, '127.0.0.1', resolve))
    const address = restored.server.address() as {
      port: number
    }
    const request = async (route: string, token: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { status: response.status, body: await response.json() }
    }
    const me = await request('/v1/me', guest.token)
    assert.equal(me.status, 200)
    assert.equal(me.body.account.id, guest.account.id)
    assert.equal(me.body.account.guest, true)
    assert.equal((await restored.engine.load(original.id)).creatorAccountId, original.creatorAccountId)
    const mine = await request('/v1/me/rooms', guest.token)
    assert.equal(mine.body.rooms[0].id, original.id)
    const seat = await request(path, guest.token)
    assert.equal(seat.body.selfSeatId, created.body.selfSeatId)
    assert.equal((await request(path + '/ready', guest.token, { ready: true })).status, 200)
    const started = await request(path + '/start', guest.token, {})
    assert.equal(started.status, 200)
    assert.equal(started.body.status, 'playing')
    assert.equal((await restored.engine.all()).length, 1)
  } finally {
    await restored.close()
  }
})
await test('guest expiry and explicit logout reject the original token without minting an identity or changing ownership', async (t) => {
  let now = 1000000
  const h = await harness({ now: () => now })
  t.after(async () => await h.app.close())
  const guest = (await h.request('/v1/guests', undefined, {})).body
  const packageHash = (await h.request('/v1/packages', h.alice.token, game())).body.hash
  const room = (await h.request('/v1/rooms', guest.token, { packageHash, mode: 'score' })).body
  const owner = (await h.app.engine.load(room.id)).creatorAccountId
  const count = async () =>
    (await h.app.store.db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as {
      count: number
    }).count
  const accounts = await count()
  now += 30 * 86400000
  const expired = await h.request('/v1/me', guest.token)
  assert.equal(expired.status, 401)
  assert.equal(expired.body.error.code, 'invalid_session')
  assert.equal((await h.request(`/v1/rooms/${room.id}/start`, guest.account.id, {})).status, 401)
  assert.equal(await count(), accounts)
  assert.equal((await h.app.engine.load(room.id)).creatorAccountId, owner)
  const fresh = (await h.request('/v1/guests', undefined, {})).body
  assert.equal((await h.request('/v1/session', fresh.token, undefined, 'DELETE')).status, 200)
  assert.equal((await h.request('/v1/me', fresh.token)).status, 401)
  assert.equal((await h.request(`/v1/rooms/${room.id}/ready`, fresh.token, { ready: true })).status, 401)
  assert.equal((await h.app.engine.load(room.id)).creatorAccountId, owner)
})
