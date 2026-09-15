import assert from 'node:assert/strict'
import test from 'node:test'
import { allocateTokenPool } from '../../sdk/pool-allocation.js'

test('Gomoku winner receives the funded pool; draw refunds each original deposit', () => {
  assert.deepEqual(allocateTokenPool([100, 100], { kind: 'weighted', weights: [0, 1] }), [0, 200])
  assert.deepEqual(allocateTokenPool([100, 200], { kind: 'refund' }), [100, 200])
})
test('Holdem chip ratios allocate existing Token including deterministic indivisible remainders', () => {
  assert.deepEqual(allocateTokenPool([100, 100], { kind: 'weighted', weights: [750, 1250] }), [75, 125])
  assert.deepEqual(allocateTokenPool([1, 1, 3], { kind: 'weighted', weights: [1, 1, 0] }), [3, 2, 0])
})
test('unsafe arithmetic, invented recipients and empty winner sets fail closed', () => {
  for (const deposits of [[], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER, 1]]) {
    assert.throws(() => allocateTokenPool(deposits, { kind: 'refund' }))
  }
  for (const weights of [[1], [0, 0], [-1, 2], [1, 0.5]]) {
    assert.throws(() => allocateTokenPool([100, 100], { kind: 'weighted', weights }))
  }
})
test('large safe deposits conserve every coin without floating-point multiplication', () => {
  const input = [Number.MAX_SAFE_INTEGER - 10, 10]
  const result = allocateTokenPool(input, { kind: 'weighted', weights: [Number.MAX_SAFE_INTEGER, 1] })
  assert.equal(result.reduce((sum, n) => sum + BigInt(n), 0n), BigInt(Number.MAX_SAFE_INTEGER))
  assert.ok(result.every(Number.isSafeInteger))
})
