import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HttpClientV1, HttpConnectionV1 } from '@cordisx/protocol/plugin-http/v1'
import { HostHttpTransport } from '../src/data/host-http.js'
import { LivePort } from '../src/data/live-restored.js'
const source = { id: 'server', name: 'Server', url: 'http://127.0.0.1:8793', enabled: true }
function fixture() {
  let exchanges = 0
  let mode = 'valid'
  const requests: string[] = []
  const authorizations: string[] = []
  let revocations = 0
  const account = { id: 'original-guest', guest: true }
  const manifest = { id: 'game', name: 'Game', version: '1', modes: ['score'] }
  const room = {
    id: 'room',
    serverId: source.id,
    packageHash: 'hash',
    manifest,
    config: {},
    seats: [{ id: 'seat', accountId: account.id, name: 'Guest' }],
    maxPlayers: 2,
    status: 'waiting',
    mode: 'score',
    stake: 0,
    reviewState: 'unreviewed',
    turnTimeoutMs: 60000,
    policy: 'equal-winners-v1',
  }
  const response = (body: unknown, statusCode = 200) => ({
    statusCode,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
  const connection = (id: string, credential: 'none' | 'bearer'): HttpConnectionV1 => ({
    contract: 'cordisx.http-connection/v1',
    id,
    origin: source.url,
    credential,
  })
  const client: HttpClientV1 = {
    contract: 'cordisx.http-client/v1',
    async authorize({ credential }) {
      authorizations.push(credential)
      return { status: 'accepted', value: connection('public', credential) }
    },
    async exchange() {
      exchanges++
      mode = 'valid'
      return {
        status: 'accepted',
        value: { connection: connection(`guest-${exchanges}`, 'bearer'), response: response({ account }) },
      }
    },
    async request({ path }) {
      requests.push(path)
      if (path === '/v1/me') {
        if (mode === 'network') return { status: 'unavailable', code: 'network-error' }
        if (mode === 'invalid') {
          return { status: 'accepted', value: response({ error: { code: 'invalid_session' } }, 401) }
        }
        return { status: 'accepted', value: response({ account }) }
      }
      if (path === '/v1/handshake') {
        return {
          status: 'accepted',
          value: response({
            serverId: source.id,
            protocol: 'game-room/1',
            gamePackageVersion: 1,
            uiFormats: ['scene-v1'],
            access: { guests: true },
          }),
        }
      }
      if (path === '/v1/rooms' || path === '/v1/me/rooms') {
        return { status: 'accepted', value: response({ rooms: [room] }) }
      }
      if (path === '/v1/packages') {
        return {
          status: 'accepted',
          value: response({ packages: [{ hash: 'hash', publisherId: 'author', manifest }] }),
        }
      }
      throw new Error(`Unexpected ${path}`)
    },
    async revoke() {
      revocations++
      return { status: 'accepted', value: null }
    },
    dispose() {},
  }
  const transport = new HostHttpTransport(client)
  return {
    transport,
    requests,
    authorizations,
    revocations: () => revocations,
    mode: (value: string) => {
      mode = value
    },
    exchanges: () => exchanges,
  }
}
test('existing guest survives client account-map loss; list restores owned without exchange', async () => {
  const f = fixture()
  const signal = new AbortController().signal
  await f.transport.connectGuest(source, signal)
  await f.transport.connectGuest(source, signal)
  assert.equal(f.exchanges(), 1)
  const port = new LivePort([source], f.transport)
  assert.equal(port.isConnected(source.id), false)
  const listed = await port.list(source, signal)
  assert.equal(port.isConnected(source.id), true)
  assert.equal(port.connectionKind(source.id), 'guest')
  assert.equal(listed.rooms[0]!.owned, true)
  assert.ok(f.requests.includes('/v1/me/rooms'))
  await assert.rejects(port.connect(source.id, 'account'), /免密钥访客连接/)
  await port.connect(source.id)
  assert.equal(port.connectionKind(source.id), 'guest')
  assert.equal(f.exchanges(), 1)
  assert.deepEqual(f.authorizations, ['none'])
  assert.equal(f.revocations(), 0)
  await port.dispose()
})
test('invalid authentication permits one replacement, while transient failures never create a guest', async () => {
  const f = fixture()
  const signal = new AbortController().signal
  await f.transport.connectGuest(source, signal)
  f.mode('network')
  await assert.rejects(f.transport.connectGuest(source, signal), /network-error/)
  assert.equal(f.exchanges(), 1)
  f.mode('invalid')
  await f.transport.connectGuest(source, signal)
  assert.equal(f.exchanges(), 2)
  await f.transport.dispose()
})
