import assert from 'node:assert/strict'
import test from 'node:test'
import type { HttpTransport } from '../src/data/http.js'
import { LivePort } from '../src/data/live-restored.js'
const source = {
  id: 'managed-server',
  name: 'Local',
  url: 'http://127.0.0.1:18973',
  enabled: true,
  accountDisplayName: '朋友甲',
}
function fixture(guests = false, advertised = true) {
  let logins = 0
  let guestCalls = 0
  let logouts = 0
  const writes: unknown[] = []
  const http: HttpTransport = {
    async connectAccount(s) {
      logins++
      assert.equal(s.id, source.id)
      return { instanceId: s.id, account: { id: 'native-owned-source-account', guest: false } }
    },
    async connectGuest() {
      guestCalls++
      throw new Error('Unexpected guest downgrade')
    },
    async restoreSession() {
      guestCalls++
      return undefined
    },
    async disconnect() {
      logouts++
    },
    async request(r) {
      if (r.path === '/v1/handshake') {
        return {
          serverId: source.id,
          protocol: 'game-room/1',
          gamePackageVersion: 1,
          uiFormats: ['scene-v1'],
          access: { guests, policy: guests ? 'guest-allowed' : 'login-required' },
          displayProfiles: ['self-display-profile-v1'],
          ...(advertised
            ? {
              managedAccount: {
                contract: 'cordisx.managed-source/v1',
                binding: {
                  origin: source.url,
                  sourceId: source.id,
                  instanceId: source.id,
                  audience: 'source-account',
                },
              },
            }
            : {}),
        }
      }
      if (r.path === '/v1/me/profile') {
        writes.push(r.body)
        return {}
      }
      if (r.path === '/v1/packages') return { packages: [] }
      return { rooms: [] }
    },
    dispose() {},
  }
  const port = new LivePort([source], http, [], undefined, true)
  return { port, http, writes, logins: () => logins, guestCalls: () => guestCalls, logouts: () => logouts }
}
for (const guests of [true, false]) {
  test(`trusted local source automatically logs in Codex account with guests=${guests}`, async t => {
    const f = fixture(guests)
    t.after(() => f.port.dispose())
    const nativeDisplay = { status: 'available' as const, subject: 'public-display-scope', displayName: 'GH L' }
    f.port.setCurrentUser(nativeDisplay)
    await f.port.list(source, new AbortController().signal)
    assert.equal(f.logins(), 1)
    assert.equal(f.guestCalls(), 0)
    assert.equal(f.port.connectionKind(source.id), 'account')
    assert.deepEqual(f.writes, [{ subject: 'public-display-scope', displayName: '朋友甲' }])
    assert.equal(nativeDisplay.displayName, 'GH L')
    await f.port.disconnect(source.id)
    await f.port.list(source, new AbortController().signal)
    assert.equal(f.logouts(), 1)
    assert.equal(f.logins(), 1)
    assert.equal(f.port.isConnected(source.id), false)
    await f.port.connect(source.id, 'account')
    assert.equal(f.logins(), 2)
    assert.equal(f.port.connectionKind(source.id), 'account')
  })
}
test('local default never falls back to guest or bearer when managed trust is absent or rejected', async t => {
  const missing = fixture(true, false)
  t.after(() => missing.port.dispose())
  await assert.rejects(missing.port.list(source, new AbortController().signal), /尚未配置受信/)
  assert.equal(missing.guestCalls(), 0)
  const denied = fixture(true)
  t.after(() => denied.port.dispose())
  denied.http.connectAccount = async () => {
    throw new Error('native-account-unavailable')
  }
  await assert.rejects(denied.port.list(source, new AbortController().signal), /native-account-unavailable/)
  assert.equal(denied.guestCalls(), 0)
  assert.equal(denied.port.isConnected(source.id), false)
})
test('managed result cannot downgrade to guest or silently change a configured source owner', async t => {
  const f = fixture()
  t.after(() => f.port.dispose())
  f.http.connectAccount = async () => ({ account: { id: 'guest-id', guest: true } })
  await assert.rejects(f.port.list(source, new AbortController().signal), /不能降级/)
  assert.equal(f.port.isConnected(source.id), false)
})

test('identity switch retires private views and fences a held older login before adoption', async t => {
  const f = fixture()
  t.after(() => f.port.dispose())
  let release!: (value: unknown) => void
  f.http.connectAccount = () =>
    new Promise(resolve => {
      release = resolve
    })
  f.port.setCurrentUser({ status: 'available', subject: 'display-a', displayName: 'Same' })
  const pending = f.port.list(source, new AbortController().signal)
  while (!release) await new Promise(resolve => setImmediate(resolve))
  f.port.setCurrentUser({ status: 'available', subject: 'display-b', displayName: 'Same' })
  release({ account: { id: 'older-owner', guest: false } })
  await assert.rejects(pending, /授权已被替换/)
  assert.equal(f.port.isConnected(source.id), false)
})

test('older held logout cannot clear a newer managed login after its cleanup settles', async t => {
  const f = fixture()
  t.after(() => f.port.dispose())
  await f.port.list(source, new AbortController().signal)
  let finishLogout!: () => void
  f.http.disconnect = () =>
    new Promise(resolve => {
      finishLogout = resolve
    })
  const logout = f.port.disconnect(source.id)
  assert(finishLogout)
  f.http.connectAccount = async () => ({ account: { id: 'new-native-account', guest: false } })
  await f.port.connect(source.id, 'account')
  assert.equal(f.port.isConnected(source.id), true)
  assert.equal(f.port.connectionKind(source.id), 'account')
  finishLogout()
  await logout
  assert.equal(f.port.isConnected(source.id), true)
  assert.equal(f.port.connectionKind(source.id), 'account')
})

test('logout between helper validation and caller continuation prevents stale auto-login publication', async t => {
  const f = fixture()
  t.after(() => f.port.dispose())
  let finishLogin!: (value: unknown) => void
  let finishLogout!: () => void
  let logout: Promise<void> | undefined
  f.http.connectAccount = () =>
    new Promise(resolve => {
      finishLogin = resolve
    })
  f.http.disconnect = () =>
    new Promise(resolve => {
      finishLogout = resolve
    })
  const login = f.port.list(source, new AbortController().signal)
  while (!finishLogin) await new Promise(resolve => setImmediate(resolve))
  finishLogin({ account: { id: 'stale-owner', guest: false } })
  queueMicrotask(() => {
    logout = f.port.disconnect(source.id)
  })
  await assert.rejects(login, /授权已被替换/)
  assert(finishLogout)
  assert.equal(f.port.isConnected(source.id), false)
  assert.equal(f.port.connectionKind(source.id), undefined)
  finishLogout()
  await logout
})
