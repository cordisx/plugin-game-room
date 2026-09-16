import type { Json, Transition } from '../sdk/index.js'
import { integer, object, requireThat } from './errors.js'
export function transition(value: Json, seats: number): Transition {
  object(value)
  requireThat(Object.hasOwn(value, 'state'), 'invalid_transition', 422)
  requireThat(value.turn === null || integer(value.turn, 0, seats - 1), 'invalid_transition', 422)
  if (value.cashouts !== undefined) {
    requireThat(
      Array.isArray(value.cashouts) && value.cashouts.length === seats
        && value.cashouts.every(n => n === null || integer(n, 0, Number.MAX_SAFE_INTEGER)),
      'invalid_cashouts',
      422,
    )
  }
  if (value.done !== undefined) {
    object(value.done)
    const winners = value.done.winners
    requireThat(
      Array.isArray(winners) && winners.length <= seats && winners.every(w => integer(w, 0, seats - 1))
        && new Set(winners).size === winners.length,
      'invalid_result',
      422,
    )
    requireThat(value.turn === null, 'invalid_result', 422)
    const payouts = value.done.payouts
    requireThat(
      payouts === undefined || Array.isArray(payouts) && payouts.length === seats
          && payouts.every(n => integer(n, 0, Number.MAX_SAFE_INTEGER)),
      'invalid_result',
      422,
    )
    const scores = value.done.scores
    requireThat(
      scores === undefined
        || (Array.isArray(scores) && scores.length === seats
          && scores.every(s => typeof s === 'number' && Number.isFinite(s))),
      'invalid_result',
      422,
    )
  } else requireThat(value.turn !== null, 'invalid_transition', 422)
  return value as unknown as Transition
}
