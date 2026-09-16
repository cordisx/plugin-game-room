import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { Economy, LocalPoolEngine, LocalSpendEngine } from '@cordisx/economy/server'
import { canonical, digest, type Signed, signingBytes } from '@cordisx/economy/spend'
import type { PoolDecision, PoolTerms } from '@cordisx/economy/pool'
import type { WalletSpendV1 } from '@cordisx/protocol/wallet-spend/v1'
import { GameWalletPool } from '../src/data/game-wallet-pool.js'
import type { Seat } from '../src/data/model.js'

async function fixture(t: test.TestContext) {
  const economy = new Economy(':memory:'), service = generateKeyPairSync('ed25519')
  t.after(() => economy.close())
  economy.auth.createInstance('test', 1000)
  const signed = <T>(payload: T): Signed<T> => ({
    payload,
    signature: sign(null, signingBytes(payload), service.privateKey).toString('base64url'),
  })
  const source = {
    serviceOrigin: 'https://game.example',
    serverId: 'game',
    servicePublicKey: service.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
  }
  const wallets = [0, 1].map(i => {
    const account = 'player-' + i, key = generateKeyPairSync('ed25519')
    economy.auth.createAccount('test', account)
    economy.store.transaction(() =>
      economy.store.transfer('test', '$issuer', account, 100, 'fixture', 'fixture', Date.now())
    )
    const wallet = new LocalSpendEngine(economy.store, 'test', account, key.privateKey)
    const binding = wallet.openSession(() => {})
    binding.bindGameAccount(
      binding.quoteBinding(
        signed({
          contract: 'economy.spend-wallet-challenge/v1',
          ...source,
          gameAccountId: account,
          nonce: String(i + 1).repeat(64),
          expiresAt: Date.now() + 60000,
        }),
      ),
    )
    const pool = new LocalPoolEngine(wallet, key.privateKey)
    return { wallet, pool, session: pool.openSession(() => {}) }
  })
  const terms = signed<PoolTerms>({
    contract: 'economy.pool-terms/v1',
    ...source,
    matchId: 'match',
    game: { id: 'gomoku', version: '1.7.0', digest: 'a'.repeat(64), reviewStatus: 'unreviewed' },
    participants: wallets.map((w, i) => ({
      gameAccountId: 'player-' + i,
      walletId: w.wallet.walletId,
      walletPublicKey: w.wallet.walletPublicKey,
      amount: 10,
    })),
    policy: 'winner-weights',
    rounds: 3,
    acceptBefore: Date.now() + 60000,
  })
  const termsHash = await digest(terms.payload)
  const requestIds = Object.fromEntries(
    await Promise.all(
      terms.payload.participants.map(
        async p => [p.gameAccountId, 'pool:' + await digest({ ...source, matchId: 'match', termsHash, ...p })],
      ),
    ),
  )
  const peer = wallets[1].session.reserve(wallets[1].session.quote(terms, requestIds['player-1'])).reservation
  const record = {
    terms,
    termsHash,
    requestIds,
    receipts: { 'player-1': peer } as Record<string, typeof peer>,
    decisions: [] as Signed<PoolDecision>[],
  }
  const own = wallets[0]
  const encode = (status: ReturnType<LocalPoolEngine['applyDecision']>) => ({
    ...status,
    reservation: canonical(status.reservation),
  })
  const capability = {
    pool: {
      lookup: async (input: { requestId: string }) => {
        const found = own.pool.lookup(source, input.requestId)
        return { status: 'accepted', value: found ? encode(found) : null }
      },
      reserve: async (input: { terms: string; requestId: string }) => ({
        status: 'accepted',
        value: encode(own.session.reserve(own.session.quote(JSON.parse(input.terms), input.requestId))),
      }),
      applyDecision: async (input: { decision: string }) => ({
        status: 'accepted',
        value: encode(own.pool.applyDecision(JSON.parse(input.decision), () => {})),
      }),
    },
  } as unknown as WalletSpendV1
  let requests = 0
  const client = new GameWalletPool({
    pin: () => source,
    account: () => 'player-0',
    identity: async () => ({ walletId: own.wallet.walletId, walletPublicKey: own.wallet.walletPublicKey }),
    lease: () => ({ capability, fence() {} }),
    accepted: r => {
      if (r.status !== 'accepted') throw Error('unavailable')
      return r.value
    },
    request: async (_id, path, _signal, body) => {
      requests++
      if (!path.endsWith('-receipts')) return structuredClone(record)
      record.receipts['player-0'] = body as typeof peer
      record.decisions = [
        signed<PoolDecision>({
          contract: 'economy.pool-decision/v1',
          terms,
          sequence: 1,
          previousHash: null,
          phase: 'finished',
          reservations: terms.payload.participants.map(p => record.receipts[p.gameAccountId]),
          allocations: terms.payload.participants.map((p, i) => ({
            walletId: p.walletId,
            paid: i === 0 ? 20 : 0,
            exited: true,
          })),
          remaining: 0,
          resultHash: 'b'.repeat(64),
        }),
      ]
      return { transaction: structuredClone(record) }
    },
  })
  const seat = {
    matchId: 'match',
    ownedSeats: [{ id: 'seat' }],
    room: {
      id: 'room',
      sourceId: 'game',
      stake: 10,
      game: { id: 'gomoku', version: '1.7.0', packageHash: 'a'.repeat(64) },
    },
  } as Seat
  return { client, record, seat, own, economy, requests: () => requests }
}

test('client verifies a pool quote, submits the original receipt and recovers winner credit without duplicate deposits', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  const quote = await f.client.quote(f.seat, f.record, signal)
  await f.client.reserve(f.seat, quote, signal)
  assert.deepEqual(f.economy.store.one('SELECT available,reserved FROM accounts WHERE id=?', 'player-0'), {
    available: 110,
    reserved: 0,
  })
  await f.client.recover('game', 'room', f.record, signal)
  assert.equal(
    f.economy.store.one<{ n: number }>('SELECT COUNT(*) AS n FROM poolReservations WHERE account=?', 'player-0')!.n,
    1,
  )
  assert.equal(
    f.economy.store.one<{ available: number }>('SELECT available FROM accounts WHERE id=?', 'player-0')!.available,
    110,
  )
})

test('client rejects a substituted room or unsigned terms before reaching the wallet or server mutation', async t => {
  const f = await fixture(t), signal = new AbortController().signal
  await assert.rejects(f.client.quote({ ...f.seat, matchId: 'different' }, f.record, signal), /不一致/)
  const tampered = structuredClone(f.record)
  tampered.terms.payload.rounds++
  await assert.rejects(f.client.quote(f.seat, tampered, signal), /校验失败/)
  assert.equal(f.requests(), 0)
  assert.equal(
    f.economy.store.one<{ reserved: number }>('SELECT reserved FROM accounts WHERE id=?', 'player-0')!.reserved,
    0,
  )
})
