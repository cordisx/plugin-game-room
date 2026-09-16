import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import type { HttpConnectionV1, HttpRequestV1 } from '@cordisx/protocol/plugin-http/v1'
import type { HttpClientV2, HttpSessionScopeV2 } from '@cordisx/protocol/plugin-http/v2'
import type { HttpClientV3 } from '@cordisx/protocol/plugin-http/v3'
import { createGameServer } from '../../server/http.js'
import { game } from '../../tests/server/helpers.js'
import { HostHttpTransport } from '../src/data/host-http.js'
import { LivePort } from '../src/data/live-restored.js'
import { consentFor } from '../src/data/model.js'

/** In-memory Host fixture only: tokens remain behind the public client interface.
 * Actual Keychain/Native account enforcement is verified separately by the Host owner. */
async function fixture(t: TestContext) {
  let now = 1_000_000
  const app = createGameServer({ now: () => now, tickMs: 0 })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  t.after(() => app.close())
  const address = app.server.address() as { port: number }
  const origin = `http://127.0.0.1:${address.port}`
  const source = { id: app.store.serverId, name: 'Fixture', url: origin, accountId: '', enabled: true }
  const saved = new Map<string, string>()
  let unavailable = false
  let network = false
  let exchanges = 0
  let forgets = 0
  let sequence = 0
  const scopeKey = (scope: HttpSessionScopeV2) => JSON.stringify([scope.origin, scope.sourceId, scope.accountId])
  const createClient = (): HttpClientV2 => {
    const grants = new Map<string, { connection: HttpConnectionV1; token?: string; scope?: string }>()
    const grant = (token?: string) => {
      const connection: HttpConnectionV1 = {
        contract: 'cordisx.http-connection/v1',
        id: `grant-${++sequence}`,
        origin,
        credential: token ? 'bearer' : 'none',
      }
      grants.set(connection.id, { connection, token })
      return connection
    }
    const request = async (input: HttpRequestV1) => {
      if (network) return { status: 'unavailable' as const, code: 'network-error' as const }
      const owned = grants.get(input.connection.id)
      if (!owned) return { status: 'unavailable' as const, code: 'connection-unavailable' as const }
      const response = await fetch(origin + input.path, {
        method: input.method,
        signal: input.signal,
        headers: { ...input.headers, ...(owned.token ? { authorization: `Bearer ${owned.token}` } : {}) },
        ...(input.body === undefined ? {} : { body: input.body }),
      })
      return {
        status: 'accepted' as const,
        value: {
          statusCode: response.status,
          contentType: response.headers.get('content-type'),
          body: await response.text(),
        },
      }
    }
    return {
      contract: 'cordisx.http-client/v2',
      async authorize() {
        return { status: 'accepted', value: grant() }
      },
      request,
      async exchange(input) {
        exchanges++
        const response = await request({ ...input, method: 'POST' })
        if (response.status !== 'accepted') return response
        const body = JSON.parse(response.value.body)
        const token = body[input.credentialField]
        delete body[input.credentialField]
        return {
          status: 'accepted',
          value: {
            connection: grant(token),
            response: { ...response.value, body: JSON.stringify(body) },
          },
        }
      },
      async retain(connection, scope) {
        const owned = grants.get(connection.id)
        if (!owned?.token || unavailable) return { status: 'unavailable', code: 'credential-unavailable' }
        owned.scope = scopeKey({ ...scope, origin: connection.origin })
        saved.set(owned.scope, owned.token)
        return { status: 'accepted', value: null }
      },
      async resume(scope) {
        if (unavailable) return { status: 'unavailable', code: 'credential-unavailable' }
        const token = saved.get(scopeKey(scope))
        if (!token) return { status: 'accepted', value: null }
        const connection = grant(token)
        grants.get(connection.id)!.scope = scopeKey(scope)
        return { status: 'accepted', value: connection }
      },
      async forget(scope) {
        forgets++
        saved.delete(scopeKey(scope))
        return { status: 'accepted', value: null }
      },
      async revoke(connection) {
        const owned = grants.get(connection.id)
        if (owned?.scope && saved.get(owned.scope) === owned.token) saved.delete(owned.scope)
        grants.delete(connection.id)
        return { status: 'accepted', value: null }
      },
      dispose() {
        grants.clear()
      },
    }
  }
  return {
    app,
    source,
    createClient,
    saved,
    now: () => now,
    exchanges: () => exchanges,
    forgets: () => forgets,
    network: (value: boolean) => {
      network = value
    },
    unavailable: (value: boolean) => {
      unavailable = value
    },
    expire: () => {
      now += 30 * 86_400_000
    },
  }
}

