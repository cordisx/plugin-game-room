import { localWallet, type LocalWalletBinding, type LocalWalletReadService, sameWallet } from '@cordisx/economy/local'
import { type HttpTransport, object, string } from './http.js'
import { type Balance, type LedgerRecord, type Source } from './model.js'
/** One public local authority. No wallet HTTP bearer or per-source balance exists. */
export class CanonicalGameWallet {
  readonly mode = 'canonical-local' as const
  private wallet?: LocalWalletBinding
  private activeProvider?: LocalWalletReadService
  private generation = 0
  private available = false
  private closed = false
  private sources = new Map<string, { serviceOrigin: string; servicePublicKey: string; serverId: string }>()
  constructor(
    _transport: () => HttpTransport,
    private readonly provider: () => LocalWalletReadService | undefined,
    _retiredSourceId?: string,
  ) {}
  walletStatus(): 'ready' | 'unavailable' {
    if (this.closed || this.activeProvider && this.provider() !== this.activeProvider) this.invalidate()
    return this.available ? 'ready' : 'unavailable'
  }
  invalidate() {
    this.generation++
    this.available = false
    this.activeProvider = undefined
  }
  discover(source: Source, value: unknown) {
    if (!value) {
      this.sources.delete(source.id)
      return
    }
    const binding = object(value)
    if (binding.contract !== 'economy.spend/v1') return
    const origin = new URL(source.url).origin
    if (binding.serviceOrigin !== origin || binding.serverId !== source.id) throw new Error('游戏来源身份不一致')
    const servicePublicKey = string(binding.servicePublicKey)
    if (!/^[A-Za-z0-9_-]{59}$/.test(servicePublicKey)) throw new Error('游戏来源签名无效')
    const prior = this.sources.get(source.id)
    if (prior && prior.servicePublicKey !== servicePublicKey) throw new Error('游戏来源签名已变化，请重新确认来源')
    this.sources.set(source.id, { serviceOrigin: origin, servicePublicKey, serverId: source.id })
  }
  hasService(sourceId: string) {
    return this.walletStatus() === 'ready' && this.sources.has(sourceId)
  }
  binding(sourceId: string) {
    const binding = this.sources.get(sourceId)
    if (!binding) throw new Error('此来源尚不支持 Token 投入')
    return binding
  }
  private fence(generation: number, provider?: LocalWalletReadService) {
    if (this.closed || generation !== this.generation || provider !== this.provider()) {
      throw new Error('本地钱包连接已变化，请重试')
    }
  }
  private async summary() {
    const generation = this.generation, provider = this.provider()
    try {
      if (this.closed || !provider || provider.contract !== 'economy.local-wallet/v1') {
        throw new Error('本地钱包暂时不可用')
      }
      const value = await provider.summary()
      this.fence(generation, provider)
      if (value.status !== 'ready') throw new Error('本地钱包暂时不可用')
      const wallet = localWallet(value.wallet)
      if (this.wallet && !sameWallet(this.wallet, wallet)) throw new Error('请恢复原本地钱包')
      if (![value.available, value.reserved].every(n => Number.isSafeInteger(n) && n >= 0)) {
        throw new Error('本地钱包余额无效')
      }
      this.wallet = wallet
      this.activeProvider = provider
      this.available = true
      return value
    } catch (error) {
      if (generation === this.generation) this.invalidate()
      throw error
    }
  }
  activate(signal: AbortSignal) {
    return this.balances(signal)
  }
  async balances(signal: AbortSignal): Promise<Balance[]> {
    signal.throwIfAborted()
    const value = await this.summary()
    signal.throwIfAborted()
    return [{
      economyId: value.wallet.instanceId,
      accountId: value.wallet.accountId,
      origin: value.wallet.origin,
      label: '本地 Token 钱包',
      available: value.available,
      reserved: value.reserved,
    }]
  }
  async ledger(signal: AbortSignal): Promise<LedgerRecord[]> {
    signal.throwIfAborted()
    await this.summary()
    const generation = this.generation, provider = this.provider()!
    try {
      const value = await provider.ledger()
      signal.throwIfAborted()
      this.fence(generation, provider)
      if (value.status !== 'ready' || !this.wallet || !sameWallet(value.wallet, this.wallet)) {
        throw new Error('本地收支记录暂时不可用')
      }
      return value.entries.map(row => {
        if (row.accountId !== this.wallet!.accountId) throw new Error('本地收支记录账户不一致')
        return { ...row, economyId: this.wallet!.instanceId, sourceId: 'economy:canonical' }
      })
    } catch (error) {
      if (generation === this.generation) this.invalidate()
      throw error
    }
  }
  dispose() {
    this.closed = true
    this.invalidate()
    this.sources.clear()
  }
}
