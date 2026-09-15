/** Integer-only allocation of an already funded pool. This never moves wallet funds. */
export function allocateTokenPool(
  deposits: readonly number[],
  outcome: { kind: 'refund' } | { kind: 'weighted'; weights: readonly number[] },
): number[] {
  if (!deposits.length || deposits.length > 32 || deposits.some(n => !Number.isSafeInteger(n) || n <= 0)) {
    throw new Error('invalid_pool_deposits')
  }
  const total = deposits.reduce((sum, n) => sum + BigInt(n), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('pool_total_overflow')
  if (outcome.kind === 'refund') return [...deposits]
  const weights = outcome.weights
  if (weights.length !== deposits.length || weights.some(n => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error('invalid_pool_weights')
  }
  const denominator = weights.reduce((sum, n) => sum + BigInt(n), 0n)
  if (denominator === 0n) throw new Error('empty_pool_recipients')
  const shares = weights.map((weight, seat) => {
    const numerator = total * BigInt(weight)
    return { seat, amount: numerator / denominator, remainder: numerator % denominator }
  })
  let remainder = total - shares.reduce((sum, share) => sum + share.amount, 0n)
  const priority = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.seat - b.seat : a.remainder > b.remainder ? -1 : 1
  )
  for (const share of priority) {
    if (remainder === 0n) break
    share.amount++
    remainder--
  }
  return shares.map(share => Number(share.amount))
}
