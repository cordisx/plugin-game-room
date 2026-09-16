import { consentFor } from './model.js'
import Schema from '@deepseek-ai/schemastery'
import type { Agent, Room, Seat } from './model.js'
export function compatibleAgentRooms(agent: Agent, rooms: Room[]) {
  return rooms.filter(room =>
    room.allowAgents && room.compatible && room.state === 'waiting' && room.occupied < room.capacity
    && agent.games.includes(room.game.id)
  )
}
export function validActionBudget(value: number) {
  return Number.isSafeInteger(value) && value > 0
}
export function agentDispatchSchema(rooms: Room[]) {
  const label = (node: Schema, text: string) => node.extra('extra', { label: text })
  return Schema.object({
    roomKey: label(
      Schema.union([
        label(Schema.const(''), '选择可用房间'),
        ...rooms.map(room => label(Schema.const(`${room.sourceId}/${room.id}`), room.name)),
      ]).required(),
      '目标房间',
    ),
    budget: label(Schema.natural().min(1).max(Number.MAX_SAFE_INTEGER).required(), '最多动作次数'),
  })
}
export function quoteExpired(expiresAt: number, now: number) {
  return !Number.isFinite(expiresAt) || expiresAt <= now
}

export function prepareConsentKey(seat: Seat) {
  return JSON.stringify([seat.room.sourceId, seat.room.id, seat.seatId, seat.matchId, consentFor(seat.room)])
}
