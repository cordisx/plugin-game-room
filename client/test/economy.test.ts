import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EconomyAccounts } from '../src/data/economy.js'
import type { HttpRequest, HttpTransport } from '../src/data/http.js'
import type { Seat, Source } from '../src/data/model.js'
const source: Source = { id: 'game', name: 'Game', url: 'https://game.example', accountId: 'g-user', enabled: true }
const seat: Seat = {
  room: {
    id: 'room',
    sourceId: 'game',
    name: 'Room',
    game: {
      id: 'custom',
      name: 'Custom',
      version: '1',
      packageHash: 'digest',
      publisherId: 'author',
      description: '',
      icon: '',
      modes: ['token'],
      policies: ['equal-winners-v1'],
    },
    occupied: 2,
    capacity: 2,
    state: 'playing',
    allowAgents: true,
    players: [],
    mode: 'token',
    stake: 10,
    review: '作者自制 · 未审核',
    rules: '',
    settlement: 'equal-winners-v1',
    compatible: true,
  },
  seatId: 'human',
  matchId: 'match',
  ready: true,
  consentRequired: false,
  observation: null,
  legalActions: [],
  ownedSeats: [{ id: 'human', name: 'Human', kind: 'human' }, { id: 'agent', name: 'Agent', kind: 'agent' }],
  funding: { economyUrl: 'https://economy.example', agreementId: 'agreement', termsHash: 'terms' },
}
test('wallet agreement binds instance, game, match and all owned seats; retry preserves reserve key', async () => {
  let agreement = {
    id: 'agreement',
    instanceId: 'economy',
    serviceId: 'service',
    matchId: 'match',
    game: { id: 'custom', version: '1', digest: 'digest', reviewStatus: 'unreviewed' },
    participants: [{ accountId: 'wallet', amount: 20, participantIds: ['agent', 'human'] }],
    settlementPolicy: { kind: 'conserved-payouts' },
    expiresAt: Date.now() + 60000,
    termsHash: 'terms',
    state: 'open',
    reservations: [] as string[],
  }
  const requests: HttpRequest[] = []
  let loseAck = true
  const transport: HttpTransport = {
    connect: async source => {
      assert.equal(source.id, 'economy:game')
    },
    request: async request => {
      requests.push(request)
      assert.equal(request.source.url, 'https://economy.example')
      if (request.path === '/v1/me') return { instanceId: 'economy', accountId: 'wallet', available: 100, reserved: 0 }
      if (request.path.startsWith('/v1/agreements/')) return structuredClone(agreement)
      if (request.path === '/v1/reserve') {
        agreement.reservations = ['wallet']
        if (loseAck) {
          loseAck = false
          throw new Error('lost ACK')
        }
        return agreement
      }
      if (request.path === '/v1/link-proofs') return { code: 'one-use-proof' }
      throw new Error(request.path)
    },
    dispose() {},
  }
  const accounts = new EconomyAccounts(() => transport)
  const signal = new AbortController().signal
  accounts.discover(source, { url: 'https://economy.example', instanceId: 'economy', gameServiceId: 'service' })
  await accounts.connect(source.id, signal)
  const quote = await accounts.quote(seat, signal)
  assert.equal(quote.amount, 20)
  await assert.rejects(accounts.reserve(seat, quote, signal), /lost ACK/)
  await accounts.reserve(seat, quote, signal)
  const reserves = requests.filter(request => request.path === '/v1/reserve')
  assert.equal(reserves.length, 2)
  assert.equal(reserves[0]!.idempotencyKey, reserves[1]!.idempotencyKey)
  assert.deepEqual(reserves[0]!.body, { agreementId: 'agreement', termsHash: 'terms' })
  for (
    const invalid of [{ ...agreement, matchId: 'other' }, { ...agreement, instanceId: 'other' }, {
      ...agreement,
      game: { ...agreement.game, digest: 'other' },
    }, { ...agreement, participants: [{ accountId: 'wallet', amount: 10, participantIds: ['human'] }] }]
  ) {
    const good = agreement
    agreement = invalid
    await assert.rejects(accounts.quote(seat, signal))
    agreement = good
  }
  assert.equal(await accounts.proof(source.id, 'g-user', signal), 'one-use-proof')
  assert.deepEqual(requests.at(-1)!.body, { gameServiceId: 'service', gameAccountId: 'g-user' })
})
