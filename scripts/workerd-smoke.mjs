import { applyWorkersMigrations } from './apply-workers-migrations.mjs'
import { Miniflare } from 'miniflare'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const mf = new Miniflare({
  modules: true,
  scriptPath: 'dist/server/index.js',
  modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  bindings: { AUTH_POLICY: 'guest-allowed' },
})
try {
  const db = await mf.getD1Database('DB')
  await applyWorkersMigrations(db)
  async function request(path, token, body) {
    const response = await mf.dispatchFetch('http://localhost' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const value = await response.json()
    assert.equal(response.status, 200, JSON.stringify(value))
    return value
  }
  console.log('health', await request('/health'))
  const alice = await request('/v1/accounts', undefined, { name: 'alice', password: 'correct-horse-battery' })
  const bob = await request('/v1/accounts', undefined, { name: 'bobby', password: 'correct-horse-battery' })
  const { game } = await import('../dist/tests/server/helpers.js')
  const meta = await request('/v1/packages', alice.token, game())
  const room = await request('/v1/rooms', alice.token, { packageHash: meta.hash, mode: 'score', allowAgents: true })
  await request(`/v1/rooms/${room.id}/join`, bob.token, {})
  await request(`/v1/rooms/${room.id}/ready`, alice.token, { ready: true })
  await request(`/v1/rooms/${room.id}/ready`, bob.token, { ready: true })
  const started = await request(`/v1/rooms/${room.id}/start`, alice.token, {})
  assert.equal(started.status, 'playing')
  assert.equal(started.observation.hand, 'private-0')
  const input = { expectedVersion: started.version, idempotencyKey: 'move-1', action: { type: 'move' } }
  const responses = await Promise.all([
    request(`/v1/rooms/${room.id}/actions`, alice.token, input),
    request(`/v1/rooms/${room.id}/actions`, alice.token, input),
  ])
  assert.deepEqual(responses[0], responses[1])
  const finished = await request(`/v1/rooms/${room.id}/actions`, bob.token, {
    expectedVersion: responses[0].version,
    idempotencyKey: 'move-2',
    action: { type: 'move' },
  })
  assert.equal(finished.status, 'finished')
  console.log('PASS actual workerd D1 account, package, private projection, room, concurrent same-key retry, finish')
} finally {
  await mf.dispose()
}
