import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CORDISX_PLUGIN_MANIFEST_SCHEMA_V11 } from 'cordisx/contracts'
import { icon, manifest } from '../src/client.js'

test('plugin brand metadata embeds the owned 256px PNG unchanged', () => {
  const png = readFileSync(new URL('../assets/icon.png', import.meta.url))
  assert.equal(icon.mediaType, 'image/png')
  assert.deepEqual(Buffer.from(icon.data, 'base64'), png)
  assert.equal(png.readUInt32BE(16), 256)
  assert.equal(png.readUInt32BE(20), 256)
})

test('manifest declares every Host surface used by Game Room', () => {
  assert.equal(manifest.$schema, CORDISX_PLUGIN_MANIFEST_SCHEMA_V11)
  assert.equal(manifest.schemaVersion, 11)
  assert.deepEqual(manifest.services, [])

  const render = manifest.capabilities.find(capability => capability.name === 'ui.extension-points.render')
  assert.ok(render)
  assert.equal(render.required, true)
  assert.deepEqual(
    new Set(render.scope.extensionPoints),
    new Set([
      'sidebar.navigation.items',
      'main',
      'manager.settings.navigation-items',
      'manager.content',
    ]),
  )
})
