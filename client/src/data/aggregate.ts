import type { SourceState } from './model.js'
import type { GameRoomPort } from './port.js'
/** Independent requests publish incrementally. Replacement and disposal fence stale completions. */
export class SourceAggregator {
  private generation = 0
  private controllers: AbortController[] = []
  private disposed = false
  constructor(private port: GameRoomPort, private publish: (states: SourceState[]) => void, private timeoutMs = 8000) {}
  async refresh(): Promise<void> {
    if (this.disposed) return
    this.cancel()
    const generation = ++this.generation
    const states: SourceState[] = this.port.sources.filter(source => source.enabled).map(source => ({
      source,
      state: 'loading',
    }))
    this.publish([...states])
    await Promise.allSettled(states.map(async (state, index) => {
      const controller = new AbortController()
      this.controllers.push(controller)
      let timer: ReturnType<typeof setTimeout> | undefined
      const abort = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      )
      try {
        // Human authorization is cancellable, but is not network latency.
        await Promise.race([this.port.prepareSource?.(state.source, controller.signal), abort])
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
        if (!this.disposed && generation === this.generation) this.publish([...states])
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
