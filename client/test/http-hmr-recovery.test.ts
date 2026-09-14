import assert from 'node:assert/strict'
import test from 'node:test'
import type { HttpClientV2 } from '@cordisx/protocol/plugin-http/v2'
import type { HttpConnectionV1, HttpRequestV1 } from '@cordisx/protocol/plugin-http/v1'
import { HostHttpTransport } from '../src/data/host-http.js'
const source = { id: 'game', name: 'Game', url: 'https://game.example', accountId: '', enabled: true }
const signal = () => new AbortController().signal
const accepted = (body: unknown) => ({
  status: 'accepted' as const,
  value: { statusCode: 200, contentType: 'application/json', body: JSON.stringify(body) },
})
function fixture() {
  let sequence = 0
  let authorizes = 0
  let resumes = 0
  let forgets = 0
  let closes = 0
  let exchanges = 0
  let retains = 0
  let retainWait: Promise<void> | undefined
  let guestExchange = false
  let guestGrant: string | undefined
  let saved = false
  let account = 'wallet'
  let instance = 'instance'
  let invalid = false
  let network = false
  let alwaysStale = false
  let openFails = false
  let openWait: Promise<void> | undefined
  let revokeWait: Promise<void> | undefined
  let requestWait: Promise<void> | undefined
  let meWait: Promise<void> | undefined
  const grants = new Map<string, HttpConnectionV1>()
  const requests: HttpRequestV1[] = []
  function grant(origin: string, credential: 'none' | 'bearer') {
    const c: HttpConnectionV1 = {
      contract: 'cordisx.http-connection/v1',
      id: `grant-${++sequence}`,
      origin,
      credential,
    }
    grants.set(c.id, c)
    return c
  }
  const client: HttpClientV2 = {
    contract: 'cordisx.http-client/v2',
    async authorize({ origin, credential }) {
      authorizes++
      await openWait
      if (openFails) return { status: 'unavailable', code: 'stale-generation' }
      return { status: 'accepted', value: grant(origin, credential) }
    },
    async resume(scope) {
      resumes++
      if (!saved) return { status: 'accepted', value: null }
      return { status: 'accepted', value: grant(scope.origin, 'bearer') }
    },
    async retain() {
      retains++
      await retainWait
      saved = true
      return { status: 'accepted', value: null }
    },
    async forget() {
      forgets++
      saved = false
      return { status: 'accepted', value: null }
    },
    async revoke(c) {
      await revokeWait
      grants.delete(c.id)
      return { status: 'accepted', value: null }
    },
    async exchange(input) {
      exchanges++
      if (guestExchange) {
        const connection = grant(input.connection.origin, 'bearer')
        guestGrant = connection.id
        return { status: 'accepted', value: { connection, response: accepted({ account: { guest: true } }).value } }
      }
      return { status: 'unavailable', code: 'unsupported' }
    },
    async request(input) {
      requests.push(input)
      const stale = !grants.has(input.connection.id)
      const responseAccount = account
      const responseInstance = instance
      await requestWait
      if (input.path === '/v1/me' && !stale) await meWait
      if (network) return { status: 'unavailable', code: 'network-error' }
      if (stale || alwaysStale) return { status: 'unavailable', code: 'connection-unavailable' }
      if (invalid) {
        return {
          status: 'accepted',
          value: {
            statusCode: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'invalid_session' } }),
          },
        }
      }
      if (input.path === '/v1/me') {
        return accepted({ instanceId: responseInstance, accountId: responseAccount, available: 1000, reserved: 0 })
      }
      if (input.path === '/v1/ledger') return accepted([])
      return accepted({ ok: true })
    },
    dispose() {
      closes++
      grants.clear()
    },
  }
  return {
    client,
    requests,
    grantIds: () => [...grants.keys()],
    waitMe: (v?: Promise<void>) => {
      meWait = v
    },
    counts: () => ({ authorizes, resumes, forgets, closes, exchanges, retains }),
    retire: () => grants.clear(),
    waitRetain: (wait?: Promise<void>) => {
      retainWait = wait
    },
    allowGuestExchange: () => {
      guestExchange = true
    },
    guestGrant: () => guestGrant,
    invalid: (v: boolean) => {
      invalid = v
    },
    network: (v: boolean) => {
      network = v
    },
    alwaysStale: () => {
      alwaysStale = true
    },
    openFails: () => {
      openFails = true
    },
    waitOpen: (v?: Promise<void>) => {
      openWait = v
    },
    waitRevoke: (v?: Promise<void>) => {
      revokeWait = v
    },
    waitRequest: (v?: Promise<void>) => {
      requestWait = v
    },
    identity: (a: string, i = 'instance') => {
      account = a
      instance = i
    },
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}
test('parallel stale public GETs share one new grant and keep each original deadline', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.prepare(source, signal())
  f.retire()
  const wait = deferred()
  f.waitOpen(wait.promise)
  const reads = Array.from({ length: 5 }, () => t.request({ source, path: '/rooms', signal: signal() }))
  await new Promise(r => setImmediate(r))
  assert.equal(f.counts().authorizes, 2)
  wait.resolve()
  await Promise.all(reads)
  assert.equal(f.requests.length, 10)
  assert.equal(f.counts().authorizes, 2)
  for (let i = 0; i < 5; i++) assert.equal(f.requests[i].deadline, f.requests[i + 5].deadline)
})
test('repeated grant loss and failed reopen stop without replaying indefinitely', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.prepare(source, signal())
  f.alwaysStale()
  await assert.rejects(t.request({ source, path: '/rooms', signal: signal() }), /connection-unavailable/)
  assert.equal(f.requests.length, 2)
  assert.equal(f.counts().authorizes, 2)
  const g = fixture()
  const u = new HostHttpTransport(g.client)
  await u.prepare(source, signal())
  g.retire()
  g.openFails()
  await assert.rejects(u.request({ source, path: '/rooms', signal: signal() }), /stale-generation/)
  assert.equal(g.requests.length, 1)
  assert.equal(g.counts().authorizes, 2)
})
test('mutations are never replayed and network errors do not evict a valid grant', async () => {
  for (const method of ['POST', 'DELETE'] as const) {
    const f = fixture()
    const t = new HostHttpTransport(f.client)
    await t.prepare(source, signal())
    f.retire()
    await assert.rejects(
      t.request({ source, path: '/orders', method, body: {}, signal: signal() }),
      /connection-unavailable/,
    )
    assert.equal(f.requests.length, 1)
    assert.equal(f.counts().authorizes, 1)
  }
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.prepare(source, signal())
  f.network(true)
  await assert.rejects(t.request({ source, path: '/rooms', signal: signal() }), /network-error/)
  f.network(false)
  await t.request({ source, path: '/rooms', signal: signal() })
  assert.equal(f.counts().authorizes, 1)
  assert.equal(f.counts().forgets, 0)
})
test('a late stale result cannot evict a concurrent replacement connection', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.prepare(source, signal())
  f.retire()
  const wait = deferred()
  f.waitRequest(wait.promise)
  const read = t.request({ source, path: '/rooms', signal: signal() })
  await new Promise(r => setImmediate(r))
  await t.connect(source, 'none')
  f.waitRequest()
  wait.resolve()
  await read
  assert.equal(f.counts().authorizes, 2)
  assert.equal(f.requests[1].connection.id, 'grant-2')
})
test('aborted GET does not make the second request after a pending reopen', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.prepare(source, signal())
  f.retire()
  const wait = deferred()
  f.waitOpen(wait.promise)
  const controller = new AbortController()
  const read = t.request({ source, path: '/rooms', signal: controller.signal })
  await new Promise(r => setImmediate(r))
  controller.abort()
  wait.resolve()
  await assert.rejects(read, /abort/i)
  assert.equal(f.requests.length, 1)
})
test('old cleanup revokes its own transient grant without closing the borrowed replacement client', async () => {
  const f = fixture()
  const old = new HostHttpTransport(f.client)
  await old.prepare(source, signal())
  const wait = deferred()
  f.waitRevoke(wait.promise)
  const cleanup = old.dispose()
  const current = new HostHttpTransport(f.client)
  await current.prepare(source, signal())
  wait.resolve()
  await cleanup
  await assert.rejects(old.request({ source, path: '/rooms', signal: signal() }), /连接已关闭/)
  await current.request({ source, path: '/rooms', signal: signal() })
  assert.equal(f.counts().closes, 0)
  assert.equal(f.requests[0].connection.id, 'grant-2')
})
test('resumed account or instance drift stops before replaying ledger and preserves credentials', async () => {
  for (const [account, instance] of [['foreign', 'instance'], ['wallet', 'foreign']]) {
    const f = fixture()
    const t = new HostHttpTransport(f.client)
    await t.connect(source, 'bearer')
    await t.restoreSession(source, signal())
    f.retire()
    f.identity(account, instance)
    await assert.rejects(
      t.request({ source, path: '/v1/ledger', authenticated: true, signal: signal() }),
      /session_identity_changed/,
    )
    assert.equal(f.requests.filter(r => r.path === '/v1/ledger').length, 1)
    assert.equal(f.counts().resumes, 1)
    assert.equal(f.counts().forgets, 0)
    assert.equal(f.counts().exchanges, 0)
    const attempts = f.requests.length
    for (const method of ['GET', 'POST'] as const) {
      await assert.rejects(t.request({ source, path: '/orders', authenticated: true, method, signal: signal() }))
    }
    assert.equal(f.requests.length, attempts, 'rejected foreign grant cannot be used by subsequent reads or mutations')
  }
})

