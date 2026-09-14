import { createGameRuntime, type IncomingMessage } from '../http-runtime.js'
import { type D1Binding, D1Store } from './d1-store.js'
import { configuredAccessPolicy } from '../access-policy.js'
import { requireThat } from '../errors.js'
import * as managedCodec from '@cordisx/protocol/managed-source/v1'
import type { ManagedAccountTrust } from '../managed-auth.js'
let cleanedWindow = -1
interface Env {
  DB: D1Binding
  SPEND_SERVICE_ORIGIN?: string
  SPEND_SERVICE_PRIVATE_KEY?: string
  AUTH_POLICY?: string
  ALLOWED_ORIGINS?: string
  MANAGED_SOURCE_TRUST?: string
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env)
    } catch (error) {
      console.error('game_backend_unavailable', error instanceof Error ? error.name : 'unknown')
      return Response.json({ error: { code: 'backend_unavailable', message: 'Backend unavailable' } }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      })
    }
  },
}
async function handle(request: Request, env: Env): Promise<Response> {
  requireThat(!!env.SPEND_SERVICE_ORIGIN === !!env.SPEND_SERVICE_PRIVATE_KEY, 'invalid_spend_configuration')
  const store = await D1Store.open(env.DB)
  const managedTrust: ManagedAccountTrust | undefined = env.MANAGED_SOURCE_TRUST
    ? JSON.parse(env.MANAGED_SOURCE_TRUST)
    : undefined
  if (managedTrust) {
    requireThat(
      managedTrust.binding?.origin === new URL(request.url).origin
        && managedTrust.binding.sourceId === store.serverId && managedTrust.binding.instanceId === store.serverId
        && managedTrust.binding.audience === 'source-account',
      'managed_binding_mismatch',
    )
  }
  const session = env.DB.withSession('first-primary')
  const runtime = createGameRuntime({
    store,
    ...(managedTrust ? { managedAccount: { trust: managedTrust, codec: managedCodec } } : {}),
    ...(env.SPEND_SERVICE_ORIGIN && env.SPEND_SERVICE_PRIVATE_KEY
      ? { walletSpend: { origin: env.SPEND_SERVICE_ORIGIN, privateKey: env.SPEND_SERVICE_PRIVATE_KEY } }
      : {}),
    accessPolicy: configuredAccessPolicy({ AUTH_POLICY: env.AUTH_POLICY }),
    allowedOrigins: env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean),
    requestDrivenTicks: true,
    rateLimit: async (address, auth) => {
      const key = address + (auth ? ':auth' : ':api')
      const window = Math.floor(Date.now() / 60000)
      const row = await session.prepare(
        'INSERT INTO rate_buckets(key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN rate_buckets.window=excluded.window THEN rate_buckets.count+1 ELSE 1 END RETURNING count',
      ).bind(key, window).first<{ count: number }>()
      requireThat(row && row.count <= (auth ? 15 : 600), 'rate_limited', 429)
      if (window !== cleanedWindow) {
        // At most one cleanup per minute in this isolate; the counter remains entirely in D1.
        cleanedWindow = window
        try {
          await session.prepare(
            'DELETE FROM rate_buckets WHERE key IN (SELECT key FROM rate_buckets WHERE window<? LIMIT 1000)',
          ).bind(window - 1).run()
        } catch (error) {
          cleanedWindow = -1
          throw error
        }
      }
    },
  })
  const headers = Object.fromEntries(request.headers)
  const incoming: IncomingMessage = {
    method: request.method,
    url: request.url,
    headers,
    socket: { remoteAddress: request.headers.get('CF-Connecting-IP') ?? 'unknown' },
    async *[Symbol.asyncIterator]() {
      const reader = request.body?.getReader()
      if (!reader) return
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          yield Buffer.from(chunk.value)
        }
      } finally {
        reader.releaseLock()
      }
    },
  }
  let status = 200
  let body: string | undefined
  const outgoing = new Headers()
  try {
    await runtime.handle(incoming, {
      setHeader: (key, value) => outgoing.set(key, value),
      writeHead: (value, values) => {
        status = value
        for (const [key, text] of Object.entries(values ?? {})) outgoing.set(key, text)
      },
      end: value => {
        body = value
      },
    })
    return new Response(body, { status, headers: outgoing })
  } finally {
    await runtime.close()
  }
}
