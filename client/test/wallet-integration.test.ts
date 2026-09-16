import assert from 'node:assert/strict'
import test from 'node:test'
import type { LocalWalletReadService } from '@cordisx/economy/local'
import { CanonicalGameWallet } from '../src/data/canonical-wallet.js'
import { WalletLifecycle } from '../src/data/wallet-lifecycle.js'
import { walletBalanceResource, walletLedgerResource } from '../src/data/wallet-presentation.js'
import { LivePort } from '../src/data/live-restored.js'
import type { HttpTransport } from '../src/data/http.js'
const signal = () => new AbortController().signal
const wallet = { origin: 'http://127.0.0.1:58972', instanceId: 'formal-local', accountId: 'usage-only' }
const game = { id: 'local-game', name: 'Local', url: 'http://127.0.0.1:58973', enabled: true, accountId: '' }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}
function fixture() {
  let current: LocalWalletReadService | undefined, calls = 0, hold: Promise<void> | undefined
  const provider: LocalWalletReadService = {
    contract: 'economy.local-wallet/v1',
    summary: async () => {
      calls++
      await hold
      return { status: 'ready', wallet, available: 55, reserved: 5 }
    },
    ledger: async () => ({ status: 'ready', wallet, entries: [] }),
  }
  current = provider
  const transport: HttpTransport = { request: async () => ({ code: 'proof' }), dispose: () => {} }
  const lifecycle = new WalletLifecycle(() => transport, get => new CanonicalGameWallet(get, () => current))
  const port = { walletMode: () => lifecycle.mode, walletStatus: () => lifecycle.status }
  const retire = () => {
    current = undefined
  }
  return {
    lifecycle,
    port,
    provider,
    transport,
    retire,
    calls: () => calls,
    hold: (p?: Promise<void>) => {
      hold = p
    },
  }
}
test('provider retirement immediately removes balances, ledger and link capability from loaded view', async () => {
  const f = fixture()
  await f.lifecycle.refresh(signal())
  f.lifecycle.adapter.discover(game, {
    contract: 'economy.spend/v1',
    pool: 'economy.pool/v1',
    serviceOrigin: game.url,
    serverId: game.id,
    servicePublicKey: 'a'.repeat(59),
  })
  assert.equal(f.lifecycle.adapter.hasService(game.id), true)
  const balances = { status: 'ready' as const, data: await f.lifecycle.adapter.balances(signal()), retry() {} }
  const ledger = {
    status: 'ready' as const,
    data: [{
      economyId: wallet.instanceId,
      accountId: wallet.accountId,
      sequence: 1,
      transactionId: 'tx',
      sourceId: game.id,
      reason: 'reward',
      reference: 'future-work',
      availableDelta: 1,
      reservedDelta: 0,
      createdAt: 1,
    }],
    retry() {},
  }
  assert.equal(walletBalanceResource(f.port, balances).data.length, 1)
  assert.equal(walletLedgerResource(f.port, ledger, balances).data.length, 1)
  f.retire()
  assert.equal(f.lifecycle.adapter.hasService(game.id), false)
  assert.equal(f.lifecycle.status, 'unavailable')
  assert.deepEqual(walletBalanceResource(f.port, balances).data, [])
  assert.equal(walletBalanceResource(f.port, balances).status, 'error')
  assert.deepEqual(walletLedgerResource(f.port, ledger, balances).data, [])
})
test('formal view refuses stale assets, multiple wallets and isolated initial test credit', () => {
  const port = { walletMode: () => 'canonical-local' as const, walletStatus: () => 'ready' as const }
  const balance = {
    economyId: wallet.instanceId,
    accountId: wallet.accountId,
    origin: wallet.origin,
    label: 'Local',
    available: 55,
    reserved: 5,
  }
  const resource = { status: 'ready' as const, data: [balance], retry() {} }
  assert.deepEqual(walletBalanceResource(port, { ...resource, stale: true }).data, [])
  assert.deepEqual(walletBalanceResource(port, { ...resource, data: [balance, balance] }).data, [])
  assert.deepEqual(
    walletBalanceResource(port, {
      ...resource,
      data: [{ ...balance, economyId: 'local-game-room-test', available: 1000 }],
    }).data,
    [],
  )
  assert.deepEqual(walletBalanceResource(port, resource).data, [balance])
})
test('canceling one discovery does not retire another source shared activation', async () => {
  const f = fixture(), held = deferred(), controller = new AbortController()
  f.hold(held.promise)
  const canceled = f.lifecycle.refresh(controller.signal)
  const rejected = assert.rejects(canceled)
  const valid = f.lifecycle.refresh(signal())
  controller.abort()
  await rejected
  assert.equal(f.lifecycle.status, 'unavailable')
  held.resolve()
  await valid
  assert.equal(f.calls(), 1)
  assert.equal(f.lifecycle.status, 'ready')
})
test('HTTP replacement recreates the permanently retired adapter and retains canonical-only reads', async () => {
  const f = fixture()
  const port = new LivePort([game], f.transport, [], get => new CanonicalGameWallet(get, () => f.provider))
  await port.refreshWallet(signal())
  const before = await port.balances(signal())
  port.setHttp({ request: async () => ({}), dispose() {} })
  await port.refreshWallet(signal())
  assert.equal(port.walletMode(), 'canonical-local')
  assert.deepEqual(await port.balances(signal()), before)
  await port.dispose()
})

