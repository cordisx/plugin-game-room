import { CanonicalGameWallet } from './canonical-wallet.js'
import type { HttpTransport } from './http.js'
import type { Balance } from './model.js'
export type WalletMode = 'canonical-local'
export type WalletAdapter = CanonicalGameWallet & {
  readonly mode?: WalletMode
  walletStatus?: () => 'ready' | 'unavailable'
  invalidate?: () => void
  activate?: (signal: AbortSignal) => Promise<void | Balance[]>
}
export type WalletFactory = (transport: () => HttpTransport) => WalletAdapter
/** Read-only availability coordination; it never observes usage or allocates income. */
export class WalletLifecycle {
  adapter: WalletAdapter
  private activation?: Promise<void | Balance[]>
  private closed = false
  constructor(
    private readonly transport: () => HttpTransport,
    private readonly factory: WalletFactory = get => new CanonicalGameWallet(get, () => undefined),
  ) {
    this.adapter = factory(transport)
  }
  get mode(): WalletMode {
    return this.adapter.mode
  }
  get status(): 'ready' | 'unavailable' {
    if (this.closed) return 'unavailable'
    return this.adapter.walletStatus?.() ?? 'unavailable'
  }
  invalidate(): void {
    this.adapter.invalidate?.()
    this.activation = undefined
  }
  reset(): void {
    if (this.closed) throw new Error('客户端已关闭')
    this.adapter.dispose()
    this.adapter = this.factory(this.transport)
    this.activation = undefined
  }
  async refresh(signal: AbortSignal): Promise<Balance[]> {
    if (this.closed) throw new Error('客户端已关闭')
    const adapter = this.adapter
    if (!adapter.activate) return []
    signal.throwIfAborted()
    let balances: Balance[]
    if (this.status === 'ready') {
      balances = await waitForCaller(adapter.balances(new AbortController().signal), signal)
    } else {
      let pending = this.activation
      if (!pending) {
        // A canceled source discovery does not retire another source's shared activation.
        pending = adapter.activate(new AbortController().signal).finally(() => {
          if (this.activation === pending) this.activation = undefined
        })
        this.activation = pending
      }
      balances = await waitForCaller(pending, signal)
        ?? await waitForCaller(adapter.balances(new AbortController().signal), signal)
    }
    signal.throwIfAborted()
    if (this.adapter !== adapter) throw new Error('本地钱包连接已被替换')
    return balances
  }
  dispose(): void {
    this.closed = true
    this.adapter.dispose()
    this.activation = undefined
  }
}

/** Cancel only this caller while leaving the provider activation available to other sources. */
function waitForCaller<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    pending.then(value => {
      signal.removeEventListener('abort', aborted)
      resolve(value)
    }, error => {
      signal.removeEventListener('abort', aborted)
      reject(error)
    })
  })
}
