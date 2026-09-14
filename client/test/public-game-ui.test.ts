import assert from 'node:assert/strict'
import test from 'node:test'
import { LivePort } from '../src/data/live-restored.js'
import type { HttpTransport } from '../src/data/http.js'

const source = { id: 'local', name: 'Local', url: 'http://127.0.0.1:8787', accountId: '', enabled: true }

test('public game UI can be loaded for a spectator before any account connects', async () => {
  const bundle = { format: 'scene-v1' }
  const http: HttpTransport = {
    async request(request) {
      assert.equal(request.authenticated, false, 'public package reads must not require a guest credential')
      assert.equal(request.source, source)
      if (request.path === '/v1/packages/exact-hash') return { hash: 'exact-hash', uiSha256: 'exact-ui' }
      if (request.path === '/v1/packages/exact-hash/ui') return bundle
      throw Error('Unexpected request')
    },
    dispose() {},
  }
  const port = new LivePort([source], http)
  assert.equal(port.isConnected(source.id), false)
  assert.deepEqual(await port.gameUiPackage(source.id, 'exact-hash', new AbortController().signal), {
    bundle,
    digest: 'exact-ui',
  })
  assert.equal(port.isConnected(source.id), false)
})

test('anonymous package reads still reject a mismatched package identity', async () => {
  const port = new LivePort([source], {
    async request(request) {
      return request.path.endsWith('/ui') ? { format: 'scene-v1' } : { hash: 'other-hash', uiSha256: 'exact-ui' }
    },
    dispose() {},
  })
  await assert.rejects(port.gameUiPackage(source.id, 'exact-hash', new AbortController().signal), /游戏包身份不匹配/)
})
