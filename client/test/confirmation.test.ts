import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agentDispatchSchema,
  compatibleAgentRooms,
  prepareConsentKey,
  quoteExpired,
  validActionBudget,
} from '../src/data/confirmation.js'
import { SamplePort } from '../src/data/sample.js'
test('Agent target schema retains only compatible waiting vacant allowed supported rooms', async () => {
  const port = new SamplePort()
  const signal = new AbortController().signal
  const agent = (await port.agents(signal))[1]!
  const room = (await port.list(port.sources[0]!, signal)).rooms[0]!
  const candidates = [
    room,
    { ...room, id: 'full', occupied: room.capacity },
    { ...room, id: 'playing', state: 'playing' as const },
    { ...room, id: 'incompatible', compatible: false },
    { ...room, id: 'no-agents', allowAgents: false },
    { ...room, id: 'unsupported', game: { ...room.game, id: 'other' } },
  ]
  assert.deepEqual(compatibleAgentRooms(agent, candidates).map(room => room.id), [room.id])
  const schema = agentDispatchSchema([room])
  assert.equal(schema({ roomKey: `${room.sourceId}/${room.id}`, budget: 30 }).budget, 30)
  for (const budget of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    assert.equal(validActionBudget(budget), false)
    assert.throws(() => schema({ roomKey: `${room.sourceId}/${room.id}`, budget }))
  }
  assert.throws(() => schema({ roomKey: 'foreign/room', budget: 30 }))
})
test('quote expiry blocks exact boundary and invalid deadline, permits future quote', () => {
  assert.equal(quoteExpired(100, 99), false)
  assert.equal(quoteExpired(100, 100), true)
  assert.equal(quoteExpired(100, 101), true)
  assert.equal(quoteExpired(NaN, 0), true)
})

test('preparation consent identity separates source, room and seat even with identical terms', async () => {
  const port = new SamplePort()
  const room = (await port.list(port.sources[0]!, new AbortController().signal)).rooms[0]!
  const seat = {
    room,
    seatId: 'one',
    matchId: 'match',
    ready: false,
    consentRequired: true,
    observation: null,
    legalActions: [],
  }
  const key = prepareConsentKey(seat)
  assert.notEqual(key, prepareConsentKey({ ...seat, room: { ...room, id: 'another' } }))
  assert.notEqual(key, prepareConsentKey({ ...seat, room: { ...room, sourceId: 'another' } }))
  assert.notEqual(key, prepareConsentKey({ ...seat, seatId: 'another' }))
})
