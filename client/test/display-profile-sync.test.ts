import { SourceDisplayProfiles } from '../src/data/source-display-profiles.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { LivePort } from '../src/data/live-restored.js'
import type { HttpRequest, HttpTransport } from '../src/data/http.js'
const source = { id: 'server', name: 'Local', url: 'http://127.0.0.1:1234', accountId: '', enabled: true }
test('display sync retains restored guest identity, deduplicates writes and fences another user', async () => {
  const writes: unknown[] = []
  const http: HttpTransport = {
    restoreSession: async () => ({ account: { id: 'existing-guest', guest: true } }),
    request: async (r: HttpRequest) => {
      if (r.path === '/v1/handshake') {
        return {
          serverId: source.id,
          protocol: 'game-room/1',
          gamePackageVersion: 1,
          uiFormats: ['scene-v1'],
          displayProfiles: ['self-display-profile-v1'],
          access: { guests: true },
        }
      }
      if (r.path === '/v1/me/profile') {
        writes.push(r.body)
        return { profile: r.body }
      }
      if (r.path.endsWith('packages')) return { packages: [] }
      return { rooms: [] }
    },
    dispose: () => {},
  }
  const port = new LivePort([source], http)
  const signal = new AbortController().signal
  const state = { status: 'available' as const, subject: 'user-a', displayName: 'GH L' }
  port.setCurrentUser(state)
  await port.list(source, signal)
  await port.list(source, signal)
  assert.equal(port.connectionKind(source.id), 'guest')
  assert.equal(writes.length, 1)
  port.setCurrentUser({ ...state, displayName: 'Updated 名字' })
  await port.list(source, signal)
  assert.equal(writes.length, 2)
  port.setCurrentUser({ ...state, subject: 'user-b', displayName: 'Other' })
  await assert.rejects(port.list(source, signal), /另一用户/)
  assert.equal(writes.length, 2)
  port.setCurrentUser({ status: 'unavailable', reason: 'signed-out' })
  await port.list(source, signal)
  assert.equal(writes.length, 2)
  await port.dispose()
})
test('configured account display names are source scoped and never replace authentication identity', async () => {
  const named = { ...source, accountDisplayName: '朋友甲' }
  const other = { ...source, id: 'other-server', url: 'http://127.0.0.1:1235' }
  const writes: { sourceId: string; body: unknown }[] = []
  const http: HttpTransport = {
    restoreSession: async source => ({ account: { id: source.id + ':owned-account', guest: false } }),
    request: async request => {
      if (request.path === '/v1/handshake') {
        return {
          serverId: request.source.id,
          protocol: 'game-room/1',
          gamePackageVersion: 1,
          uiFormats: ['scene-v1'],
          displayProfiles: ['self-display-profile-v1'],
          access: { guests: false },
        }
      }
      if (request.path === '/v1/me/profile') {
        writes.push({ sourceId: request.source.id, body: request.body })
        return { profile: request.body }
      }
      return request.path.endsWith('packages') ? { packages: [] } : { rooms: [] }
    },
    dispose() {},
  }
  const port = new LivePort([named, other], http), signal = new AbortController().signal
  const user = { status: 'available' as const, subject: 'stable-user', displayName: 'GH L' }
  port.setCurrentUser(user)
  await port.list(named, signal)
  await port.list(other, signal)
  assert.deepEqual(writes, [
    { sourceId: named.id, body: { subject: 'stable-user', displayName: '朋友甲' } },
    { sourceId: other.id, body: { subject: 'stable-user', displayName: 'GH L' } },
  ])
  named.accountDisplayName = '朋友乙'
  await port.list(named, signal)
  assert.deepEqual(writes[2], { sourceId: named.id, body: { subject: 'stable-user', displayName: '朋友乙' } })
  assert.equal(user.displayName, 'GH L')
  assert.equal(port.connectionKind(named.id), 'account')
  assert.equal(port.connectionKind(other.id), 'account')
  await port.dispose()
})

test('verified managed source saves and clears alias independently of Native display availability', async () => {
  const profiles = new SourceDisplayProfiles()
  profiles.supported.add(source.id)
  const writes: unknown[] = []
  const write = async (body: unknown) => {
    writes.push(body)
  }
  const signal = new AbortController().signal
  const named = { ...source, accountDisplayName: '朋友甲' }
  await profiles.sync(named, 'managed-account', signal, write, true)
  assert.deepEqual(writes, [{ subject: 'source-account:managed-account', displayName: '朋友甲' }])
  await profiles.sync(source, 'managed-account', signal, write, true)
  assert.deepEqual(writes[1], { subject: 'source-account:managed-account' })
  await profiles.sync(named, 'unverified-session', signal, write)
  assert.equal(writes.length, 2)
  profiles.setCurrentUser({ status: 'available', subject: 'public-user', displayName: 'GH L' })
  await profiles.sync(source, 'managed-account', signal, write, true)
  assert.deepEqual(writes[2], { subject: 'public-user', displayName: 'GH L' })
  profiles.dispose()
})

test('local default with a restored registered account cannot opt into managed metadata without a binding', async () => {
  const writes: unknown[] = []
  const account = { id: 'restored-registered', guest: false }
  const named = { ...source, accountDisplayName: '朋友甲' }
  const http: HttpTransport = {
    restoreSession: async () => ({ account }),
    request: async request => {
      if (request.path === '/v1/me') return { account }
      if (request.path === '/v1/handshake') {
        return {
          serverId: source.id,
          protocol: 'game-room/1',
          gamePackageVersion: 1,
          uiFormats: ['scene-v1'],
          displayProfiles: ['self-display-profile-v1'],
          access: { guests: false },
        }
      }
      if (request.path === '/v1/me/profile') {
        writes.push(request.body)
        return {}
      }
      if (request.path === '/v1/packages') return { packages: [] }
      return { rooms: [] }
    },
    dispose() {},
  }
  const port = new LivePort([named], http, [], undefined, true)
  const signal = new AbortController().signal
  try {
    await port.personalProfiles(signal)
    assert.equal(port.connectionKind(source.id), 'account')
    assert.equal(port.usesCodexAccount(source.id), true)
    await port.list(named, signal)
    assert.equal(writes.length, 0)
  } finally {
    port.dispose()
  }
})
