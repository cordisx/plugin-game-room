/** Read-only polling: mutations are never replayed during connection recovery. */
export function startSeatRefresh<T>(options: {
  refresh: (signal: AbortSignal) => Promise<T>
  changed: (seat: T) => void
  failed: (message: string) => void
  recovered: (seat: T) => void
  initialDelay?: number
  schedule?: (callback: () => void, delay: number) => () => void
}) {
  const abort = new AbortController()
  let failures = 0
  let cancel: (() => void) | undefined
  const schedule = options.schedule ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay)
    return () => clearTimeout(timer)
  })
  const poll = async () => {
    try {
      const seat = await options.refresh(abort.signal)
      if (abort.signal.aborted) return
      options.changed(seat)
      options.recovered(seat)
      failures = 0
    } catch (error) {
      if (abort.signal.aborted) return
      failures++
      if (failures >= 5) {
        options.failed(error instanceof Error ? error.message : '对局连接中断')
        return
      }
    }
    if (!abort.signal.aborted) {
      cancel = schedule(() => void poll(), Math.min(1500 * 2 ** failures, 12000))
    }
  }
  cancel = schedule(() => void poll(), options.initialDelay ?? 1500)
  return () => {
    abort.abort()
    cancel?.()
  }
}

/** After a committed move, prompt request-driven servers to answer the bot turn immediately. */
export function awaitingRulesBot(seat: import('./model.js').Seat | undefined) {
  if (seat?.status !== 'playing') return false
  const view = seat.observation as { turn?: number | null } | null
  return typeof view?.turn === 'number'
    && seat.gameParticipants?.some(player => player.seatIndex === view.turn && player.kind === 'bot') === true
}