test('port disposal retires wallet synchronously while HTTP cleanup and old activation are held', async () => {
  const f = fixture(), summary = deferred(), cleanup = deferred()
  f.hold(summary.promise)
  const transport: HttpTransport = { request: async () => ({}), dispose: () => cleanup.promise }
  const port = new LivePort([game], transport, [], get => new CanonicalGameWallet(get, () => f.provider))
  const activation = port.refreshWallet(signal())
  const oldRejected = assert.rejects(activation)
  const disposing = port.dispose()
  assert.equal(port.walletStatus(), 'unavailable')
  assert.equal(port.economyAvailable(game.id), false)
  await assert.rejects(port.balances(signal()), /客户端已关闭/)
  await assert.rejects(port.refreshWallet(signal()), /客户端已关闭/)
  summary.resolve()
  await oldRejected
  assert.equal(port.walletStatus(), 'unavailable')
  cleanup.resolve()
  await disposing
})
test('ready wallet becomes unavailable before asynchronous port cleanup completes', async () => {
  const f = fixture(), cleanup = deferred()
  const transport: HttpTransport = { request: async () => ({}), dispose: () => cleanup.promise }
  const port = new LivePort([game], transport, [], get => new CanonicalGameWallet(get, () => f.provider))
  await port.refreshWallet(signal())
  assert.equal(port.walletStatus(), 'ready')
  assert.equal((await port.balances(signal())).length, 1)
  const disposing = port.dispose()
  assert.equal(port.walletStatus(), 'unavailable')
  assert.equal(port.economyAvailable(game.id), false)
  await assert.rejects(port.balances(signal()), /客户端已关闭/)
  await assert.rejects(port.refreshWallet(signal()), /客户端已关闭/)
  cleanup.resolve()
  await disposing
})

test('canceling a ready-wallet refresh settles while provider remains held and preserves other readers', async () => {
  const f = fixture(), held = deferred(), controller = new AbortController()
  await f.lifecycle.refresh(signal())
  f.hold(held.promise)
  const rejected = assert.rejects(f.lifecycle.refresh(controller.signal))
  const valid = f.lifecycle.refresh(signal())
  controller.abort()
  await rejected
  assert.equal(f.lifecycle.status, 'ready')
  held.resolve()
  await valid
  assert.equal(f.lifecycle.status, 'ready')
})

test('late HTTP cleanup cannot retire a healthy replacement or reopen a closed owner', async () => {
  const f = fixture()
  let healthyDisposed = 0, lateDisposed = 0
  const healthy: HttpTransport = {
    request: async () => ({}),
    dispose: () => {
      healthyDisposed++
    },
  }
  const port = new LivePort([game], f.transport, [], get => new CanonicalGameWallet(get, () => f.provider))
  port.setHttp(healthy)
  await port.refreshWallet(signal())
  port.setHttp({ request: async () => ({}), dispose() {} }, f.transport)
  assert.equal(port.walletStatus(), 'ready')
  assert.equal(healthyDisposed, 0)
  await port.dispose()
  port.setHttp({
    request: async () => ({}),
    dispose: () => {
      lateDisposed++
    },
  })
  assert.equal(port.walletStatus(), 'unavailable')
  assert.equal(lateDisposed, 1)
})
