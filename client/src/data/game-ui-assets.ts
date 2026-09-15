import { type HttpTransport, object, string } from './http.js'
import type { Source } from './model.js'

/** Immutable public package assets; no account or room state is cached here. */
export class GameUiAssets {
  private entries = new Map<string, Promise<{ bundle: unknown; digest: string }>>()
  load(http: HttpTransport, source: Source, hash: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const key = JSON.stringify([source.id, source.url, hash])
    let pending = this.entries.get(key)
    if (!pending) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('游戏资源加载超时')), 15000)
      pending = Promise.all([
        http.request({ source, path: `/v1/packages/${hash}`, authenticated: false, signal: controller.signal }),
        http.request({ source, path: `/v1/packages/${hash}/ui`, authenticated: false, signal: controller.signal }),
      ]).then(([value, bundle]) => {
        const meta = object(value)
        if (meta.hash !== hash) throw new Error('游戏包身份不匹配')
        return { bundle, digest: string(meta.uiSha256) }
      }).catch(error => {
        this.entries.delete(key)
        throw error
      }).finally(() => clearTimeout(timer))
      this.entries.set(key, pending)
      if (this.entries.size > 16) this.entries.delete(this.entries.keys().next().value!)
    }
    return new Promise<{ bundle: unknown; digest: string }>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }
}
