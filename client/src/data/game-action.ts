import type { Seat } from './model.js'
import type { GameRoomPort } from './port.js'

export function canResumeFinishedGame(seat: Seat) {
  const view = seat.observation as { kind?: string; moves?: number } | null
  return seat.status === 'finished' && seat.canResumeUndo === true && !seat.closed
    && view?.kind === 'gomoku' && typeof view.moves === 'number' && view.moves > 0
}

/** The frame may request this explicit recovery action, never arbitrary finished-game moves. */
export async function performGameAction(port: GameRoomPort, seat: Seat, payload: unknown, signal: AbortSignal) {
  const type = payload && typeof payload === 'object' ? (payload as { type?: unknown }).type : undefined
  if (type === 'resume-undo') {
    if (!canResumeFinishedGame(seat) || !port.resumeUndo) throw new Error('当前对局无法悔棋继续')
    return port.resumeUndo(seat, signal)
  }
  if (seat.status !== 'playing' || !port.act) throw new Error('当前回合无法落子')
  return port.act(seat, payload, signal)
}

/** Leaving the view is distinct from removing a seat in a waiting room. */
export async function leaveGameView(port: GameRoomPort, seat: Seat, signal: AbortSignal) {
  if (seat.closed || ['playing', 'finished', 'aborted'].includes(seat.status ?? '')) return
  await port.leave(seat, signal)
}
