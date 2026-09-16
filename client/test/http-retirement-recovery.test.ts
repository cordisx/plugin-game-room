import assert from 'node:assert/strict'
import test from 'node:test'
import type { HttpClientV4 } from '@cordisx/protocol/plugin-http/v4'
import type { HttpConnectionV1, HttpRequestV1 } from '@cordisx/protocol/plugin-http/v1'
import { LivePort } from '../src/data/live-restored.js'
import { HostHttpTransport } from '../src/data/host-http.js'

const source = { id: 'fixture-game', name: 'Fixture', url: 'https://fixture.example', enabled: true }
const signal = () => new AbortController().signal
function fixture() {
  const grants = new Map<string, HttpConnectionV1>(), requests: HttpRequestV1[] = []
  let sequence = 0, resumes = 0, authorizes = 0, logins = 0, saved = false
  let denied = false, absent = false, unavailableRead = false
  const grant = (credential: 'none' | 'bearer'): HttpConnectionV1 => {
    const value: HttpConnectionV1 = {
      contract: 'cordisx.http-connection/v1',
      id: `fixture-${++sequence}`,
      origin: source.url,
      credential,
    }
    grants.set(value.id, value)
    return value
  }
  const account = { instanceId: source.id, account: { id: 'original-game-account', guest: false } }
  const response = (body: unknown) => ({ statusCode: 200, contentType: 'application/json', body: JSON.stringify(body) })
  const body = (path: string) => {
    if (path === '/v1/handshake') {
      return {
        protocol: 'game-room/1',
        serverId: source.id,
        gamePackageVersion: 1,
        uiFormats: ['scene-v1'],
        managedAccount: {
          contract: 'cordisx.managed-source/v1',
          binding: { origin: source.url, sourceId: source.id, instanceId: source.id, audience: 'source-account' },
        },
      }
    }
    if (path === '/v1/me') return account
    if (path === '/v1/packages') return { packages: [] }
    if (path === '/v1/rooms' || path === '/v1/me/rooms') return { rooms: [] }
    return { ok: true }
  }
  // In-memory public HTTP capability fixture. No Native, network or wallet API is used.
  const client = {
    contract: 'cordisx.http-client/v4',
    authorize: async ({ credential }: { credential: 'none' | 'bearer' }) => {
      authorizes++
      return { status: 'accepted', value: grant(credential) }
    },
    request: async (input: HttpRequestV1) => {
      requests.push(input)
      return grants.has(input.connection.id) && !(unavailableRead && input.path === '/read')
        ? { status: 'accepted', value: response(body(input.path)) }
        : { status: 'unavailable', code: 'connection-unavailable' }
    },
    resume: async () => {
      resumes++
      return denied
        ? { status: 'unavailable', code: 'denied' }
        : { status: 'accepted', value: saved && !absent ? grant('bearer') : null }
    },
    connectAccount: async () => {
      logins++
      return { status: 'accepted', value: { connection: grant('bearer'), response: response(account) } }
    },
    retain: async () => {
      saved = true
      return { status: 'accepted', value: null }
    },
    forget: async () => {
      saved = false
      return { status: 'accepted', value: null }
    },
    revoke: async (value: HttpConnectionV1) => {
      grants.delete(value.id)
      return { status: 'accepted', value: null }
    },
  } as unknown as HttpClientV4
  const transport = new HostHttpTransport(client), port = new LivePort([source], transport)
  return {
    transport,
    port,
    requests,
    counts: () => ({ resumes, authorizes, logins }),
    retire: (all = false) => {
      for (const [id, value] of grants) if (all || value.credential === 'bearer') grants.delete(id)
    },
    deny: (value: boolean) => {
      denied = value
    },
    absent: () => {
      absent = true
    },
    unavailableRead: () => {
      unavailableRead = true
    },
    foreignIdentity: () => {
      account.account.id = 'foreign-game-account'
    },
    start: async () => {
      await port.prepareSource(source, signal())
      await port.list(source, signal())
      await transport.request({ source, path: '/v1/me', authenticated: true, signal: signal() })
    },
  }
}

