import assert from 'node:assert/strict'
import test from 'node:test'
import '../holdem/ui.js'
test('UI amount shortcuts clamp to legal total-bet bounds and integer steps', () => {
  const bounds = { minTo: 40, maxTo: 1000 }
  for (
    const [input, expected] of [[0, 40], [35, 40], [50, 50], [50.4, 50], [50.6, 51], [1000, 1000], [
      2000,
      1000,
    ], [NaN, 40]]
  ) {
    assert.equal(globalThis.pokerAmount(bounds, input), expected)
  }
  assert.equal(globalThis.pokerAmount({ minTo: 40, maxTo: 40 }, 80), 40)
})
