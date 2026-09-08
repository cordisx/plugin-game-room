import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateActionData } from '../src/data/actions.js'
import { inspectPackage } from '../src/data/package-upload.js'
import { HostHttpTransport } from '../src/data/host-http.js'
import type { HttpClientV1, HttpConnectionV1 } from '@cordisx/protocol/plugin-http/v1'
test('generic action payload accepts author JSON without allowing non-JSON or unbounded content', () => {
  validateActionData({ type: 'custom-action', amount: 30 })
  validateActionData(['game-defined', 1])
  assert.throws(() => validateActionData({ amount: Infinity }))
  assert.throws(() => validateActionData({ run: () => 1 }))
  assert.throws(() => validateActionData('x'.repeat(5000)))
})
test('Host HTTP isolates role connections sharing one origin and forwards abort/deadline', async () => {
  const used: HttpConnectionV1[] = []
  let sequence = 0
  const client: HttpClientV1 = {
    contract: 'cordisx.http-client/v1',
    authorize: async ({ origin, credential }) => ({
      status: 'accepted',
      value: { contract: 'cordisx.http-connection/v1', id: String(++sequence), origin, credential },
    }),
    exchange: async () => ({ status: 'unavailable', code: 'unsupported' }),
    request: async request => {
      used.push(request.connection)
      assert(request.deadline > Date.now())
      assert(request.signal)
      return { status: 'accepted', value: { statusCode: 200, contentType: 'application/json', body: '{}' } }
    },
    revoke: async () => ({ status: 'accepted', value: null }),
    dispose() {},
  }
  const transport = new HostHttpTransport(client)
  const game = { id: 'game', name: 'game', url: 'http://127.0.0.1:8787', accountId: 'alice', enabled: true }
  const economy = { ...game, id: 'economy:game', accountId: '' }
  await transport.connect(game, 'bearer')
  await transport.connect(economy, 'bearer')
  for (const source of [game, economy]) {
    await transport.request({ source, path: '/v1/me', authenticated: true, signal: new AbortController().signal })
  }
  assert.notEqual(used[0]!.id, used[1]!.id)
  transport.dispose()
  await assert.rejects(
    transport.request({ source: game, path: '/v1/me', authenticated: true, signal: new AbortController().signal }),
  )
})
test('package JSON preview never executes uploaded source and rejects oversized input', async () => {
  const packageData = {
    packageVersion: 1,
    manifest: { id: 'custom', name: 'Custom', version: '1.0.0', minPlayers: 2, maxPlayers: 2, modes: ['token'] },
    rules: 'throw new Error("MUST NOT EXECUTE")',
    ui: { format: 'scene-v1', render: 'throw new Error("MUST NOT EXECUTE")' },
  }
  const preview = await inspectPackage(JSON.stringify(packageData))
  assert.equal(preview.digest.length, 64)
  assert.deepEqual(preview.modes, ['token'])
  await assert.rejects(inspectPackage(' '.repeat(600 * 1024 + 1)))
})
test('opaque seat exchange never returns bearer and rejects cross-source credential reuse', async () => {
  const revoked: string[] = []
  const source = { id: 'game', name: 'Game', url: 'https://game.example', accountId: 'account', enabled: true }
  const connection: HttpConnectionV1 = {
    contract: 'cordisx.http-connection/v1',
    id: 'parent',
    origin: source.url,
    credential: 'bearer',
  }
  const client: HttpClientV1 = {
    contract: 'cordisx.http-client/v1',
    authorize: async () => ({ status: 'accepted', value: connection }),
    exchange: async request => {
      assert.equal(request.connection.id, 'parent')
      assert.equal(request.credentialField, 'token')
      return {
        status: 'accepted',
        value: {
          connection: { ...connection, id: 'seat' },
          response: { statusCode: 200, contentType: 'application/json', body: '{"grantId":"grant"}' },
        },
      }
    },
    request: async request => {
      assert.equal(request.connection.id, 'seat')
      return { status: 'accepted', value: { statusCode: 200, contentType: 'application/json', body: '{}' } }
    },
    revoke: async value => {
      revoked.push(value.id)
      return { status: 'accepted', value: null }
    },
    dispose() {},
  }
  const transport = new HostHttpTransport(client)
  const signal = new AbortController().signal
  await transport.connect(source, 'bearer')
  const grant = await transport.exchange({
    source,
    path: '/v1/rooms/room/agent-grants',
    signal,
    authenticated: true,
    body: { seatId: 's' },
  }, 'token')
  assert.deepEqual(grant, { credentialRef: 'seat', value: { grantId: 'grant' } })
  await assert.rejects(
    transport.requestCredential({
      source: { ...source, id: 'other' },
      path: '/v1/agent/observation',
      signal,
      credentialRef: grant.credentialRef,
    }),
  )
  await transport.requestCredential({
    source,
    path: '/v1/agent/revoke',
    method: 'POST',
    signal,
    credentialRef: grant.credentialRef,
  })
  assert.deepEqual(revoked, ['seat'])
  await assert.rejects(
    transport.requestCredential({ source, path: '/v1/agent/observation', signal, credentialRef: grant.credentialRef }),
  )
})
