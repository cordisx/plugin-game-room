import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { game, harness } from './helpers.js'
import type { GamePackage } from '../../sdk/index.js'
function builtin(name: string): GamePackage {
  const root = new URL(`../../games/${name}/`, import.meta.url)
  return {
    packageVersion: 1,
    manifest: JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')),
    bot: { format: 'rules-bot-v1', source: readFileSync(new URL('bot.js', root), 'utf8') },
    rules: readFileSync(new URL('rules.js', root), 'utf8'),
    ui: { format: 'scene-v1', render: readFileSync(new URL('render.js', root), 'utf8') },
  }
}
for (const name of ['gomoku', 'holdem']) {
  await test(`${name} public spectating is read-only and excludes private state`, async (t) => {
    const h = await harness()
    t.after(async () => await h.app.close())
    const room = await h.room(builtin(name))
    const before = await h.app.engine.load(room.id)
    const response = await h.request(`/v1/rooms/${room.id}/spectate`)
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const view = response.body
    assert.equal(view.observation.selfSeat, null)
    assert.deepEqual(
      view.participants.map((p: {
        seatIndex: number
        isOwner: boolean
      }) => [p.seatIndex, p.isOwner]),
      [[
        0,
        true,
      ], [1, false]],
    )
    assert(view.participants.every((p: object) => !Object.hasOwn(p, 'accountId') && !Object.hasOwn(p, 'participantId')))
    assert.deepEqual(view.observation.legalActions, [])
    assert.equal(view.scene.version, 1)
    assert(!Object.hasOwn(view, 'seed'))
    assert(!Object.hasOwn(view, 'state'))
    assert(!Object.hasOwn(view, 'observations'))
    if (name === 'holdem') {
      assert(view.observation.players.every((player: {
        hole: unknown[]
      }) => player.hole.every(card => card === null)))
      assert.equal(view.observation.deck, undefined)
    } else {
      assert.equal(view.observation.board.length, 225)
    }
    assert.deepEqual(await h.app.engine.load(room.id), before)
    if (name === 'holdem') {
      let current = room
      for (let step = 0; step < 3 && current.status === 'playing'; step++) {
        const actor = current.turn === 0 ? h.alice.token : h.bob.token
        const response = await h.request(`/v1/rooms/${room.id}/actions`, actor, {
          expectedVersion: current.version,
          idempotencyKey: `spectator-runout-${step}`,
          action: { type: 'fold' },
        })
        assert.equal(response.status, 200, JSON.stringify(response.body))
        current = response.body
      }
      assert.equal(current.status, 'finished')
      const ended = (await h.request(`/v1/rooms/${room.id}/spectate`)).body
      assert.equal(ended.status, 'finished')
      assert.equal(ended.scene.version, 1)
      assert(ended.observation.players.every((player: {
        hole: unknown[]
      }) => player.hole.every(card => card === null)))
    }
    assert.equal(
      (await h.request(`/v1/rooms/${room.id}/actions`, undefined, {
        expectedVersion: room.version,
        idempotencyKey: 'spectator',
        action: { type: 'place', x: 0, y: 0 },
      })).status,
      401,
    )
    assert.equal((await h.request(`/v1/rooms/${room.id}`, h.stranger.token)).status, 403)
  })
}
await test('spectating is opt-in per immutable package and respects login-required servers', async (t) => {
  const h = await harness({ requireLogin: true })
  t.after(async () => await h.app.close())
  const room = await h.room(game())
  assert.equal((await h.request(`/v1/rooms/${room.id}/spectate`)).status, 401)
  assert.equal((await h.request(`/v1/rooms/${room.id}/spectate`, h.alice.token)).status, 409)
})
await test('public participant ownership follows actual owner transfer in a waiting room', async (t) => {
  const h = await harness()
  t.after(async () => await h.app.close())
  const meta = (await h.request('/v1/packages', h.alice.token, builtin('gomoku'))).body
  const room = (await h.request('/v1/rooms', h.alice.token, { packageHash: meta.hash, mode: 'score' })).body
  await h.request(`/v1/rooms/${room.id}/join`, h.bob.token, {})
  const before = (await h.request(`/v1/rooms/${room.id}/spectate`)).body
  assert.deepEqual(
    before.participants.map((p: {
      name: string
      isOwner: boolean
    }) => [p.name, p.isOwner]),
    [[
      'alice',
      true,
    ], ['bobby', false]],
  )
  await h.request(`/v1/rooms/${room.id}/leave`, h.alice.token, {})
  const after = (await h.request(`/v1/rooms/${room.id}/spectate`)).body
  assert.deepEqual(after.participants, [{ seatIndex: 1, name: 'bobby', kind: 'human', isOwner: true }])
})
