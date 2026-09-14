import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertWaitingPresentationTarget, knownWaitingPresentation } from '../src/data/known-html-ui.js'

const sourcePackageHash = '0886bafe5556be6f737debfc30d6bd35916d28ff13c1312001269d20fd33bb63'
const sourceDigest = 'fe62ebad3140ede823c3865bd0b9eaf18372c09f125ee2da68ccf55326331018'
const targetPackageHash = '46dc5c3849bcb0c7d1999708433e86032d75afd574b1f68f7e7ac5697c1179b2'
const targetDigest = '34f0a30b2a50447be53e023a1c511425dbb615cce32206164f731d90dde699c4'

test('legacy waiting presentation requires the full source identity and waiting lifecycle', () => {
  const presentation = knownWaitingPresentation(sourcePackageHash, sourceDigest, 'waiting')
  assert.deepEqual(presentation, { sourcePackageHash, sourceDigest, targetPackageHash, targetDigest })
  assert.deepEqual(knownWaitingPresentation(sourcePackageHash, sourceDigest, 'funding'), presentation)
  assert.equal(knownWaitingPresentation('0'.repeat(64), sourceDigest, 'waiting'), undefined)
  assert.equal(knownWaitingPresentation(sourcePackageHash, '0'.repeat(64), 'waiting'), undefined)
  assert.equal(knownWaitingPresentation(sourcePackageHash, sourceDigest, 'playing'), undefined)
  assert.equal(knownWaitingPresentation(sourcePackageHash, sourceDigest, 'finished'), undefined)
})

test('legacy waiting presentation rejects target digest drift', () => {
  const presentation = knownWaitingPresentation(sourcePackageHash, sourceDigest, 'waiting')!
  assert.doesNotThrow(() => assertWaitingPresentationTarget(presentation, targetDigest))
  assert.throws(
    () => assertWaitingPresentationTarget(presentation, '0'.repeat(64)),
    /兼容等待界面身份不匹配/,
  )
})

test('Gomoku presentation fix admits only the exact package and UI identity', async () => {
  const { isGomokuClockPresentation, loadKnownHtmlUi } = await import('../src/data/known-html-ui.js')
  const { readFile } = await import('node:fs/promises')
  const pkg = JSON.parse(await readFile(new URL('../../sdk/builtin/gomoku-1.6.0.json', import.meta.url), 'utf8'))
  const hash = '4ce550ff5cf585984dd1d688a8671dde9400f7b1055405ab68104fb847ab4fe0'
  const digest = '4351537370490204ac2b99175df9844ccce8b7e3a3b33ffd26100733d786793d'
  assert.equal(isGomokuClockPresentation(hash, digest), true)
  assert.equal(isGomokuClockPresentation('0'.repeat(64), digest), false)
  assert.equal(isGomokuClockPresentation(hash, '0'.repeat(64)), false)
  const port = {
    gameUi: async () => ({ bundle: pkg.ui, digest }),
  } as unknown as import('../src/data/port.js').GameRoomPort
  const room = { game: { packageHash: hash, waitingUi: true } } as import('../src/data/model.js').Room
  const loaded = await loadKnownHtmlUi(port, room, new AbortController().signal, 'finished')
  assert.ok(JSON.stringify(loaded.bundle).includes('gomokuTimeLeft'))
  assert.ok(JSON.stringify(loaded.bundle).includes('方超时'))
  assert.equal(room.game.packageHash, hash)
})
