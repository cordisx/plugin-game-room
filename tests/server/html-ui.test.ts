import assert from 'node:assert/strict'
import test from 'node:test'
import { digest } from '../../server/accounts.js'
import { verifyHtmlUi } from '../../sdk/html-ui.mjs'
import { game, harness } from './helpers.js'
const content = '<main>Isolated HTML fixture</main>'
const ui = {
  format: 'html-v1' as const,
  bridgeVersion: 1 as const,
  entry: 'index.html',
  assets: { 'index.html': { mediaType: 'text/html' as const, content, sha256: digest(content) } },
}
await test('HTML package integrity and resource paths are checked before execution', async () => {
  assert.deepEqual(await verifyHtmlUi(ui, digest), ui)
  await assert.rejects(
    verifyHtmlUi({ ...ui, assets: { '../escape.html': ui.assets['index.html'] } }, digest),
    /invalid_html_ui/,
  )
  await assert.rejects(
    verifyHtmlUi({ ...ui, assets: { 'index.html': { ...ui.assets['index.html'], content: 'changed' } } }, digest),
    /html_ui_integrity/,
  )
  await assert.rejects(verifyHtmlUi({ ...ui, trusted: true }, digest), /invalid_html_ui/)
})
await test('package manifests enforce bounded minimum HTML viewport dimensions', async (t) => {
  const h = await harness()
  t.after(async () => await h.app.close())
  const valid = game()
  valid.manifest.version = '1.0.1'
  valid.manifest.minimumViewport = { width: 460, height: 520 }
  assert.equal((await h.request('/v1/packages', h.alice.token, valid)).status, 200)
  const tooNarrow = game()
  tooNarrow.manifest.version = '1.0.2'
  tooNarrow.manifest.minimumViewport = { width: 279, height: 520 }
  const rejected = await h.request('/v1/packages', h.alice.token, tooNarrow)
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.error.code, 'invalid_minimum_viewport')
  const malformed = game()
  malformed.manifest.version = '1.0.3'
  malformed.manifest.minimumViewport = null as never
  const malformedResult = await h.request('/v1/packages', h.alice.token, malformed)
  assert.equal(malformedResult.status, 400)
  assert.equal(malformedResult.body.error.code, 'invalid_minimum_viewport')
})
await test('HTML branch retains authoritative seat projection, actions, idempotency and legacy scene compatibility', async (t) => {
  const h = await harness()
  t.after(async () => await h.app.close())
  const pkg = { ...game(), ui }
  const room = await h.room(pkg)
  assert.equal(room.status, 'playing')
  assert.equal(room.scene, null)
  assert.equal(
    (room.observation as {
      hand: string
    }).hand,
    'private-0',
  )
  const path = `/v1/rooms/${room.id}`
  const wrong = await h.request(path + '/actions', h.bob.token, {
    expectedVersion: room.version,
    idempotencyKey: 'wrong',
    action: { type: 'move' },
  })
  assert.equal(wrong.status, 403)
  const action = { expectedVersion: room.version, idempotencyKey: 'html-action', action: { type: 'move' } }
  const a = await h.request(path + '/actions', h.alice.token, action)
  const b = await h.request(path + '/actions', h.alice.token, action)
  assert.equal(a.status, 200)
  assert.deepEqual(a.body, b.body)
  assert.equal((await h.request('/v1/handshake')).body.uiFormats.includes('html-v1'), true)
  const legacy = game()
  legacy.manifest.version = '1.0.1'
  assert.equal((await h.room(legacy)).scene?.version, 1)
})