test('explicit invalid authentication clears its identity pin while retired grants never forget it', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.connect(source, 'bearer')
  await t.restoreSession(source, signal())
  f.invalid(true)
  await assert.rejects(t.request({ source, path: '/v1/me', authenticated: true, signal: signal() }), /invalid_session/)
  assert.equal(f.counts().forgets, 1)
  f.invalid(false)
  f.identity('explicit-new-account')
  await t.connect(source, 'bearer')
  await t.restoreSession(source, signal())
  assert.equal(f.counts().resumes, 0)
})

test('unvalidated resumed grant is not available to concurrent GET or POST', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.connect(source, 'bearer')
  await t.restoreSession(source, signal())
  f.retire()
  await assert.rejects(
    t.request({ source, path: '/orders', method: 'POST', authenticated: true, signal: signal() }),
    /session_unavailable/,
  )
  f.identity('foreign')
  const wait = deferred()
  f.waitMe(wait.promise)
  const restore = t.restoreSession(source, signal())
  await new Promise(r => setImmediate(r))
  const attempts = f.requests.length
  for (const method of ['GET', 'POST'] as const) {
    await assert.rejects(t.request({ source, path: '/orders', method, authenticated: true, signal: signal() }))
  }
  assert.equal(f.requests.length, attempts)
  wait.resolve()
  await assert.rejects(restore, /session_identity_changed/)
  assert.equal(f.counts().forgets, 0)
})
test('dispose during replacement old-revoke retires the newly issued transient grant exactly', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.prepare(source, signal())
  const wait = deferred()
  f.waitRevoke(wait.promise)
  const replacement = t.connect(source, 'none')
  await new Promise(r => setImmediate(r))
  await t.dispose()
  wait.resolve()
  await assert.rejects(replacement, /连接已关闭/)
  assert.deepEqual(f.grantIds(), [])
  assert.equal(f.counts().closes, 0)
})
test('explicit logout resets identity for legitimate newly authorized account', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.connect(source, 'bearer')
  await t.restoreSession(source, signal())
  await t.disconnect(source)
  f.identity('explicit-new-account')
  await t.connect(source, 'bearer')
  await t.restoreSession(source, signal())
  assert.equal(f.counts().forgets, 1)
  assert.equal(f.counts().closes, 0)
})

