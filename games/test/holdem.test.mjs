import assert from 'node:assert/strict'
import test from 'node:test'
import { context, invoke, source } from './runtime.mjs'
const rules = await source('holdem')
const ctx = context(3, { policy: 'conserved-payouts-v1' })
const run = (method, args, seatIndex = null, options = ctx, seed = 'fixture') =>
  invoke(rules, method, args, { ...options, seatIndex }, seed)
const act = async (t, action) => (await run('act', [t.state, action], t.turn)).value
const observe = async (t, seat = t.turn) => (await run('observe', [t.state, seat])).value
function conservation(t) {
  const chips = t.state.players.reduce((total, p) => total + p.stack + (t.done ? 0 : p.total), 0)
  assert.equal(chips, t.state.initialStack * t.state.players.length)
}
function fixture(stacks, bets, total = bets) {
  return {
    players: stacks.map((stack, i) => ({
      stack,
      bet: bets[i],
      total: total[i],
      hole: [i * 2, i * 2 + 1],
      folded: false,
      actedAt: null,
    })),
    initialStack: (stacks.reduce((a, b) => a + b, 0) + total.reduce((a, b) => a + b, 0))
      / stacks.length,
    bigBlind: 20,
    smallBlind: 10,
    button: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    deck: Array.from({ length: 40 }, (_, i) => i + 12),
    burns: [],
    board: [],
    street: 'preflop',
    currentBet: Math.max(...bets),
    lastFullRaise: 20,
    pending: stacks.map(s => s > 0),
    turn: 0,
    result: null,
    showdown: false,
    pots: [],
    lastAction: null,
  }
}
test('seeded shuffle is reproducible, distinct, and never leaks deck or opponent cards', async () => {
  const a = (await run('setup', [])).value
  const b = (await run('setup', [])).value
  const c = (await run('setup', [], null, ctx, 'different')).value
  assert.deepEqual(a, b)
  assert.notDeepEqual(a.state.players.map(p => p.hole), c.state.players.map(p => p.hole))
  assert.equal(new Set([...a.state.deck, ...a.state.players.flatMap(p => p.hole)]).size, 52)
  for (let i = 0; i < 3; i++) {
    const view = await observe(a, i)
    assert.equal(view.deck, undefined)
    assert.equal(view.burns, undefined)
    for (let j = 0; j < 3; j++) {
      assert.deepEqual(view.players[j].hole, i === j ? a.state.players[j].hole : [null, null])
    }
  }
})
test('heads-up button is small blind and acts first preflop, last postflop', async () => {
  const c = context(2)
  let t = (await run('setup', [], null, c)).value
  assert.equal(t.state.smallBlindSeat, t.state.button)
  assert.equal(t.turn, t.state.button)
  t = await act(t, { type: 'call' })
  assert.equal(t.turn, t.state.bigBlindSeat)
  t = await act(t, { type: 'check' })
  assert.equal(t.state.street, 'flop')
  assert.equal(t.turn, t.state.bigBlindSeat)
})
test('minimum raises, illegal calls/checks, out of turn and chip conservation', async () => {
  let t = (await run('setup', [])).value
  await assert.rejects(run('act', [t.state, { type: 'call' }], (t.turn + 1) % 3), /invalid_action/)
  await assert.rejects(act(t, { type: 'check' }), /invalid_action/)
  for (const to of [21, 39, 40.5, 1001, '40']) {
    await assert.rejects(act(t, { type: 'raise', to }), /invalid_action/)
  }
  t = await act(t, { type: 'raise', to: 60 })
  conservation(t)
  assert.equal((await observe(t)).legalActions.find(a => a.type === 'raise').minTo, 100)
  t = await act(t, { type: 'call' })
  conservation(t)
  t = await act(t, { type: 'call' })
  conservation(t)
  assert.equal(t.state.street, 'flop')
  assert.equal((await observe(t)).legalActions.find(a => a.type === 'call'), undefined)
})
test('short all-in does not reopen, cumulative full raise does reopen', async () => {
  let state = fixture([400, 30, 400], [100, 100, 100])
  state.currentBet = 100
  state.lastFullRaise = 100
  state.turn = 1
  state.players[0].actedAt = 100
  state.players[2].actedAt = 100
  let t = await act({ state, turn: 1 }, { type: 'all-in' })
  assert.equal(t.state.currentBet, 130)
  assert.equal(t.state.lastFullRaise, 100)
  assert.equal(
    (await observe(t)).legalActions.some(a => a.type === 'raise' || a.type === 'all-in'),
    false,
  )
  await assert.rejects(act(t, { type: 'raise', to: 230 }), /invalid_action/)
  state = fixture([400, 50, 100, 400], [100, 100, 100, 100])
  state.currentBet = 100
  state.lastFullRaise = 100
  state.turn = 1
  state.players[0].actedAt = 100
  state.pending[0] = false
  t = await act({ state, turn: 1 }, { type: 'all-in' })
  t = await act(t, { type: 'all-in' })
  t = await act(t, { type: 'call' })
  assert.equal(t.turn, 0)
  assert.equal((await observe(t)).legalActions.find(a => a.type === 'raise').minTo, 300)
})
test('all-in runout, side pots and uncalled wager return conserve chips', async () => {
  const state = fixture([0, 0, 150], [50, 100, 150])
  state.turn = 2
  state.currentBet = 150
  // No outstanding call: completing this player's check closes action and runs board.
  const t = await act({ state, turn: 2 }, { type: 'check' })
  assert.equal(t.turn, null)
  assert.equal(t.state.board.length, 5)
  assert.deepEqual(t.state.pots.map(p => p.amount), [150, 100, 50])
  assert.equal(t.state.pots[2].refund, true)
  assert.deepEqual(t.state.pots[1].eligible, [1, 2])
  conservation(t)
})
test('board tie splits pot, odd chip goes clockwise left of button; folded hands stay hidden', async () => {
  const state = fixture([98, 98, 98], [2, 2, 2], [2, 2, 2])
  state.players[2].folded = true
  state.players[2].total = 1
  state.players[2].stack = 99
  state.board = [8, 9, 10, 11, 12] // Royal flush on board.
  state.street = 'river'
  state.turn = 0
  state.pending = [true, false, false]
  const t = await act({ state, turn: 0 }, { type: 'check' })
  assert.deepEqual(t.done.payouts, [100, 101, 99])
  conservation(t)
  const view = await observe(t, 0)
  assert.deepEqual(view.players[2].hole, [null, null])
  assert.deepEqual(view.players[1].hole, state.players[1].hole)
})
test('timeout checks when free, otherwise folds; uncontested winner never reveals other hands', async () => {
  let t = (await run('setup', [], null, context(2))).value
  t = (await run('timeout', [t.state], t.turn)).value
  assert.equal(t.turn, null)
  conservation(t)
  const view = await observe(t, 0)
  assert.deepEqual(view.players[1].hole, [null, null])
  t = (await run('setup', [])).value
  while (t.state.street === 'preflop') {
    const actions = (await observe(t)).legalActions
    t = await act(t, { type: actions.some(a => a.type === 'call') ? 'call' : 'check' })
  }
  const timed = t.turn
  t = (await run('timeout', [t.state], timed)).value
  assert.equal(t.state.players[timed].folded, false)
})
test('token stack derives only from platform stake and requires conserved policy', async () => {
  const c = context(2, {
    mode: 'token',
    stake: 500,
    policy: 'conserved-payouts-v1',
    config: { initialStack: 999999 },
  })
  assert.equal((await run('setup', [], null, c)).value.state.initialStack, 500)
  await assert.rejects(
    run('setup', [], null, { ...c, policy: 'equal-winners-v1' }),
    /invalid_config/,
  )
})
test('60 complete seeded hands with mixed legal actions conserve every transition', async () => {
  for (let n = 0; n < 60; n++) {
    let t = (await run('setup', [], null, context(2 + n % 7), `hand-${n}`)).value
    let steps = 0
    while (!t.done) {
      const options = (await observe(t)).legalActions
      const option = options[(n * 7 + steps * 3) % options.length]
      t = await act(
        t,
        option.type === 'raise' ? { type: 'raise', to: option.minTo } : { type: option.type },
      )
      conservation(t)
      assert.ok(++steps < 200)
    }
    assert.equal(t.done.payouts.length, 2 + n % 7)
  }
})
