import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { game, harness } from './helpers.js'
await test('Gomoku undo traverses authenticated server turn checks and restores the previous round', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const pkg = game()
  pkg.rules = await readFile(new URL('../../games/gomoku/rules.js', import.meta.url), 'utf8')
  pkg.ui.render = "globalThis.render=()=>({version:1,root:{type:'text',text:'Gomoku'}})"
  const room = await h.room(pkg)
  assert.equal(room.status, 'playing', JSON.stringify(room))
  const path = `/v1/rooms/${room.id}`
  let version = room.version
  async function act(token: string, action: unknown) {
    const response = await h.request(path + '/actions', token, {
      expectedVersion: version,
      idempotencyKey: 'undo-' + version,
      action,
    })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    version = response.body.version
    return response.body
  }
  await act(h.alice.token, { type: 'place', x: 0, y: 0 })
  await act(h.bob.token, { type: 'place', x: 1, y: 0 })
  const pending = await act(h.alice.token, { type: 'request-undo' })
  assert.equal(pending.turn, 1)
  const restored = await act(h.bob.token, { type: 'approve-undo' })
  assert.equal(restored.turn, 0)
  assert.equal(restored.observation.moves, 0)
  assert(restored.observation.board.every((cell: unknown) => cell === null))
})
