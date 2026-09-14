import test from 'node:test'
import assert from 'node:assert/strict'
import { parseGameConfigSchema, validateGameConfig } from '../../sdk/game-config.mjs'
const schema = {
  type: 'object',
  additionalProperties: false,
  properties: { boardSize: { type: 'integer', default: 15, enum: [9, 13, 15] } },
}
await test('game schema applies defaults and rejects unknown, invalid and executable fields', () => {
  const parsed = parseGameConfigSchema(schema)
  assert.deepEqual(validateGameConfig(parsed), { boardSize: 15 })
  assert.deepEqual(validateGameConfig(parsed, { boardSize: 9 }), { boardSize: 9 })
  assert.throws(() => validateGameConfig(parsed, { boardSize: 10 }))
  assert.throws(() => validateGameConfig(parsed, { boardSize: '9' }))
  assert.throws(() => validateGameConfig(parsed, { other: 3 }))
  assert.throws(() =>
    parseGameConfigSchema({ ...schema, properties: { x: { type: 'string', default: '', callback: 'alert(1)' } } })
  )
  assert.throws(() =>
    parseGameConfigSchema(
      JSON.parse(
        '{"type":"object","additionalProperties":false,"properties":{"__proto__":{"type":"string","default":""}}}',
      ),
    )
  )
})
import { game, harness } from './helpers.js'
await test('server validates immutable package config on room creation', async (t) => {
  const h = await harness()
  t.after(async () => await h.app.close())
  const pkg = game()
  pkg.manifest.configSchema = parseGameConfigSchema(schema)
  const published = await h.request('/v1/packages', h.alice.token, pkg)
  assert.equal(published.status, 200)
  const request = { packageHash: published.body.hash, mode: 'score', config: { boardSize: 9, roomName: 'small' } }
  const created = await h.request('/v1/rooms', h.alice.token, request)
  assert.equal(created.status, 200)
  assert.equal(created.body.config.boardSize, 9)
  const invalid = await h.request('/v1/rooms', h.alice.token, { ...request, config: { boardSize: 8 } })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.error.code, 'invalid_game_config')
})
