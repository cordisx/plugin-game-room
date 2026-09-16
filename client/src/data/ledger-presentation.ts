import type { LedgerRecord } from './model.js'
/** Reserved funds still belong to the wallet; only total-balance deltas are income/spending. */
export function ledgerMovement(row: Pick<LedgerRecord, 'availableDelta' | 'reservedDelta'>) {
  const total = row.availableDelta + row.reservedDelta
  if (total < 0) return { label: '支出', amount: total }
  if (total > 0) return { label: '收入', amount: total }
  if (row.reservedDelta > 0) return { label: '冻结', amount: row.reservedDelta }
  if (row.reservedDelta < 0) return { label: '释放冻结', amount: -row.reservedDelta }
  return { label: '余额调整', amount: 0 }
}
