import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import '../gomoku/ui.js'

test('timeout explicitly names the losing side; a connected five is distinct', () => {
  const outcome = globalThis.gomokuOutcome
  assert.equal(outcome({ result: { winners: [1] }, reason: 'timeout' }), '黑方超时 · 白方获胜')
  assert.equal(outcome({ result: { winners: [0] }, reason: 'timeout' }), '白方超时 · 黑方获胜')
  assert.equal(outcome({ result: { winners: [1] } }), '白方五子连线获胜')
  assert.equal(outcome({ result: { winners: [] } }), '平局')
})

test('clock uses the authoritative deadline, rounds up, and never displays negative time', () => {
  const left = globalThis.gomokuTimeLeft
  assert.equal(left(61000, 1000), 60)
  assert.equal(left(61000, 60500), 1)
  assert.equal(left(61000, 61000), 0)
  assert.equal(left(61000, 99000), 0)
})

test('multi-round rules have a new version and do not replace the pinned historical package', async () => {
  const old = JSON.parse(
    await readFile(new URL('../../sdk/builtin/gomoku-1.6.0.json', import.meta.url)),
  )
  const { build } = await import('../tools/package.mjs')
  const { pkg } = await build('gomoku')
  assert.equal(pkg.manifest.version, '1.7.0')
  assert.equal(old.manifest.version, '1.6.0')
  assert.notEqual(pkg.rules, old.rules)
  const local = JSON.parse(
    await readFile(new URL('../../client/src/data/gomoku-presentation.json', import.meta.url)),
  )
  assert.notDeepEqual(local.bundle, pkg.ui)
})
