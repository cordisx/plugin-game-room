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
  const pkg = JSON.parse(await readFile('sdk/builtin/gomoku-1.6.0.json', 'utf8'))
  const meta = await request('/v1/packages', alice.token, pkg)
  const room = await request('/v1/rooms', alice.token, { packageHash: meta.hash, mode: 'score', botCount: 1 })
  const path = '/v1/rooms/' + room.id
  let view = await request(path + '/start', alice.token, {})
  view = await request(path + '/actions', alice.token, {
    expectedVersion: view.version,
    idempotencyKey: 'first',
    action: { type: 'place', x: 7, y: 7 },
  })
  view = await request(path, alice.token)
  assert.equal(view.observation.moves, 2)
  await db.prepare("UPDATE rooms SET body=json_set(body,'$.deadline',0) WHERE id=?").bind(room.id).run()
  view = await request(path, alice.token)
  assert.equal(view.status, 'finished')
  const restored = await request(path + '/undo-resume', alice.token, { expectedVersion: view.version })
  assert.equal(restored.status, 'playing')
  assert.equal(restored.observation.moves, 0)
  assert.equal(restored.matchId, room.matchId)
  assert.equal((await request(path, alice.token)).status, 'playing')
  console.log('PASS actual workerd: finished AI match resumes in place with undo and valid deadline')
} finally {
  await mf.dispose()
}