test('replacing transport and LivePort restores the original guest, room, self-seat and owner start', async t => {
  const f = await fixture(t)
  const signal = new AbortController().signal
  let transport = new HostHttpTransport(f.createClient())
  await Promise.all([transport.connectGuest(f.source, signal), transport.connectGuest(f.source, signal)])
  assert.equal(f.exchanges(), 1)
  const me = await transport.request({ source: f.source, path: '/v1/me', authenticated: true, signal }) as any
  const meta = await transport.request({
    source: f.source,
    path: '/v1/packages',
    method: 'POST',
    body: game(),
    authenticated: true,
    signal,
  }) as any
  let port = new LivePort([f.source], transport)
  await port.list(f.source, signal)
  const invitation = await port.create(f.source.id, {
    name: 'Restore fixture',
    gameId: 'test-game',
    gameVersion: '1.0.0',
    packageHash: meta.hash,
    mode: 'score',
    stake: 0,
    allowAgents: false,
  }, signal)
  const original = await f.app.engine.load(invitation.roomId)
  assert.equal(original.creatorAccountId, me.account.id)
  const seatId = original.seats[0]!.id
  await port.dispose()
  assert.equal(f.saved.size, 1)
  transport = new HostHttpTransport(f.createClient())
  port = new LivePort([f.source], transport)
  const listed = await port.list(f.source, signal)
  assert.equal(listed.rooms.length, 1)
  assert.equal(listed.rooms[0]!.owned, true)
  assert.equal(f.exchanges(), 1)
  const restored = await port.join(invitation, signal)
  assert.equal(restored.seatId, seatId)
  assert.equal(restored.canManageBots, true)
  const other = await f.app.accounts.guest()
  await f.app.engine.serial(() => f.app.engine.join(other.account, original.id))
  await f.app.engine.serial(() => f.app.engine.ready(other.account, original.id, true))
  const current = await port.refreshSeat(restored, signal)
  const ready = await port.ready(current, true, consentFor(current.room), signal)
  assert.equal(ready.canStart, true)
  const started = await port.start(ready, signal)
  assert.equal(started.status, 'playing')
  assert.equal((await f.app.engine.all()).length, 1)
  assert.equal((await f.app.engine.load(original.id)).creatorAccountId, me.account.id)
  await port.dispose()
})

test('network or unavailable secure storage never creates a replacement; source/account scopes do not resume another session', async t => {
  const f = await fixture(t)
  const signal = new AbortController().signal
  let transport = new HostHttpTransport(f.createClient())
  await transport.connectGuest(f.source, signal)
  await transport.dispose()
  transport = new HostHttpTransport(f.createClient())
  f.network(true)
  await assert.rejects(transport.connectGuest(f.source, signal), /network-error/)
  assert.equal(f.exchanges(), 1)
  assert.equal(f.saved.size, 1)
  f.network(false)
  f.unavailable(true)
  const closed = new HostHttpTransport(f.createClient())
  await assert.rejects(closed.connectGuest(f.source, signal), /credential-unavailable/)
  assert.equal(f.exchanges(), 1)
  f.unavailable(false)
  assert.equal(await closed.restoreSession({ ...f.source, id: 'another-source' }, signal), undefined)
  assert.equal(await closed.restoreSession({ ...f.source, accountId: 'another-account' }, signal), undefined)
  assert.equal(await closed.restoreSession({ ...f.source, url: 'http://127.0.0.1:8794' }, signal), undefined)
  assert.ok(await transport.restoreSession(f.source, signal))
  assert.equal(f.forgets(), 0)
  await transport.dispose()
  await closed.dispose()
})

