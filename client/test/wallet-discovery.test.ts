import assert from 'node:assert/strict'
import test from 'node:test'
import type { WalletSpendV1 } from '@cordisx/protocol/wallet-spend/v1'
import type { LocalWalletReadService } from '@cordisx/economy/local'
import { LivePort } from '../src/data/live-restored.js'
import { SourceAggregator } from '../src/data/aggregate.js'
import { CanonicalGameWallet } from '../src/data/canonical-wallet.js'
import type { SourceState } from '../src/data/model.js'
import type { HttpTransport } from '../src/data/http.js'

const source = { id: 'game', name: 'Game', url: 'http://127.0.0.1:58973', enabled: true }
const original = { origin: 'http://127.0.0.1:58974', instanceId: 'original', accountId: 'actual-usage' }
const provider: LocalWalletReadService = {
  contract: 'economy.local-wallet/v1',
  summary: async () => ({ status: 'ready', wallet: original, available: 42, reserved: 0 }),
  ledger: async () => ({ status: 'ready', wallet: original, entries: [] }),
}

for (const code of ['source-unavailable', 'denied', 'outcome-unknown'] as const) {
  test(`lobby discovers a spend-enabled source without wallet approval (${code}); explicit connection preserves refusal`, async () => {
    const paths: string[] = []
    let approvals = 0
    const http: HttpTransport = {
      prepare: async () => {
        paths.push('prepare')
      },
      restoreSession: async () => ({ account: { id: 'remote-account', guest: false } }),
      request: async request => {
        paths.push(request.path)
        if (request.path === '/v1/handshake') {
          return {
            protocol: 'game-room/1',
            serverId: source.id,
            gamePackageVersion: 1,
            uiFormats: ['scene-v1'],
            economyAvailable: false,
            economy: null,
            walletSpend: {
              contract: 'economy.spend/v1',
              serviceOrigin: source.url,
              serverId: source.id,
              servicePublicKey: 'a'.repeat(59),
            },
          }
        }
        if (request.path === '/v1/packages') return { packages: [] }
        if (request.path === '/v1/rooms' || request.path === '/v1/me/rooms') return { rooms: [] }
        throw new Error(request.path)
      },
      dispose() {},
    }
    const port = new LivePort([source], http, [], get => new CanonicalGameWallet(get, () => provider))
    // Public capability double only; refusal must never be swallowed by explicit spend authorization.
    port.setWalletSpend({
      contract: 'cordisx.wallet-spend/v1',
      authorizeSource: async () => {
        approvals++
        return { status: 'unavailable', code }
      },
      identity: async () => {
        throw new Error('identity must not run during discovery')
      },
    } as WalletSpendV1)
    let states: SourceState[] = []
    const aggregate = new SourceAggregator(port, value => {
      states = value
    })
    try {
      await aggregate.refresh()
      assert.equal(states[0]!.state, 'online')
      assert.equal(port.isConnected(source.id), true)
      assert.equal(port.walletStatus(), 'ready')
      assert.equal(port.tokenStatus(source.id), 'ready')
      assert.equal(port.tokenStatus('unknown'), 'source-unsupported')
      assert.equal(approvals, 0)
      assert.ok(paths.includes('/v1/rooms'))
      assert.ok(paths.includes('/v1/packages'))
      const signal = new AbortController().signal
      assert.equal(await port.economyLinked(source.id, signal), false)
      await assert.rejects(port.connectEconomy(source.id, signal), /钱包/)
      assert.equal(approvals, 1)
      assert.equal(await port.economyLinked(source.id, signal), false)
      await aggregate.refresh()
      assert.equal(states[0]!.state, 'online')
      assert.equal(approvals, 1)
      port.setWalletSpend(undefined)
      assert.equal(port.tokenStatus(source.id), 'host-unavailable')
      port.invalidateWallet()
      assert.equal(port.tokenStatus(source.id), 'wallet-unavailable')
    } finally {
      aggregate.dispose()
      await port.dispose()
    }
  })
}
