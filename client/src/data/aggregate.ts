import type { SourceState } from './model.js'
import type { GameRoomPort } from './port.js'
/** Independent requests publish incrementally. Replacement and disposal fence stale completions. */
export class SourceAggregator {
  private generation = 0
  private controllers: AbortController[] = []
  private disposed = false
  private states: SourceState[] = []
  constructor(
    private port: GameRoomPort,
    private publish: (states: SourceState[]) => void,
    private timeoutMs = 15000,
    private prepareTimeoutMs = 30000,
    initialStates: readonly SourceState[] = [],
  ) {
    this.states = initialStates.map(state => ({ ...state, source: { ...state.source } }))
  }
  async refresh(): Promise<void> {
    if (this.disposed) return
    this.cancel()
    const generation = ++this.generation
    const states: SourceState[] = this.port.sources.filter(source => source.enabled).map(source => {
      const previous = this.states.find(state =>
        state.source.id === source.id && state.source.url === source.url
        && state.source.accountId === source.accountId
      )
      return previous && previous.state !== 'loading' ? { ...previous, source } : { source, state: 'loading' }
    })
    this.states = [...states]
    this.publish([...states])
    await Promise.allSettled(states.map(async (state, index) => {
      const controller = new AbortController()
      this.controllers.push(controller)
      let timer: ReturnType<typeof setTimeout> | undefined
      let prepareTimer: ReturnType<typeof setTimeout> | undefined
      const abort = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      )
      try {
        // Human authorization has its own budget; repeated broadcasts cannot extend either deadline.
        prepareTimer = setTimeout(() => controller.abort(new Error('来源连接准备超时')), this.prepareTimeoutMs)
        await Promise.race([this.port.prepareSource?.(state.source, controller.signal), abort])
        clearTimeout(prepareTimer)
        controller.signal.throwIfAborted()
        timer = setTimeout(() => controller.abort(new Error('来源响应超时')), this.timeoutMs)
        const snapshot = await Promise.race([this.port.list(state.source, controller.signal), abort])
        states[index] = {
          source: state.source,
          state: snapshot.compatible ? 'online' : 'incompatible',
          snapshot,
          error: snapshot.reason,
        }
      } catch (error) {
        states[index] = {
          source: state.source,
          state: 'offline',
          error: error instanceof Error ? error.message : '连接失败',
        }
      } finally {
        clearTimeout(timer)
        clearTimeout(prepareTimer)
        if (!this.disposed && generation === this.generation) {
          this.states = [...states]
          this.publish([...states])
        }
      }
    }))
  }
  private cancel() {
    for (const controller of this.controllers) controller.abort()
    this.controllers = []
  }
  dispose() {
    this.disposed = true
    this.generation++
    this.cancel()
  }
}
