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
test('Host HTTP separates configured public discovery from bearer-scoped account requests', async () => {
  const used: HttpConnectionV1[] = []
  const authorized: HttpConnectionV1['credential'][] = []
  let sequence = 0
  const client: HttpClientV1 = {
    contract: 'cordisx.http-client/v1',
    authorize: async ({ origin, credential }) => {
      authorized.push(credential)
      return {
        status: 'accepted',
        value: { contract: 'cordisx.http-connection/v1', id: String(++sequence), origin, credential },
      }
    },
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
  const signal = new AbortController().signal
  await transport.prepare(game, signal)
  await transport.request({ source: game, path: '/v1/handshake', signal })
  await transport.connect(game, 'bearer')
  await transport.connect(economy, 'bearer')
  for (const source of [game, economy]) {
    await transport.request({ source, path: '/v1/me', authenticated: true, signal })
  }
  assert.deepEqual(authorized, ['none', 'bearer', 'bearer'])
  assert.equal(used[0]!.credential, 'none')
  assert.equal(used[1]!.credential, 'bearer')
  assert.equal(used[2]!.credential, 'bearer')
  assert.notEqual(used[1]!.id, used[2]!.id)
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
test('public discovery enforces the streamed byte boundary and propagates abort', async () => {
  const { createServer } = await import('node:http')
  const { PublicDiscoveryTransport } = await import('../src/data/http.js')
  let streamStarted!: () => void
  const streaming = new Promise<void>(resolve => {
    streamStarted = resolve
  })
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    if (request.url === '/abort') {
      response.write('"partial')
      streamStarted()
      return
    }
    const size = request.url === '/boundary' ? 2_000_000 : 2_000_001
    const payload = Buffer.from(`"${'x'.repeat(size - 2)}"`)
    let offset = 0
    const write = () => {
      if (response.destroyed) return
      if (offset === payload.byteLength) {
        response.end()
        return
      }
      const end = Math.min(offset + 32768, payload.byteLength)
      response.write(payload.subarray(offset, end))
      offset = end
      setImmediate(write)
    }
    write()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const source = {
    id: 'stream',
    name: 'Stream',
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    accountId: '',
    enabled: true,
  }
  const transport = new PublicDiscoveryTransport()
  try {
    const signal = new AbortController().signal
    const boundary = await transport.request({ source, path: '/boundary', signal })
    assert.equal((boundary as string).length, 1_999_998)
    await assert.rejects(transport.request({ source, path: '/oversize', signal }), /超过大小限制/)
    const controller = new AbortController()
    const pending = transport.request({ source, path: '/abort', signal: controller.signal })
    await streaming
    controller.abort()
    await assert.rejects(pending, (error: Error) => error.name === 'AbortError')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
