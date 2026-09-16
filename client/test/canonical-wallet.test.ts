import assert from 'node:assert/strict'
import test from 'node:test'
import { CanonicalGameWallet } from '../src/data/canonical-wallet.js'
import type { LocalWalletReadService } from '@cordisx/economy/local'
const signal = () => new AbortController().signal
const original = { origin: 'http://127.0.0.1:58974', instanceId: 'original', accountId: 'actual-usage' }
const sources = [{ id: 'remote-a', url: 'https://a.example', name: 'A', accountId: 'alice', enabled: true }, {
  id: 'remote-b',
  url: 'https://b.example',
  name: 'B',
  accountId: 'bob',
  enabled: true,
}]
const binding = (source: typeof sources[number]) => ({
  contract: 'economy.spend/v1',
  pool: 'economy.pool/v1',
  serviceOrigin: source.url,
  serverId: source.id,
  servicePublicKey: 'a'.repeat(59),
})
function fixture() {
  let current: LocalWalletReadService | undefined, accountId = original.accountId, foreign = false
  const transport = {
    request: async () => {
      throw new Error('wallet HTTP forbidden')
    },
    dispose() {},
  }
  const provider: LocalWalletReadService = {
    contract: 'economy.local-wallet/v1',
    summary: async () => ({ status: 'ready', wallet: { ...original, accountId }, available: 42, reserved: 8 }),
    ledger: async () => ({
      status: 'ready',
      wallet: { ...original, accountId },
      entries: [{
        sequence: 1,
        transactionId: 'usage-1',
        accountId: foreign ? 'foreign' : accountId,
        availableDelta: 42,
        reservedDelta: 0,
        reason: 'work-income',
        reference: 'trusted-host-usage',
        createdAt: 1,
      }],
    }),
  }
  current = provider
  const wallet = new CanonicalGameWallet(() => transport, () => current)
  return {
    wallet,
    retire: () => {
      current = undefined
    },
    replace: () => {
      accountId = 'replacement'
    },
    foreign: () => {
      foreign = true
    },
  }
}
test('two remote sources/accounts read one original local wallet and ledger without HTTP or per-source balance', async () => {
  const f = fixture()
  for (const source of sources) f.wallet.discover(source, binding(source))
  assert.deepEqual((await f.wallet.balances(signal())).map(x => [x.accountId, x.available, x.reserved]), [[
    original.accountId,
    42,
    8,
  ]])
  assert.equal((await f.wallet.ledger(signal())).length, 1)
  for (const source of sources) assert(f.wallet.hasService(source.id))
  f.retire()
  assert.equal(f.wallet.walletStatus(), 'unavailable')
  await assert.rejects(f.wallet.balances(signal()))
  assert.equal(f.wallet.hasService(sources[0].id), false)
})
test('provider cannot replace original wallet or return another account ledger', async () => {
  const f = fixture()
  await f.wallet.balances(signal())
  f.replace()
  await assert.rejects(f.wallet.balances(signal()), /恢复原/)
  const g = fixture()
  await g.wallet.balances(signal())
  g.foreign()
  await assert.rejects(g.wallet.ledger(signal()), /账户不一致/)
})
test('legacy wallet URL or substituted source identity cannot activate spending', async () => {
  const f = fixture()
  await f.wallet.balances(signal())
  f.wallet.discover(sources[0], { url: original.origin, instanceId: original.instanceId, gameServiceId: 'old' })
  assert.equal(f.wallet.hasService(sources[0].id), false)
  assert.throws(() =>
    f.wallet.discover(sources[0], { ...binding(sources[0]), serviceOrigin: 'https://foreign.example' })
  )
  f.wallet.discover(sources[0], binding(sources[0]))
  assert.throws(() => f.wallet.discover(sources[0], { ...binding(sources[0]), servicePublicKey: 'b'.repeat(59) }))
  for (const name of ['connect', 'proof', 'quote', 'reserve']) assert.equal(name in f.wallet, false)
})

test('old fee-only sources remain available for receipt recovery but cannot offer new Token pools', async () => {
  const f = fixture(), { pool: _pool, ...legacy } = binding(sources[0])
  await f.wallet.balances(signal())
  f.wallet.discover(sources[0], legacy)
  assert.equal(f.wallet.supportsService(sources[0].id), false)
  assert.equal(f.wallet.binding(sources[0].id).serverId, sources[0].id)
})
