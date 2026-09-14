/** Internal partial-read failure; the port's array contract stays unchanged. */
export class PartialPanelError<T> extends Error {
  constructor(message: string, readonly data: T[]) {
    super(message)
    this.name = 'PartialPanelError'
  }
}
export function collectPanelResults<T>(results: PromiseSettledResult<T[]>[], labels: string[]): T[] {
  const data = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const failures = results.flatMap((result, index) => result.status === 'rejected' ? [labels[index] ?? '来源'] : [])
  if (failures.length) throw new PartialPanelError(`以下来源加载失败：${failures.join('、')}。请重试。`, data)
  return data
}
export type PanelResult<T> = {
  data: T[]
  status: 'loading' | 'ready' | 'error'
  error?: string
  refreshing?: boolean
  stale?: boolean
}
export function beginPanelRefresh<T>(previous: PanelResult<T>, sameOwner: boolean): PanelResult<T> {
  return sameOwner ? { ...previous, refreshing: true } : { data: [], status: 'loading' }
}
export function finishPanelRefresh<T>(previous: PanelResult<T>, result: PanelResult<T>): PanelResult<T> {
  if (result.status === 'error' && !result.data.length && previous.data.length) {
    return { ...result, data: previous.data, stale: true }
  }
  return result
}
export async function requestPanel<T>(
  load: (signal: AbortSignal) => Promise<T[]>,
  signal: AbortSignal,
  publish: (state: PanelResult<T>) => void,
) {
  try {
    const data = await load(signal)
    if (!signal.aborted) publish({ data, status: 'ready' })
  } catch (error) {
    if (!signal.aborted) {
      publish({
        data: error instanceof PartialPanelError ? error.data : [],
        status: 'error',
        error: error instanceof Error ? error.message : '请求失败',
      })
    }
  }
}