test('provisional expired retained session is forgotten once and subsequent resume is empty', async () => {
  const f = fixture()
  const first = new HostHttpTransport(f.client)
  await first.connect(source, 'bearer')
  await first.dispose()
  f.invalid(true)
  const next = new HostHttpTransport(f.client)
  assert.equal(await next.restoreSession(source, signal()), undefined)
  assert.equal(f.counts().forgets, 1)
  assert.equal(await next.restoreSession(source, signal()), undefined)
  assert.equal(f.counts().forgets, 1)
})
test('old provisional identity reply cannot pin or forget a newly authorized account', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.connect(source, 'bearer')
  await t.restoreSession(source, signal())
  f.retire()
  await assert.rejects(t.restoreSession(source, signal()), /session_unavailable/)
  const held = deferred()
  f.waitMe(held.promise)
  const old = t.restoreSession(source, signal())
  const rejected = assert.rejects(old, /授权已被替换/)
  while (f.counts().resumes === 0 || f.requests.length < 3) await new Promise(resolve => setImmediate(resolve))
  f.waitMe()
  await t.connect(source, 'bearer')
  f.identity('new-wallet')
  assert.equal((await t.restoreSession(source, signal()) as { accountId: string }).accountId, 'new-wallet')
  held.resolve()
  await rejected
  assert.equal((await t.restoreSession(source, signal()) as { accountId: string }).accountId, 'new-wallet')
  assert.equal(f.counts().forgets, 0)
})
test('one canceled recovery waiter does not cancel a second valid waiter or duplicate me validation', async () => {
  const f = fixture()
  const first = new HostHttpTransport(f.client)
  await first.connect(source, 'bearer')
  await first.dispose()
  const t = new HostHttpTransport(f.client)
  const held = deferred()
  f.waitMe(held.promise)
  const controller = new AbortController()
  const canceled = t.restoreSession(source, controller.signal)
  const valid = t.restoreSession(source, signal())
  const rejected = assert.rejects(canceled)
  controller.abort()
  await rejected
  held.resolve()
  assert.equal((await valid as { accountId: string }).accountId, 'wallet')
  assert.equal(f.counts().resumes, 1)
  assert.equal(f.requests.filter(r => r.path === '/v1/me').length, 1)
})

