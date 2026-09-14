import type { GameParticipant } from './model.js'
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
/** Public room-card identity only; never forwards account IDs into an isolated game. */
export function gameParticipants(value: unknown): GameParticipant[] {
  const room = object(value)
  const seats = Array.isArray(room.seats) ? room.seats : []
  return seats.map((value, seatIndex) => {
    const seat = object(value)
    const kind = seat.kind === 'bot' || seat.kind === 'agent' ? seat.kind : 'human'
    const avatar = typeof seat.avatar === 'string' && seat.avatar.length <= 65536
        && /^data:image\/(?:png|jpeg|webp);base64,(?=[A-Za-z0-9+/])(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![\s\S])/
          .test(seat.avatar)
      ? seat.avatar
      : undefined
    return {
      seatIndex: Number.isSafeInteger(seat.seatIndex) ? Number(seat.seatIndex) : seatIndex,
      name: typeof seat.name === 'string' && seat.name ? seat.name.slice(0, 128) : '玩家',
      kind,
      isOwner: kind !== 'bot' && typeof room.creatorAccountId === 'string'
        && seat.accountId === room.creatorAccountId,
      ...(avatar ? { avatar } : {}),
    }
  })
}
