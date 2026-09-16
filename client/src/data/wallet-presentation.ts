import type { Balance, LedgerRecord } from './model.js'
import type { GameRoomPort } from './port.js'
import type { PanelResource } from './use-panel-resource.js'
type WalletViewPort = Pick<GameRoomPort, 'walletMode' | 'walletStatus'>
export function walletBalanceResource(port: WalletViewPort, resource: PanelResource<Balance>): PanelResource<Balance> {
  if (port.walletMode?.() !== 'canonical-local') {
    return { ...resource, data: [], status: 'error', stale: false, error: '钱包暂时不可用，请重试。' }
  }
  if (port.walletStatus?.() !== 'ready' || resource.status === 'error' || resource.stale) {
    return {
      ...resource,
      data: [],
      status: 'error',
      stale: false,
      error: '钱包暂时不可用，请重试。',
    }
  }
  if (
    resource.status === 'ready'
    && (resource.data.length !== 1 || resource.data[0]?.economyId === 'local-game-room-test')
  ) {
    return {
      ...resource,
      data: [],
      status: 'error',
      stale: false,
      error: '余额暂时不可用，请重试。',
    }
  }
  return resource
}
export function walletLedgerResource(
  port: WalletViewPort,
  resource: PanelResource<LedgerRecord>,
  balances: PanelResource<Balance>,
): PanelResource<LedgerRecord> {
  if (
    port.walletMode?.() === 'canonical-local'
    && (port.walletStatus?.() !== 'ready' || resource.status === 'error' || resource.stale)
  ) {
    return {
      ...resource,
      data: [],
      status: 'error',
      stale: false,
      error: '收支记录暂时不可用，请重试。',
    }
  }
  const wallet = balances.data[0]
  return {
    ...resource,
    data: resource.data.filter(row =>
      wallet && row.economyId === wallet.economyId && row.accountId === wallet.accountId
    ),
  }
}
