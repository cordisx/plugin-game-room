import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers.js'
await test('authenticated display profile changes existing seat projection without changing room or login identity', async (t) => {
  const h = await harness()
  t.after(async () => await h.app.close())
  const room = await h.room()
  const before = await h.app.store.db.prepare('SELECT body FROM rooms WHERE id=?').get(room.id)
  const input = {
    subject: 'plugin-scoped-local-user-a',
    displayName: '很长的中文玩家名字 GH L VeryLongEnglishNickname',
  }
  assert.equal((await h.request('/v1/me/profile', undefined, input)).status, 401)
  const updated = await h.request('/v1/me/profile', h.alice.token, input)
  assert.equal(updated.status, 200)
  const me = (await h.request('/v1/me', h.alice.token)).body.account
  assert.equal(me.name, 'alice')
  assert.equal(me.id, h.alice.account.id)
  assert.equal(me.displayName, input.displayName)
  assert(!JSON.stringify(me).includes(input.subject))
  const view = (await h.request(`/v1/rooms/${room.id}`, h.alice.token)).body
  assert.equal(view.seats[0].name, input.displayName)
  assert.equal(view.seats[0].id, room.seats[0].id)
  assert.equal(view.seats[0].seatIndex, room.seats[0].seatIndex)
  assert.equal(view.version, room.version)
  assert.deepEqual(await h.app.store.db.prepare('SELECT body FROM rooms WHERE id=?').get(room.id), before)
  assert.equal((await h.request('/v1/me/profile', h.alice.token, { ...input, subject: 'other-user' })).status, 409)
  assert.equal((await h.request('/v1/me/profile', h.alice.token, { ...input, token: 'not-allowed' })).status, 400)
  assert.equal(
    (await h.request('/v1/me/profile', h.alice.token, { ...input, avatar: 'https://example.com/avatar.png' })).status,
    400,
  )
  assert.equal((await h.request('/v1/me/profile', h.bob.token, { ...input, displayName: 'Other player' })).status, 200)
  assert.equal((await h.request('/v1/me', h.alice.token)).body.account.displayName, input.displayName)
})