test('a GET after an unreplayed retired POST resumes the saved account once without authorization or login', async t => {
  const f = fixture()
  t.after(() => f.port.dispose())
  await f.start()
  f.retire()
  const before = f.counts()
  await assert.rejects(
    f.transport.request({
      source,
      path: '/operation',
      method: 'POST',
      body: {},
      authenticated: true,
      signal: signal(),
    }),
    { code: 'session_unavailable', outcome: 'rejected' },
  )
  assert.deepEqual(f.counts(), before)
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
  assert.deepEqual(await f.transport.request({ source, path: '/read', authenticated: true, signal: signal() }), {
    ok: true,
  })
  assert.deepEqual(f.counts(), { ...before, resumes: before.resumes + 1 })
  const reads = f.requests.slice(-2)
  assert.deepEqual(reads.map(r => r.path), ['/v1/me', '/read'])
  assert.equal(reads[0]!.deadline, reads[1]!.deadline)
})

for (const failure of ['denied', 'absent'] as const) {
  test(`failed resume (${failure}) clears logical account, blocks repeated permission attempts, and leaves explicit reconnect`, async t => {
    const f = fixture()
    t.after(() => f.port.dispose())
    await f.start()
    f.retire()
    if (failure === 'denied') f.deny(true)
    else f.absent()
    await assert.rejects(f.port.list(source, signal()), { code: 'session_unavailable', outcome: 'rejected' })
    assert.equal(f.port.isConnected(source.id), false)
    const refused = f.counts()
    f.deny(false)
    assert.equal((await f.port.list(source, signal())).compatible, true)
    assert.equal(f.port.isConnected(source.id), false)
    assert.deepEqual(f.counts(), refused)
    await assert.rejects(
      f.transport.request({ source, path: '/read', authenticated: true, signal: signal() }),
      { code: 'session_unavailable', outcome: 'rejected' },
    )
    assert.deepEqual(f.counts(), refused)
    await f.port.connect(source.id)
    assert.equal(f.port.isConnected(source.id), true)
    assert.equal((await f.port.list(source, signal())).compatible, true)
    assert.equal(f.counts().logins, refused.logins + 1)
  })
}

test('dual public and bearer retirement resets logical status and later missing-handle GET uses only saved-session resume', async t => {
  const f = fixture()
  t.after(() => f.port.dispose())
  await f.start()
  f.retire(true)
  await assert.rejects(f.port.list(source, signal()), { code: 'session_unavailable', outcome: 'rejected' })
  assert.equal(f.port.isConnected(source.id), false)
  const before = f.counts()
  assert.deepEqual(await f.transport.request({ source, path: '/read', authenticated: true, signal: signal() }), {
    ok: true,
  })
  assert.deepEqual(f.counts(), { ...before, resumes: before.resumes + 1 })
  assert.equal(f.port.isConnected(source.id), false)
  await f.port.connect(source.id)
  assert.equal((await f.port.list(source, signal())).compatible, true)
})

test('missing handle consumes the one resume budget even if the newly resumed GET handle is immediately retired', async t => {
  const f = fixture()
  t.after(() => f.port.dispose())
  await f.start()
  f.retire()
  await assert.rejects(
    f.transport.request({ source, path: '/operation', method: 'POST', authenticated: true, signal: signal() }),
    { code: 'session_unavailable', outcome: 'rejected' },
  )
  const before = f.counts()
  f.unavailableRead()
  await assert.rejects(
    f.transport.request({ source, path: '/read', authenticated: true, signal: signal() }),
    { code: 'session_unavailable', outcome: 'rejected' },
  )
  assert.deepEqual(f.counts(), { ...before, resumes: before.resumes + 1 })
  assert.equal(f.requests.filter(r => r.path === '/read').length, 1)
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1)
})

test('identity drift clears the visible connected status while quarantine blocks every later read until explicit reconnect', async t => {
  const f = fixture()
  t.after(() => f.port.dispose())
  await f.start()
  f.retire()
  f.foreignIdentity()
  await assert.rejects(f.port.list(source, signal()), { code: 'session_identity_changed', outcome: 'rejected' })
  assert.equal(f.port.isConnected(source.id), false)
  const before = f.counts(), attempts = f.requests.length
  await assert.rejects(
    f.transport.request({ source, path: '/read', authenticated: true, signal: signal() }),
    { code: 'session_identity_changed', outcome: 'rejected' },
  )
  await assert.rejects(
    f.transport.request({ source, path: '/write', method: 'POST', authenticated: true, signal: signal() }),
    { code: 'session_unavailable', outcome: 'rejected' },
  )
  assert.deepEqual(f.counts(), before)
  assert.equal(f.requests.length, attempts)
  assert.equal((await f.port.list(source, signal())).compatible, true)
  assert.equal(f.port.isConnected(source.id), false)
  assert.deepEqual(f.counts(), before)
})