test('expiry forgets an invalid saved session; explicit logout revokes server token and forgets without changing owner', async t => {
  const f = await fixture(t)
  const signal = new AbortController().signal
  let transport = new HostHttpTransport(f.createClient())
  await transport.connectGuest(f.source, signal)
  f.expire()
  assert.equal(await transport.restoreSession(f.source, signal), undefined)
  assert.equal(f.saved.size, 0)
  assert.equal(f.forgets(), 1)
  assert.equal(f.exchanges(), 1)
  await transport.connectGuest(f.source, signal)
  assert.equal(f.exchanges(), 2)
  const sessions = () =>
    (f.app.store.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires>?').get(f.now()) as { count: number })
      .count
  assert.equal(sessions(), 1)
  await transport.dispose()
  transport = new HostHttpTransport(f.createClient())
  const port = new LivePort([f.source], transport)
  await port.list(f.source, signal)
  assert.equal(port.isConnected(f.source.id), true)
  await port.disconnect(f.source.id)
  assert.equal(port.isConnected(f.source.id), false)
  assert.equal(f.saved.size, 0)
  assert.equal(sessions(), 0)
  assert.equal(await transport.restoreSession(f.source, signal), undefined)
  assert.equal(f.exchanges(), 2)
  await port.dispose()
})

test('a retired live grant keeps the saved token and resumes on the next attempt without another guest', async t => {
  const f = await fixture(t)
  const signal = new AbortController().signal
  const client = f.createClient()
  const transport = new HostHttpTransport(client)
  await transport.connectGuest(f.source, signal)
  client.dispose()
  await assert.rejects(transport.connectGuest(f.source, signal), {
    code: 'session_unavailable',
    outcome: 'rejected',
    message: '连接已失效，请重新连接此来源',
  })
  assert.equal(f.saved.size, 1)
  assert.equal(f.forgets(), 0)
  assert.ok(await transport.restoreSession(f.source, signal))
  assert.equal(f.exchanges(), 1)
  await transport.dispose()
})

test('expiry observed during an owned request clears the LivePort identity as well as the retained token', async t => {
  const f = await fixture(t)
  const signal = new AbortController().signal
  const transport = new HostHttpTransport(f.createClient())
  await transport.connectGuest(f.source, signal)
  const port = new LivePort([f.source], transport)
  await port.list(f.source, signal)
  assert.equal(port.isConnected(f.source.id), true)
  f.expire()
  await assert.rejects(port.list(f.source, signal), /invalid_session/)
  assert.equal(port.isConnected(f.source.id), false)
  assert.equal(f.saved.size, 0)
  assert.equal(f.exchanges(), 1)
  await port.dispose()
})

test('fresh adapter rejects and forgets an expired provisional resume before explicit guest replacement', async t => {
  const f = await fixture(t)
  const signal = new AbortController().signal
  const first = new HostHttpTransport(f.createClient())
  await first.connectGuest(f.source, signal)
  await first.dispose()
  f.expire()
  const next = new HostHttpTransport(f.createClient())
  assert.equal(await next.restoreSession(f.source, signal), undefined)
  assert.equal(f.saved.size, 0)
  assert.equal(f.forgets(), 1)
  assert.equal(await next.restoreSession(f.source, signal), undefined)
  assert.equal(f.exchanges(), 1)
  await next.connectGuest(f.source, signal)
  assert.equal(f.exchanges(), 2)
  await next.dispose()
})

test('v3 preserves public retained session recovery without issuing another guest', async t => {
  const f = await fixture(t)
  const client = (): HttpClientV3 => ({
    ...f.createClient(),
    contract: 'cordisx.http-client/v3',
    async connectAccount() {
      throw new Error('Managed login is outside this persistence fixture')
    },
    async submitWorkUsage() {
      throw new Error('Work issuance is outside this persistence fixture')
    },
  })
  const signal = new AbortController().signal
  const original = new HostHttpTransport(client())
  await original.connectGuest(f.source, signal)
  const before = await original.request({ source: f.source, path: '/v1/me', authenticated: true, signal })
  await original.dispose()
  const replacement = new HostHttpTransport(client())
  t.after(() => replacement.dispose())
  assert.deepEqual(await replacement.restoreSession(f.source, signal), before)
  assert.equal(f.exchanges(), 1)
})
