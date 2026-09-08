import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Store } from './store.js'
import { Accounts } from './accounts.js'
import { Packages } from './packages.js'
import { Engine } from './engine.js'
import { Grants } from './grants.js'
import { ApiError, object, requireThat } from './errors.js'
import type { EconomyAdapter } from './economy.js'
import type { ActionRequest, Consent, CreateRoomRequest } from '../sdk/index.js'
export interface ServerOptions {
  database?: string
  economy?: EconomyAdapter
  now?: () => number
  allowedOrigins?: string[]
  tickMs?: number
}
export function createGameServer(options: ServerOptions = {}) {
  const now = options.now ?? Date.now
  const store = new Store(options.database ?? ':memory:')
  const accounts = new Accounts(store, now)
  const packages = new Packages(store)
  const engine = new Engine(store, packages, options.economy, now)
  const grants = new Grants(engine)
  const rates = new Map<string, { count: number; until: number }>()
  function rate(req: IncomingMessage, auth: boolean) {
    const key = (req.socket.remoteAddress ?? 'unknown') + (auth ? ':auth' : ':api')
    const current = rates.get(key)
    const limit = auth ? 15 : 600
    if (current && current.until > now()) requireThat(++current.count <= limit, 'rate_limited', 429)
    else {
      if (rates.size > 10000) { for (const [k, v] of rates) if (v.until <= now()) rates.delete(k) }
      rates.set(key, { count: 1, until: now() + 60000 })
    }
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    requireThat((req.headers['content-type'] ?? '').split(';')[0] === 'application/json', 'json_required', 415)
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      requireThat(size <= 600 * 1024, 'body_too_large', 413)
      chunks.push(chunk)
    }
    let value: unknown
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new ApiError(400, 'invalid_json')
    }
    object(value)
    return value
  }
  function json(res: ServerResponse, status: number, value: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(value))
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    try {
      const origin = req.headers.origin
      if (origin) {
        requireThat(options.allowedOrigins?.includes(origin), 'origin_not_allowed', 403)
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type')
        res.writeHead(204)
        res.end()
        return
      }
      const parsedUrl = new URL(req.url!, 'http://localhost')
      const path = parsedUrl.pathname
      const selectedSeat = parsedUrl.searchParams.get('seatId') ?? undefined
      const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
      const method = req.method
      rate(req, parts[1] === 'accounts' || parts[1] === 'sessions')
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      if (path === '/health' && method === 'GET') {
        json(res, 200, { ok: true })
        return
      }
      requireThat(parts[0] === 'v1', 'not_found', 404)
      if (path === '/v1/handshake' && method === 'GET') {
        json(res, 200, {
          protocol: 'game-room/1',
          serverId: store.serverId,
          gamePackageVersion: 1,
          runtime: 'quickjs-wasm',
          modes: ['score', 'local-chips', 'token'],
          economyAvailable: !!options.economy,
          economy: options.economy
            ? {
              url: options.economy.url,
              gameServiceId: options.economy.serviceId,
              instanceId: engine.economyIdentity()?.instanceId ?? null,
            }
            : null,
        })
        return
      }
      if ((path === '/v1/accounts' || path === '/v1/sessions') && method === 'POST') {
        const input = await body(req)
        json(
          res,
          200,
          path.endsWith('accounts')
            ? accounts.register(input.name, input.password)
            : accounts.login(input.name, input.password),
        )
        return
      }
      if (parts[1] === 'packages' && method === 'GET') {
        if (parts.length === 2) json(res, 200, { packages: packages.list() })
        else if (parts.length === 3) json(res, 200, packages.metadata(parts[2]))
        else if (parts.length === 4 && parts[3] === 'ui') {
          const html = packages.get(parts[2]).ui.html
          res.setHeader(
            'Content-Security-Policy',
            "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'",
          )
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          res.setHeader('ETag', `"${parts[2]}"`)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(html)
        } else throw new ApiError(404, 'not_found')
        return
      }
      if (path === '/v1/rooms' && method === 'GET') {
        json(res, 200, { rooms: engine.list() })
        return
      }
      if (parts[1] === 'agent') {
        const input = method === 'POST' ? await body(req) : {}
        const result = await engine.serial(async () => {
          if (path === '/v1/agent/revoke' && method === 'POST') return grants.selfRevoke(token)
          const grant = grants.authenticate(token)
          if (path === '/v1/agent/observation' && method === 'GET') {
            return engine.view(engine.load(grant.room_id), grant.account_id, grant.seat_id)
          }
          if (path === '/v1/agent/actions' && method === 'POST') {
            return engine.action(
              grant.account_id,
              grant.room_id,
              input as unknown as ActionRequest,
              () => grants.consume(grant),
              grant.seat_id,
            )
          }
          throw new ApiError(404, 'not_found')
        })
        json(res, 200, result)
        return
      }
      const account = accounts.authenticate(token)
      if (path === '/v1/me' && method === 'GET') {
        json(res, 200, { account })
        return
      }
      if (path === '/v1/me/rooms' && method === 'GET') {
        json(res, 200, { rooms: engine.list(account.id) })
        return
      }
      if (path === '/v1/session' && method === 'DELETE') {
        accounts.revoke(token!)
        json(res, 200, { revoked: true })
        return
      }
      const input = method === 'POST' ? await body(req) : {}
      const result = await engine.serial(async () => {
        if (path === '/v1/packages' && method === 'POST') return packages.publish(account.id, input)
        if (path === '/v1/economy/link' && method === 'POST') {
          requireThat(!Object.hasOwn(input, 'token'), 'link_proof_required')
          return engine.linkEconomy(account, input.code)
        }
        if (path === '/v1/rooms' && method === 'POST') {
          return engine.create(account, input as unknown as CreateRoomRequest)
        }
        if (parts[1] === 'rooms' && parts[2]) {
          const id = parts[2]
          const op = parts[3]
          if (parts.length === 3 && method === 'GET') return engine.view(engine.load(id), account.id, selectedSeat)
          if (parts.length === 5 && op === 'agent-grants' && method === 'DELETE') {
            return grants.revoke(account, id, parts[4])
          }
          requireThat(parts.length === 4, 'not_found', 404)
          if (method === 'GET' && op === 'replay') return engine.replay(account.id, id, selectedSeat)
          if (method === 'POST') {
            if (op === 'join') return engine.join(account, id, input.consent as Consent | undefined)
            if (op === 'leave') {
              return engine.leave(account, id, typeof input.seatId === 'string' ? input.seatId : undefined)
            }
            if (op === 'agent-seats') return engine.agentSeat(account, id, input)
            if (op === 'ready') {
              return engine.ready(
                account,
                id,
                input.ready,
                input.consent as Consent | undefined,
                typeof input.seatId === 'string' ? input.seatId : undefined,
              )
            }
            if (op === 'start') return engine.start(account, id)
            if (op === 'next-match') return engine.nextMatch(account, id)
            if (op === 'actions') return engine.action(account.id, id, input as unknown as ActionRequest)
            if (op === 'agent-grants') return grants.create(account, id, input)
          }
        }
        throw new ApiError(404, 'not_found')
      })
      json(res, 200, result)
    } catch (error) {
      const known = error instanceof ApiError
      json(res, known ? error.status : 500, {
        error: {
          code: known ? error.code : 'internal_error',
          message: known ? error.message : 'Internal server error',
        },
      })
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  server.timeout = 15000
  server.maxHeadersCount = 50
  let tickQueued = false
  const interval = options.tickMs === 0 ? null : setInterval(() => {
    if (tickQueued) return
    tickQueued = true
    void engine.serial(() => engine.tick()).catch(() => {}).finally(() => {
      tickQueued = false
    })
  }, options.tickMs ?? 1000)
  interval?.unref()
  return {
    server,
    store,
    accounts,
    packages,
    engine,
    grants,
    async close() {
      if (interval) clearInterval(interval)
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close(e => e && (e as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(e) : resolve())
      )
      await engine.serial(async () => store.close())
    },
  }
}
