import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LivePort } from '../src/data/live-restored.js'
import { consentFor, type Source } from '../src/data/model.js'
import { settlementLabel } from '../src/data/settlement-label.js'

test('known policies use readable labels; unknown or author-supplied text is preserved', () => {
  assert.equal(settlementLabel('equal-winners-v1'), '胜者均分；余数按席位顺序分配，无胜者时退回各自投入')
  assert.equal(settlementLabel('conserved-payouts-v1'), '按游戏结果分配，总额等于全桌投入')
  for (const value of ['custom-policy-v2', '作者规则：按积分分配', 'equal-winners-v1 · 自定义说明']) {
    assert.equal(settlementLabel(value), value)
  }
})

test('live rules omit only the generated hash line, preserving author text and consent identity', async () => {
  const source: Source = { id: 'source', name: 'Source', url: 'https://example.test', enabled: true }
  const description = '作者规则\n包哈希：作者自行写入的说明\n请完整保留'
  const manifest = { id: 'game', name: 'Game', version: '1.0.0', modes: ['score'], description }
  const packageHash = 'actual-package-hash'
  const port = new LivePort([source], {
    dispose() {},
    async request({ path }) {
      if (path === '/v1/handshake') {
        return { serverId: source.id, protocol: 'game-room/1', gamePackageVersion: 1, uiFormats: ['scene-v1'] }
      }
      if (path === '/v1/packages') return { packages: [{ hash: packageHash, publisherId: 'author', manifest }] }
      if (path === '/v1/rooms') {
        return {
          rooms: [{
            serverId: source.id,
            id: 'room',
            config: {},
            seats: [],
            manifest,
            packageHash,
            maxPlayers: 2,
            status: 'waiting',
            mode: 'score',
            stake: 0,
            reviewState: 'unreviewed',
            turnTimeoutMs: 60000,
            policy: 'equal-winners-v1',
          }],
        }
      }
      throw new Error(`Unexpected request: ${path}`)
    },
  })
  try {
    const room = (await port.list(source, new AbortController().signal)).rooms[0]!
    assert.equal(room.rules, `${description}\n每步时限 60 秒`)
    assert.equal(room.game.packageHash, packageHash)
    assert.equal(room.settlement, 'equal-winners-v1')
    const consent = consentFor(room)
    assert.equal(consent.packageHash, packageHash)
    assert.equal(consent.rules, room.rules)
    assert.equal(consent.settlement, 'equal-winners-v1')
  } finally {
    port.dispose()
  }
})
