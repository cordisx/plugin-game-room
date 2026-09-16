import type { Balance } from './model.js'
export type WalletRefreshState = { status: 'ready' | 'unavailable'; balances: Balance[] }

/** Sequential read-only polling publishes only changed wallet identity, availability or amounts. */
export function startWalletRefresh(
  read: (signal: AbortSignal) => Promise<WalletRefreshState>,
  changed: () => void,
  intervalMs = 2000,
  isCurrent: () => boolean = () => true,
): () => void {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous: string | undefined
  const refresh = async () => {
    if (controller.signal.aborted || !isCurrent()) return
    let state: WalletRefreshState
    try {
      state = await read(controller.signal)
    } catch {
      state = { status: 'unavailable', balances: [] }
    }
    if (controller.signal.aborted || !isCurrent()) return
    const key = JSON.stringify({
      status: state.status,
      balances: state.status === 'ready'
        ? state.balances.map(({ economyId, accountId, origin, available, reserved }) => ({
          economyId,
          accountId,
          origin,
          available,
          reserved,
        })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : [],
    })
    if (key !== previous) {
      previous = key
      changed()
    }
    if (!controller.signal.aborted && isCurrent()) timer = setTimeout(refresh, intervalMs)
  }
  void refresh()
  return () => {
    controller.abort()
    clearTimeout(timer)
  }
}
