import type { Balance } from './model.js'
import type { PanelResult } from './panel-results.js'
/** Never combines balances from independent instances or labels a missing wallet as zero. */
export function headerBalanceLabel(resource: PanelResult<Balance>): string {
  if (resource.status === 'loading') return '…'
  if (resource.status === 'error') return '—'
  if (resource.data.length > 1) return '我的资产'
  if (!resource.data.length) return '—'
  return resource.data[0].available.toLocaleString()
}

/** Accessible currency stays complete while the visible amount uses its coin asset. */
export function headerBalanceAccessibleLabel(resource: PanelResult<Balance>): string {
  if (resource.status === 'loading') return 'Token 余额正在加载'
  if (resource.status === 'error') return 'Token 余额连接不可用'
  if (resource.data.length > 1) return '我的资产'
  if (!resource.data.length) return 'Token 余额未知'
  return `${resource.data[0].available.toLocaleString()} Token`
}
