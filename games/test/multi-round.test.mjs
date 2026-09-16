import assert from 'node:assert/strict'
import test from 'node:test'
import { context, invoke, source } from './runtime.mjs'

test('Holdem keeps stacks, rotates dealer and ends only after configured hands', async () => {
  const rules = await source('holdem'), ctx = context(3, { config: { rounds: 3 } })
  let cursor = 0
  const call = async (method, args, seatIndex = null) => {
    const out = await invoke(rules, method, args, { ...ctx, seatIndex }, 'rounds', cursor)
    cursor = out.cursor
    return out.value
  }
  let t = await call('setup', [])
  for (let hand = 1; hand <= 3; hand++) {
    const button = t.state.button
    while (!t.done && !t.state.betweenHands) {
      t = await call('act', [t.state, { type: 'fold' }], t.turn)
    }
    assert.equal(t.state.handNo, hand)
    assert.equal(t.state.players.reduce((n, p) => n + p.stack, 0), 3000)
    if (hand === 3) {
      assert(t.done)
      break
    }
    assert(!t.done)
    const stacks = t.state.players.map(p => p.stack)
    t = await call('act', [t.state, { type: 'next-hand' }], t.turn)
    assert.equal(t.state.button, (button + 1) % 3)
    assert.deepEqual(t.state.players.map(p => p.stack + p.total), stacks)
    assert.equal(t.state.board.length, 0)
    assert.equal(new Set(t.state.players.flatMap(p => p.hole)).size, 6)
  }
})

test('Holdem exit mid-hand waits for settlement, then never admits the departed seat again', async () => {
  const rules = await source('holdem'), ctx = context(3, { config: { rounds: 3 } })
  const call = async (method, args, seatIndex = null) =>
    (await invoke(rules, method, args, { ...ctx, seatIndex })).value
  let t = await call('setup', [])
  const departed = t.turn
  t = await call('exit', [t.state], departed)
  assert.equal(t.cashouts[departed], null)
  while (!t.state.betweenHands && !t.done) {
    const view = await call('observe', [t.state, t.turn])
    const type = view.legalActions.some(a => a.type === 'call') ? 'call' : 'check'
    t = await call('act', [t.state, { type }], t.turn)
  }
  assert.equal(t.cashouts[departed], t.state.players[departed].withdrawn)
  const paid = t.cashouts[departed]
  t = await call('act', [t.state, { type: 'next-hand' }], t.turn)
  assert.equal(t.cashouts[departed], paid)
  assert.deepEqual(t.state.players[departed].hole, [])
  assert.equal(t.state.players[departed].total, 0)
  assert.deepEqual((await call('observe', [t.state, departed])).legalActions, [])
  assert.equal(
    t.state.players.reduce((n, p) => n + p.stack + p.total + (p.withdrawn ?? 0), 0),
    3000,
  )
})

test('Gomoku retains round result, alternates opening seat and settles the series once', async () => {
  const rules = await source('gomoku'), ctx = context(2, { config: { rounds: 3 } })
  const call = async (method, args, seatIndex = null) =>
    (await invoke(rules, method, args, { ...ctx, seatIndex })).value
  let t = await call('setup', [])
  for (let round = 1; round <= 3; round++) {
    assert.equal(t.turn, (round - 1) % 2)
    t = await call('timeout', [t.state], t.turn)
    if (round < 3) {
      assert(!t.done)
      const view = await call('observe', [t.state, t.turn])
      assert(view.result)
      assert.equal(view.canUndo, false)
      assert.deepEqual(view.legalActions, [{ type: 'next-round' }])
      t = await call('act', [t.state, { type: 'next-round' }], t.turn)
      assert.equal(t.state.moves, 0)
      assert.equal(t.state.board.filter(x => x !== null).length, 0)
    }
  }
  assert.deepEqual(t.done, { winners: [1], scores: [1, 2] })
})
