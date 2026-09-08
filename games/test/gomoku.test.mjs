import assert from 'node:assert/strict'
import test from 'node:test'
import { context, invoke, source } from './runtime.mjs'
const rules = await source('gomoku')
const ctx = context()
const run = (method, args, seatIndex = null) => invoke(rules, method, args, { ...ctx, seatIndex })
test('complete Gomoku game across fresh runtimes and both seat views', async () => {
  let { value: t } = await run('setup', [])
  for (let i = 0; i < 9; i++) {
    const seat = i % 2
    t = (await run('act', [t.state, { type: 'place', x: Math.floor(i / 2), y: seat }], seat)).value
    for (const self of [0, 1]) {
      const view = (await run('observe', [t.state, self])).value
      assert.equal(view.selfSeat, self)
      assert.equal(view.moves, i + 1)
      assert.deepEqual(view.board, t.state.board)
    }
  }
  assert.equal(t.turn, null)
  assert.deepEqual(t.done, { winners: [0], scores: [1, 0] })
  await assert.rejects(run('act', [t.state, { type: 'place', x: 10, y: 10 }], 1), /invalid_action/)
})
test('turn, coordinate and occupied-position validation; timeout loses', async () => {
  let t = (await run('setup', [])).value
  const legal = { type: 'place', x: 7, y: 7 }
  await assert.rejects(run('act', [t.state, legal], 1), /invalid_action/)
  for (const action of [null, {}, { ...legal, x: -1 }, { ...legal, y: 15 }, { ...legal, x: 0.5 }]) {
    await assert.rejects(run('act', [t.state, action], 0), /invalid_action/)
  }
  t = (await run('act', [t.state, legal], 0)).value
  await assert.rejects(run('act', [t.state, legal], 1), /invalid_action/)
  assert.deepEqual((await run('timeout', [t.state], 1)).value.done.winners, [0])
})
test('vertical and both diagonal wins', async () => {
  for (const [dx, dy] of [[0, 1], [1, 1], [1, -1]]) {
    let t = (await run('setup', [])).value
    for (let n = 0; n < 5; n++) {
      t = (await run('act', [t.state, { type: 'place', x: 7 + n * dx, y: 7 + n * dy }], 0)).value
      if (n < 4) t = (await run('act', [t.state, { type: 'place', x: n, y: 0 }], 1)).value
    }
    assert.deepEqual(t.done.winners, [0])
  }
})
