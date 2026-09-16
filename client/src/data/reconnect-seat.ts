import type { GameRoomPort } from './port.js'
import type { Seat } from './model.js'

/** Recover the same account and seat; never join again or replay a game action. */
export async function reconnectSeat(port: GameRoomPort, seat: Seat, signal: AbortSignal) {
  if (!port.refreshSeat) throw new Error('无法恢复连接')
  signal.throwIfAborted()
  if (port.isConnected?.(seat.room.sourceId) === false && port.connect) {
    await port.connect(seat.room.sourceId, 'account')
    signal.throwIfAborted()
    return port.refreshSeat(seat, signal)
  }
  try {
    return await port.refreshSeat(seat, signal)
  } catch (error) {
    if (
      !error || typeof error !== 'object' || !('code' in error)
      || !['session_unavailable', 'session_identity_changed'].includes(String(error.code))
      || !port.connect
    ) throw error
    signal.throwIfAborted()
    await port.connect(seat.room.sourceId, 'account')
    signal.throwIfAborted()
    return port.refreshSeat(seat, signal)
  }
}
