import { type AccessPolicy, accessPolicy } from './access-policy.js'
import { ManagedAccountAuth, type ManagedAccountCodec, type ManagedAccountTrust } from './managed-auth.js'
import { DisplayProfiles } from './display-profile.js'
export interface IncomingMessage extends AsyncIterable<Buffer> {
  headers: Record<string, string | undefined>
  socket: { remoteAddress?: string }
  method?: string
  url?: string
}
export interface ServerResponse {
  setHeader(key: string, value: string): unknown
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(value?: string): unknown
}
import { spectate } from './spectate.js'
import type { GameStore } from './store-contract.js'
import { Accounts } from './accounts.js'
import { Packages } from './packages.js'
import { Engine } from './engine.js'
import { Grants } from './grants.js'
import { GameSpend } from './game-spend.js'
import { GameServiceKey, type GameServiceKeyConfig } from './game-service-key.js'
import { legacyRecovery } from './legacy-transactions.js'
import { ApiError, object, requireThat } from './errors.js'
import type { EconomyAdapter } from './economy.js'
import type { ActionRequest, Consent, CreateRoomRequest } from '../sdk/index.js'
export interface RuntimeOptions {
  store: GameStore
  walletSpend?: GameServiceKeyConfig
  requestDrivenTicks?: boolean
  rateLimit?: (address: string, auth: boolean) => Promise<void>
  managedAccount?: {
    trust: ManagedAccountTrust
    codec: ManagedAccountCodec
  }
  accessPolicy?: AccessPolicy
  requireLogin?: boolean
  economy?: EconomyAdapter
  now?: () => number
  allowedOrigins?: string[]
  tickMs?: number
}
export function createGameRuntime(options: RuntimeOptions) {
  const policy = accessPolicy(options)
  const now = options.now ?? Date.now
  const store = options.store
  const accounts = new Accounts(store, now)
  const managedAccount = options.managedAccount
    ? new ManagedAccountAuth(accounts, store, options.managedAccount.trust, options.managedAccount.codec, now)
    : undefined
  const profiles = new DisplayProfiles(store)
  const packages = new Packages(store)
  const spend = options.walletSpend
    ? new GameSpend(store, new GameServiceKey(options.walletSpend, store.serverId), now)
    : undefined
  const engine = new Engine(store, packages, options.economy, now, spend)
  const grants = new Grants(engine)
  const rates = new Map<string, {
    count: number
    until: number
  }>()
  async function rate(req: IncomingMessage, auth: boolean) {
    if (options.rateLimit) return options.rateLimit(req.socket.remoteAddress ?? 'unknown', auth)
    const key = (req.socket.remoteAddress ?? 'unknown') + (auth ? ':auth' : ':api')
    const current = rates.get(key)
    const limit = auth ? 15 : 600
    if (current && current.until > now()) {
      requireThat(++current.count <= limit, 'rate_limited', 429)
    } else {
      if (rates.size > 10000) {
        for (const [k, v] of rates) {
          if (v.until <= now()) {
            rates.delete(k)
          }
        }
      }
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
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
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
      await rate(
        req,
        parts[1] === 'auth' || parts[1] === 'accounts' || parts[1] === 'sessions' || parts[1] === 'guests',
      )
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      if (path === '/health' && method === 'GET') {
        json(res, 200, { ok: true })
        return
      }
      requireThat(parts[0] === 'v1', 'not_found', 404)
      if (path === '/v1/spend/identity' && method === 'GET') {
        requireThat(spend, 'wallet_spend_unavailable', 503)
        await spend.service.pin(store)
        json(res, 200, { contract: 'economy.spend-service/v1', ...spend.service.binding() })
        return
      }
      if (path === '/v1/handshake' && method === 'GET') {
        json(res, 200, {
          protocol: 'game-room/1',
          access: { guests: policy === 'guest-allowed', policy },
          ...(managedAccount
            ? { managedAccount: { contract: 'cordisx.managed-source/v1', binding: managedAccount.binding } }
            : {}),
          serverId: store.serverId,
          gamePackageVersion: 1,
          runtime: 'quickjs-wasm',
          uiFormats: ['scene-v1', 'html-v1'],
          rulesBots: ['rules-bot-v1'],
          seatManagement: ['targeted-bot-seats-v1'],
          displayProfiles: ['self-display-profile-v1'],
          modes: ['score', 'local-chips', 'token'],
          walletSpend: spend ? { contract: 'economy.spend/v1', ...spend.service.binding() } : null,
          economyAvailable: false,
          economy: null,
        })
        return
      }
      if (path === '/v1/auth/host/challenge' && method === 'GET') {
        requireThat(managedAccount, 'managed_auth_unavailable', 403)
        const entries = [...parsedUrl.searchParams]
        requireThat(
          entries.length === 3 && new Set(entries.map(([key]) => key)).size === 3,
          'managed_binding_mismatch',
          403,
        )
        json(res, 200, await managedAccount.challenge(Object.fromEntries(entries)))
        return
      }
      if (path === '/v1/auth/host/session' && method === 'POST') {
        requireThat(managedAccount, 'managed_auth_unavailable', 403)
        json(res, 200, await managedAccount.session(await body(req), token))
        return
      }
      if (path === '/v1/guests' && method === 'POST') {
        requireThat(policy === 'guest-allowed', 'login_required', 403)
        await body(req)
        json(res, 200, await accounts.guest())
        return
      }
      if ((path === '/v1/accounts' || path === '/v1/sessions') && method === 'POST') {
        const input = await body(req)
        json(
          res,
          200,
          path.endsWith('accounts')
            ? await accounts.register(input.name, input.password)
            : await accounts.login(input.name, input.password),
        )
        return
      }
      if (parts[1] === 'packages' && method === 'GET') {
        if (parts.length === 2) {
          json(res, 200, { packages: await packages.list() })
        } else if (parts.length === 3) {
          json(res, 200, await packages.metadata(parts[2]))
        } else if (parts.length === 4 && parts[3] === 'ui') {
          const ui = (await packages.get(parts[2])).ui
          res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
          res.setHeader('Content-Disposition', 'attachment; filename="game-ui.json"')
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          res.setHeader('ETag', `"${parts[2]}"`)
          json(res, 200, ui)
        } else {
          throw new ApiError(404, 'not_found')
        }
        return
      }
      if (path === '/v1/rooms' && method === 'GET') {
        json(res, 200, { rooms: await engine.list() })
        return
      }
      if (parts.length === 4 && parts[1] === 'rooms' && parts[3] === 'spectate' && method === 'GET') {
        if (policy === 'login-required') {
          requireThat(!(await accounts.authenticate(token)).guest, 'login_required', 403)
        }
        json(
          res,
          200,
          await engine.serial(async () => {
            if (options.requestDrivenTicks) await engine.catchUp(parts[2])
            return spectate(engine, parts[2])
          }),
        )
        return
      }
      if (parts[1] === 'agent') {
        const input = method === 'POST' ? await body(req) : {}
        const result = await engine.serial(async () => {
          if (path === '/v1/agent/revoke' && method === 'POST') {
            return await grants.selfRevoke(token)
          }
          const grant = await grants.authenticate(token)
          requireThat(policy === 'guest-allowed' || !await accounts.isGuest(grant.account_id), 'login_required', 403)
          if (options.requestDrivenTicks) await engine.catchUp(grant.room_id)
          if (path === '/v1/agent/observation' && method === 'GET') {
            return await engine.view(await engine.load(grant.room_id), grant.account_id, grant.seat_id)
          }
          if (path === '/v1/agent/actions' && method === 'POST') {
            return await engine.action(
              grant.account_id,
              grant.room_id,
              input as unknown as ActionRequest,
              async () => await grants.consume(grant),
              grant.seat_id,
            )
          }
          throw new ApiError(404, 'not_found')
        })
        json(res, 200, result)
        return
      }
      const account = await accounts.authenticate(token)
      if (path === '/v1/session' && method === 'DELETE') {
        await accounts.revoke(token!)
        json(res, 200, { revoked: true })
        return
      }
      requireThat(policy === 'guest-allowed' || !account.guest, 'login_required', 403)
      if (path.startsWith('/v1/wallet-bindings')) {
        requireThat(!account.guest, 'login_required', 403)
        requireThat(spend, 'wallet_spend_unavailable', 503)
        if (path === '/v1/wallet-bindings/challenge' && method === 'POST') {
          json(res, 200, await spend.challenge(account))
          return
        }
        if (path === '/v1/wallet-bindings' && method === 'GET') {
          json(res, 200, { binding: await spend.wallet(account.id) ?? null })
          return
        }
        if (path === '/v1/wallet-bindings' && method === 'POST') {
          json(res, 200, { binding: await spend.bind(account, await body(req)) })
          return
        }
        throw new ApiError(404, 'not_found')
      }
      if (path === '/v1/me/spend-transactions' && method === 'GET') {
        requireThat(spend && !account.guest, 'wallet_spend_unavailable', 503)
        json(res, 200, { transactions: await spend.transactions(account.id) })
        return
      }
      if (parts.length === 4 && parts[1] === 'spend' && parts[2] === 'transactions' && method === 'GET') {
        requireThat(spend && !account.guest, 'wallet_spend_unavailable', 503)
        json(res, 200, await spend.ownedTransaction(account.id, parts[3]))
        return
      }
      if (path === '/v1/me' && method === 'GET') {
        json(res, 200, { account: { ...account, ...await profiles.read(account.id) } })
        return
      }
      if (path === '/v1/me/profile' && method === 'POST') {
        json(res, 200, { profile: await profiles.update(account.id, await body(req)) })
        return
      }
      if (path === '/v1/me/rooms' && method === 'GET') {
        json(res, 200, { rooms: await engine.list(account.id) })
        return
      }
      const input = method === 'POST' ? await body(req) : {}
      const result = await engine.serial(async () => {
        if (path === '/v1/packages' && method === 'POST') {
          return await packages.publish(account.id, input)
        }
        if (path === '/v1/economy/link' && method === 'POST') {
          requireThat(!Object.hasOwn(input, 'token'), 'link_proof_required')
          return await engine.linkEconomy(account, input.code)
        }
        if (path === '/v1/rooms' && method === 'POST') {
          return await engine.create(account, input as unknown as CreateRoomRequest)
        }
        if (parts[1] === 'rooms' && parts[2]) {
          const id = parts[2]
          if (options.requestDrivenTicks) await engine.catchUp(id)
          const op = parts[3]
          if (parts.length === 4 && op === 'spend' && method === 'GET') return engine.spendState(account, id)
          if (parts.length === 4 && op === 'spend-receipts' && method === 'POST') {
            return engine.reservation(account, id, input)
          }
          if (parts.length === 4 && op === 'spend-cancel' && method === 'POST') return engine.cancelSpend(account, id)
          if (parts.length === 4 && op === 'legacy-recovery' && method === 'GET') {
            const historical = await engine.load(id)
            engine.seat(historical, account.id, selectedSeat)
            return legacyRecovery(historical)
          }
          if (parts.length === 3 && method === 'GET') {
            return await engine.view(await engine.load(id), account.id, selectedSeat)
          }
          if (parts.length === 5 && op === 'agent-grants' && method === 'DELETE') {
            return await grants.revoke(account, id, parts[4])
          }
          requireThat(parts.length === 4, 'not_found', 404)
          if (method === 'GET' && op === 'replay') {
            return await engine.replay(account.id, id, selectedSeat)
          }
          if (method === 'POST') {
            if (op === 'join') {
              return await engine.join(account, id, input.consent as Consent | undefined)
            }
            if (op === 'close') return await engine.closeRoom(account, id)
            if (op === 'leave') {
              return await engine.leave(account, id, typeof input.seatId === 'string' ? input.seatId : undefined)
            }
            if (op === 'bots') {
              return await engine.bots(account, id, input)
            }
            if (op === 'agent-seats') {
              return await engine.agentSeat(account, id, input)
            }
            if (op === 'ready') {
              return await engine.ready(
                account,
                id,
                input.ready,
                input.consent as Consent | undefined,
                typeof input.seatId === 'string' ? input.seatId : undefined,
              )
            }
            if (op === 'start') {
              return await engine.start(account, id)
            }
            if (op === 'undo-resume') {
              return await engine.resumeUndo(account, id, input.expectedVersion)
            }
            if (op === 'next-match') {
              return await engine.nextMatch(account, id)
            }
            if (op === 'actions') {
              return await engine.action(account.id, id, input as unknown as ActionRequest)
            }
            if (op === 'agent-grants') {
              return await grants.create(account, id, input)
            }
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
  }
  return {
    handle,
    store,
    accounts,
    packages,
    engine,
    grants,
    async close() {
      engine.dispose()
      await engine.serial(async () => await store.close())
    },
  }
}
