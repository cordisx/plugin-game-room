import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { canonical, digest, type Signed, signingBytes, type SpendReservation } from '@cordisx/economy/spend'
import type { WalletSpendV1 } from '@cordisx/protocol/wallet-spend/v1'
import { GameWalletSpend } from '../src/data/game-wallet-spend.js'
import type { Seat } from '../src/data/model.js'
const signal = () => new AbortController().signal
async function fixture() {
  const service = generateKeyPairSync('ed25519'), wallet = generateKeyPairSync('ed25519')
  const pk = (key: typeof wallet) => key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
  const signed = <T extends { contract: string }>(payload: T, key = service) => ({
    payload,
    signature: sign(null, signingBytes(payload), key.privateKey).toString('base64url'),
  })
  const source = { id: 'game', url: 'https://game.example', name: 'Game', accountId: 'remote-account', enabled: true }
  const pin = { serviceOrigin: source.url, serverId: source.id, servicePublicKey: pk(service) },
    identity = { walletId: 'original-wallet', walletPublicKey: pk(wallet) }
  const terms = signed({
    contract: 'economy.spend-terms/v1' as const,
    ...pin,
    matchId: 'match',
    game: { id: 'custom', version: '1.0.0', digest: 'a'.repeat(64), reviewStatus: 'unreviewed' as const },
    participants: [{ gameAccountId: source.accountId, ...identity, amount: 20 }],
    policy: 'capture-and-release' as const,
    acceptBefore: Date.now() + 60000,
  })
  const termsHash = await digest(terms.payload),
    requestId = 'spend:' + await digest({ ...pin, matchId: 'match', termsHash, ...terms.payload.participants[0] })
  let binding: unknown = null,
    hold: { reservation: string; state: 'pending' } | null = null,
    lose = true,
    reserves = 0,
    submits = 0,
    approved = true,
    tamperedSettlement = false,
    decisions: string[] = []
  const transaction = {
    terms,
    termsHash,
    requestIds: { [source.accountId]: requestId },
    receipts: {} as Record<string, Signed<SpendReservation>>,
    phase: 'funding',
    decision: null as unknown,
  }
  const request = async (_id: string, path: string, _signal: AbortSignal, body?: unknown) => {
    if (path === '/v1/wallet-bindings') {
      if (body) binding = body
      return { binding }
    }
    if (path === '/v1/wallet-bindings/challenge') {
      return signed({
        contract: 'economy.spend-wallet-challenge/v1',
        ...pin,
        gameAccountId: source.accountId,
        nonce: 'b'.repeat(64),
        expiresAt: Date.now() + 60000,
      })
    }
    if (path.endsWith('/spend')) return structuredClone(transaction)
    if (path.endsWith('/spend-receipts')) {
      submits++
      transaction.receipts[source.accountId] = body as Signed<SpendReservation>
      return { transaction: structuredClone(transaction), view: {} }
    }
    if (path === '/v1/me/spend-transactions') {
      return { transactions: [{ roomId: 'room', transaction: structuredClone(transaction) }] }
    }
    throw new Error(path)
  }
  // Public-capability test double only. Native authorization is independently owned by Host.
  const capability = {
    contract: 'cordisx.wallet-spend/v1',
    identity: async () => ({ status: 'accepted', value: identity }),
    authorizeSource: async () => ({ status: 'accepted', value: pin }),
    bindGameAccount: async (input: { challenge: string }) => {
      const c = JSON.parse(input.challenge).payload
      return {
        status: 'accepted',
        value: canonical(signed({ ...c, contract: 'economy.spend-wallet-binding/v1', ...identity }, wallet)),
      }
    },
    lookup: async (input: { requestId: string }) => {
      assert.equal(input.requestId, requestId)
      return { status: 'accepted', value: hold }
    },
    reserve: async (input: { terms: string; requestId: string }) => {
      if (!approved) return { status: 'unavailable', code: 'denied' }
      assert.equal(input.terms, canonical(terms))
      assert.equal(input.requestId, requestId)
      reserves++
      hold = {
        reservation: canonical(
          signed({
            contract: 'economy.spend-reservation/v1',
            ...pin,
            matchId: 'match',
            termsHash,
            ...terms.payload.participants[0],
            reservationId: 'reservation',
            nonce: 'c'.repeat(64),
          }, wallet),
        ),
        state: 'pending',
      }
      if (lose) {
        lose = false
        return { status: 'unavailable', code: 'outcome-unknown' }
      }
      return { status: 'accepted', value: hold }
    },
    applyDecision: async (input: { decision: string }) => {
      decisions.push(input.decision)
      const decision = JSON.parse(input.decision), reservation = JSON.parse(hold!.reservation)
      const captured = tamperedSettlement ? 21 : 20
      const settlement = signed({
        contract: 'economy.spend-settlement/v1',
        reservationId: reservation.payload.reservationId,
        decisionId: decision.payload.decisionId,
        decisionHash: await digest(decision.payload),
        walletId: identity.walletId,
        amount: 20,
        captured,
        released: 20 - captured,
      }, wallet)
      return {
        status: 'accepted',
        value: [{ reservation: hold!.reservation, state: 'captured', settlement: canonical(settlement) }],
      }
    },
    dispose() {},
  } as WalletSpendV1
  const client = new GameWalletSpend(request, () => source.accountId, () => source, () => pin)
  client.setCapability(capability)
  await client.authorize(source.id, signal())
  await client.bind(source.id, signal())
  const seat = {
    room: {
      id: 'room',
      sourceId: source.id,
      stake: 10,
      mode: 'token',
      game: { id: 'custom', version: '1.0.0', packageHash: 'a'.repeat(64) },
    },
    matchId: 'match',
    ownedSeats: [{ id: 'human' }, { id: 'agent' }],
  } as Seat
  return {
    client,
    capability,
    source,
    seat,
    transaction,
    requestId,
    tamperSettlement: () => {
      tamperedSettlement = true
    },
    delivered: () => decisions,
    finalize: async () => {
      const reservation = JSON.parse(hold!.reservation), identity = { ...pin, matchId: 'match', termsHash }
      transaction.phase = 'capture'
      transaction.decision = signed({
        contract: 'economy.spend-decision/v1',
        ...identity,
        decisionId: 'decision:' + await digest(identity),
        action: 'capture',
        entries: [{ reservation, captureAmount: 20 }],
      })
    },
    deny: () => {
      approved = false
    },
    counts: () => ({ reserves, submits }),
    fresh: async () => {
      const c = new GameWalletSpend(request, () => source.accountId, () => source, () => pin)
      c.setCapability(capability)
      await c.authorize(source.id, signal())
      return c
    },
  }
}
test('public bridge binds signed wallet proof; unknown reserve ACK recovers original request after client restart without new reserve', async () => {
  const f = await fixture(), quote = await f.client.quote(f.seat, signal())
  assert.equal(quote.amount, 20)
  assert.equal(quote.requestId, f.requestId)
  assert(await f.client.linked(f.source.id, signal()))
  await assert.rejects(f.client.reserve(f.seat, quote, signal()), /待恢复/)
  assert.deepEqual(f.counts(), { reserves: 1, submits: 0 })
  const restarted = await f.fresh()
  await restarted.recover(f.source.id, signal())
  assert.deepEqual(f.counts(), { reserves: 1, submits: 1 })
  assert((await restarted.quote(f.seat, signal())).reserved)
})
test('denied confirmation cannot submit receipt; altered terms or seat totals fail before wallet reserve', async () => {
  const f = await fixture(), quote = await f.client.quote(f.seat, signal())
  f.deny()
  await assert.rejects(f.client.reserve(f.seat, quote, signal()), /已取消/)
  assert.deepEqual(f.counts(), { reserves: 0, submits: 0 })
  await assert.rejects(f.client.reserve(f.seat, { ...quote, amount: 21 }, signal()), /已变化/)
  await assert.rejects(
    f.client.quote({ ...f.seat, ownedSeats: [{ id: 'human', name: 'Human', kind: 'human' }] }, signal()),
    /席位不一致/,
  )
  f.transaction.termsHash = 'd'.repeat(64)
  await assert.rejects(f.client.quote(f.seat, signal()), /校验失败/)
})
test('missing public capability is unavailable and cannot use Game HTTP as wallet authority', async () => {
  const f = await fixture()
  f.client.setCapability(undefined)
  assert.equal(f.client.supported(), false)
  await assert.rejects(f.client.quote(f.seat, signal()))
  assert.deepEqual(f.counts(), { reserves: 0, submits: 0 })
})

test('final decision delivery verifies original-wallet settlement bounds and reuses exact signed bytes', async () => {
  const f = await fixture(), quote = await f.client.quote(f.seat, signal())
  await assert.rejects(f.client.reserve(f.seat, quote, signal()))
  await f.client.recover(f.source.id, signal())
  await f.finalize()
  await f.client.recover(f.source.id, signal())
  await f.client.recover(f.source.id, signal())
  assert.equal(f.delivered().length, 1)
  assert.equal(f.delivered()[0], canonical(f.transaction.decision))
  const restarted = await f.fresh()
  f.tamperSettlement()
  await assert.rejects(restarted.recover(f.source.id, signal()))
  assert.equal(f.delivered()[1], f.delivered()[0])
})
