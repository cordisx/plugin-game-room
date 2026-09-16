import { beginPanelRefresh, finishPanelRefresh, type PanelResult, requestPanel } from './panel-results.js'
import { useEffect, useState } from 'cordisx/react'
export type PanelResource<T> = PanelResult<T> & { retry: () => void }
/** A resource owns its cancellation and polls only after its previous request settles. */
export function usePanelResource<T>(
  owner: object,
  load: (signal: AbortSignal) => Promise<T[]>,
  epoch: number,
  poll = false,
): PanelResource<T> {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ owner: object; result: PanelResult<T> }>({
    owner,
    result: { data: [], status: 'loading' },
  })
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      setState(previous => ({ owner, result: beginPanelRefresh(previous.result, previous.owner === owner) }))
      await requestPanel(load, controller.signal, result => {
        setState(previous => ({ owner, result: finishPanelRefresh(previous.result, result) }))
      })
      if (poll && !controller.signal.aborted) timer = setTimeout(refresh, 2000)
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
    // load is bound to owner; callers use the same port method for the lifetime of this hook.
  }, [owner, epoch, attempt, poll])
  return {
    ...(state.owner === owner ? state.result : { data: [], status: 'loading' as const }),
    retry: () => setAttempt(value => value + 1),
  }
}
