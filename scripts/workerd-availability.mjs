import { Miniflare } from 'miniflare'
import assert from 'node:assert/strict'
const mf = new Miniflare({
  modules: true,
  scriptPath: 'dist/server/index.js',
  modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
})
try {
  const response = await mf.dispatchFetch('http://localhost/health')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: { code: 'backend_unavailable', message: 'Backend unavailable' } })
  console.log('PASS unmigrated/unavailable database returns short JSON503')
} finally {
  await mf.dispose()
}
