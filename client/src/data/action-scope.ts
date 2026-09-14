export type PageAction = { signal: AbortSignal }
/** Each effect activation owns its controller and submission lock, including Fast Refresh reactivation. */
export class ActionScope {
  private controller?: AbortController
  private pending?: PageAction
  activate() {
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.pending = undefined
    return () => {
      controller.abort()
      if (this.controller === controller) {
        this.controller = undefined
        this.pending = undefined
      }
    }
  }
  begin(): PageAction | undefined {
    if (!this.controller || this.controller.signal.aborted || this.pending) return
    const action = { signal: this.controller.signal }
    this.pending = action
    return action
  }
  owns(action: PageAction) {
    return this.pending === action && this.controller?.signal === action.signal && !action.signal.aborted
  }
  finish(action: PageAction) {
    if (!this.owns(action)) return false
    this.pending = undefined
    return true
  }
}

export function runPageAction(scope: ActionScope, operation: (signal: AbortSignal) => Promise<void>, effects: {
  busy: (busy: boolean) => void
  error: (message: string) => void
  complete: () => void
}) {
  const action = scope.begin()
  if (!action) return
  effects.busy(true)
  effects.error('')
  return Promise.resolve().then(() => {
    action.signal.throwIfAborted()
    return operation(action.signal)
  }).then(() => {
    if (scope.owns(action)) effects.complete()
  }).catch(error => {
    if (scope.owns(action)) effects.error(error instanceof Error ? error.message : '操作失败')
  }).finally(() => {
    if (scope.finish(action)) effects.busy(false)
  })
}
