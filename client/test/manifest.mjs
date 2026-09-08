import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, inject, manifest } from '../dist/client.js'

test('exports a minimal CordisX plugin module', () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.id, 'client')
  assert.deepEqual(manifest.capabilities, [])
  assert.deepEqual(inject, ['i18n', 'pages', 'routes', 'slots'])
  assert.equal(typeof apply, 'function')
})