test('logout cleanup held on public revoke cannot delete a new bearer authorization', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.connect(source, 'none')
  await t.connect(source, 'bearer')
  const held = deferred()
  f.waitRevoke(held.promise)
  const logout = t.disconnect(source)
  while (f.counts().forgets === 0) await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  f.waitRevoke()
  await t.connect(source, 'bearer')
  f.identity('new-wallet')
  const newGrant = f.grantIds().at(-1)
  held.resolve()
  await logout
  assert.ok(f.grantIds().includes(newGrant!))
  assert.equal((await t.restoreSession(source, signal()) as { accountId: string }).accountId, 'new-wallet')
  assert.equal(f.counts().forgets, 1)
})
test('replaced authorization held on old revoke cleans its new unretained grant', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.connect(source, 'bearer')
  const held = deferred()
  f.waitRevoke(held.promise)
  const old = t.connect(source, 'bearer')
  const rejected = assert.rejects(old, /授权已被替换/)
  while (f.counts().authorizes < 2 || f.grantIds().length < 2) await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  f.waitRevoke()
  await t.connect(source, 'bearer')
  const current = f.grantIds().at(-1)
  held.resolve()
  await rejected
  assert.deepEqual(f.grantIds(), [current])
  assert.equal(f.counts().forgets, 0)
})
test('canceling a public GET settles while shared reopening remains held for another caller', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  await t.prepare(source, signal())
  f.retire()
  const held = deferred()
  f.waitOpen(held.promise)
  const controller = new AbortController()
  const canceled = t.request({ source, path: '/v1/rooms', signal: controller.signal })
  const rejected = assert.rejects(canceled)
  const valid = t.request({ source, path: '/v1/rooms', signal: signal() })
  while (f.counts().authorizes < 2) await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  const settled = await Promise.race([
    rejected.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 100)),
  ])
  assert.equal(settled, true)
  held.resolve()
  assert.deepEqual(await valid, { ok: true })
  assert.equal(f.counts().authorizes, 2)
})
test('already elapsed caller deadline rejects even immediate shared recovery value', async () => {
  const f = fixture()
  const first = new HostHttpTransport(f.client)
  await first.connect(source, 'bearer')
  await first.dispose()
  const t = new HostHttpTransport(f.client)
  await assert.rejects(t.restoreSession(source, signal(), Date.now() - 1), /超时/)
})

test('shared validation expires before a longer caller deadline and late response cannot promote', async () => {
  const f = fixture()
  const first = new HostHttpTransport(f.client)
  await first.connect(source, 'bearer')
  await first.dispose()
  const t = new HostHttpTransport(f.client)
  const held = deferred()
  f.waitMe(held.promise)
  const pending = t.restoreSession(source, signal(), Date.now() + 60000)
  await assert.rejects(pending, /超时/)
  assert.equal(f.counts().resumes, 1)
  f.waitMe()
  assert.equal((await t.restoreSession(source, signal()) as { accountId: string }).accountId, 'wallet')
  assert.equal(f.counts().resumes, 2)
  held.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await t.restoreSession(source, signal()) as { accountId: string }).accountId, 'wallet')
  assert.equal(f.counts().forgets, 0)
})

test('guest grant rejected behind a retained-storage queue is revoked without clearing later bearer scope', async () => {
  const f = fixture()
  const t = new HostHttpTransport(f.client)
  const held = deferred()
  f.waitRetain(held.promise)
  const first = t.connect(source, 'bearer')
  const firstRejected = assert.rejects(first, /授权已被替换/)
  while (f.counts().retains === 0) await new Promise(resolve => setImmediate(resolve))
  f.allowGuestExchange()
  const guest = t.connectGuest(source, signal())
  const guestRejected = assert.rejects(guest, /授权已被替换/)
  while (!f.guestGrant()) await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  f.waitRetain()
  const replacement = t.connect(source, 'bearer')
  held.resolve()
  await Promise.all([firstRejected, guestRejected, replacement])
  assert.ok(!f.grantIds().includes(f.guestGrant()!))
  assert.equal(f.counts().retains, 2)
  assert.equal(f.counts().forgets, 0)
  assert.equal((await t.restoreSession(source, signal()) as { accountId: string }).accountId, 'wallet')
})
