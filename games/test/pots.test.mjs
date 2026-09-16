import assert from 'node:assert/strict'
import test from 'node:test'
import { context, invoke, source } from './runtime.mjs'
const rules = await source('holdem')
const card = text => 'shdc'.indexOf(text[1]) * 13 + '23456789TJQKA'.indexOf(text[0])
const cards = text => text.split(' ').map(card)
test('short stack wins main pot, second stack wins side pot, unmatched deep-stack bet returns', async () => {
  const players = [
    { stack: 0, bet: 50, total: 50, hole: cards('As Ah'), folded: false, actedAt: 50 },
    { stack: 0, bet: 100, total: 100, hole: cards('Ks Kh'), folded: false, actedAt: 100 },
    { stack: 150, bet: 150, total: 150, hole: cards('Qs Qh'), folded: false, actedAt: null },
  ]
  const state = {
    players,
    initialStack: 150,
    bigBlind: 20,
    smallBlind: 10,
    button: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    deck: [],
    burns: [],
    board: cards('2c 4h 6d 8s Tc'),
    street: 'river',
    currentBet: 150,
    lastFullRaise: 50,
    pending: [false, false, true],
    turn: 2,
    result: null,
    showdown: false,
    pots: [],
    lastAction: null,
  }
  const { value: t } = await invoke(
    rules,
    'act',
    [state, { type: 'check' }],
    context(3, { seatIndex: 2 }),
  )
  assert.deepEqual(t.done.payouts, [150, 100, 200])
  assert.deepEqual(t.state.pots.map(p => p.winners), [[0], [1], [2]])
  assert.deepEqual(t.done.winners, [0, 1])
})
test('folded best hand contributes dead chips but cannot win the showdown', async () => {
  const players = [
    { stack: 80, bet: 20, total: 20, hole: cards('As Ah'), folded: true, actedAt: 20 },
    { stack: 80, bet: 20, total: 20, hole: cards('Ks Kh'), folded: false, actedAt: 20 },
    { stack: 80, bet: 20, total: 20, hole: cards('Qs Qh'), folded: false, actedAt: null },
  ]
  const state = {
    players,
    initialStack: 100,
    bigBlind: 20,
    smallBlind: 10,
    button: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    deck: [],
    burns: [],
    board: cards('2c 4h 6d 8s Tc'),
    street: 'river',
    currentBet: 20,
    lastFullRaise: 20,
    pending: [false, false, true],
    turn: 2,
    result: null,
    showdown: false,
    pots: [],
    lastAction: null,
  }
  const { value: t } = await invoke(
    rules,
    'act',
    [state, { type: 'check' }],
    context(3, { seatIndex: 2 }),
  )
  assert.deepEqual(t.done.payouts, [80, 140, 80])
  assert.deepEqual(t.state.pots[0].eligible, [1, 2])
})
