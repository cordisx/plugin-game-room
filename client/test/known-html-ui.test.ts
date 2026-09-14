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
