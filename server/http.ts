import { createServer } from 'node:http'
import { Store } from './store.js'
import { createGameRuntime, type RuntimeOptions } from './http-runtime.js'
export type ServerOptions = Omit<RuntimeOptions, 'store'> & { database?: string }
export function createGameServer(options: ServerOptions = {}) {
  const runtime = createGameRuntime({ ...options, store: new Store(options.database ?? ':memory:') })
  const server = createServer((req, res) => runtime.handle(req as Parameters<typeof runtime.handle>[0], res))
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  server.timeout = 15000
  server.maxHeadersCount = 50
  let tickQueued = false
  const interval = options.tickMs === 0 ? null : setInterval(() => {
    if (tickQueued) return
    tickQueued = true
    void runtime.engine.serial(() => runtime.engine.tick()).catch(() => {}).finally(() => {
      tickQueued = false
    })
  }, options.tickMs ?? 1000)
  interval?.unref()
  return {
    ...runtime,
    server,
    async close() {
      if (interval) clearInterval(interval)
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close(e => e && (e as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(e) : resolve())
      )
      await runtime.close()
    },
  }
}
