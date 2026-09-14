import type { Room } from './engine.js'
import { requireThat } from './errors.js'
/** A historical transaction is never promoted into the new local-spend protocol. */
export function historicalTokenRoom(room: Room) {
  return room.mode === 'token' && !room.walletSpend
}
export function writableRoom(room: Room) {
  requireThat(room.closedAt === undefined, 'room_closed', 409)
  requireThat(!historicalTokenRoom(room), 'legacy_transaction_read_only', 410)
  return room
}
export function legacyRecovery(room: Room) {
  requireThat(historicalTokenRoom(room), 'not_legacy_transaction', 404)
  return structuredClone({
    contract: 'game-room.legacy-recovery/v1',
    readOnly: true,
    roomId: room.id,
    matchId: room.matchId,
    version: room.version,
    status: room.status,
    settlement: room.settlement,
    economyIdentity: room.economyIdentity,
    funding: room.funding,
    terms: room.economyTerms,
    operation: room.economyOp,
    fundingDeadline: room.fundingDeadline,
    automaticRelease: false,
  })
}
