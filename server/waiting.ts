import type { Room } from './engine.js'
/** Public lifecycle projection; never calls setup or reveals a rule state. */
export function waitingObservation(room: Room, selfSeat: number | null) {
  return {
    phase: room.status === 'funding' ? 'funding' : 'waiting',
    selfSeat,
    config: room.config,
    capacity: room.maxPlayers,
    minPlayers: room.manifest.minPlayers,
    participants: room.seats.map((s, seat) => ({ seat, name: s.name, kind: s.kind, ready: s.ready })),
    legalActions: [],
  }
}
