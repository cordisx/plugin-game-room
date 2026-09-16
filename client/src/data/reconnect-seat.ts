import { RequestFailure } from './http.js'
import type { GameRoomPort } from './port.js'
import type { Seat } from './model.js'

/** Recover the same account and seat; never join again or replay a game action. */
export async function reconnectSeat(port: GameRoomPort, seat: Seat, signal: AbortSignal) {
  if (!port.refreshSeat) throw new Error('无法恢复连接')
  signal.throwIfAborted()
  try {
    return await port.refreshSeat(seat, signal)
  } catch (error) {
    if (
      !(error instanceof RequestFailure)
      || !['session_unavailable', 'session_identity_changed'].includes(error.code)
      || !port.connect
    ) throw error
    signal.throwIfAborted()
    await port.connect(seat.room.sourceId, 'account')
    signal.throwIfAborted()
    return port.refreshSeat(seat, signal)
  }
}
