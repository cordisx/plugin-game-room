import type { Seat } from '../sdk/index.js'
import { integer, requireThat } from './errors.js'
/** Stable public chair positions. Rules retain their compact, ordered participant array. */
export function seatPosition(seat: Seat, ordinal: number) {
  return seat.seatIndex ?? ordinal
}
export function allocateSeat(seats: Seat[], capacity: number, target?: unknown) {
  const occupied = new Set(seats.map(seatPosition))
  const position = target === undefined
    ? Array.from({ length: capacity }, (_, index) => index).find(index => !occupied.has(index))
    : target
  requireThat(integer(position, 0, capacity - 1), 'invalid_seat_index')
  requireThat(!occupied.has(position), 'seat_occupied', 409)
  // Upgrade only this room as part of an authorized membership command.
  seats.forEach((seat, ordinal) => seat.seatIndex ??= ordinal)
  return position
}
export function orderSeats(seats: Seat[]) {
  seats.sort((a, b) => a.seatIndex! - b.seatIndex!)
}
