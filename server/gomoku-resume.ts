import type { Json } from '../sdk/index.js'
import type { Room } from './engine.js'
import { requireThat } from './errors.js'
import pkg from '../sdk/builtin/gomoku-1.6.0.json' with { type: 'json' }
export const undoPackage = pkg
const compatible = new Set([
  '80e5626780b64d4a29c0cba073816fe0524a6ba7ac51aa40ffda702401219b41',
  '4ce550ff5cf585984dd1d688a8671dde9400f7b1055405ab68104fb847ab4fe0',
])
export function canResumeGomoku(room: Room, accountId: string) {
  return compatible.has(room.packageHash) && room.mode === 'score' && !room.walletSpend
    && room.closedAt === undefined && ['playing', 'finished'].includes(room.status)
    && room.creatorAccountId === accountId && room.seats.length === 2
    && room.seats.some(s => s.kind === 'human' && s.accountId === accountId)
    && room.seats.some(s => s.kind === 'bot' || s.kind === 'agent')
}
type Move = { x: number; y: number; seat: number }
type Position = { size: number; board: (number | null)[]; moves: number; history?: Move[]; lastMove?: Move }
/** Rebuild legacy move history from the immutable per-seat event journal. */
export function resumedPosition(room: Room, seatIndex: number, events: { body: string }[]): Json {
  const current = room.state as unknown as Position
  requireThat(current && Array.isArray(current.board), 'undo_history_unavailable', 409)
  const history: Move[] = current.history ? structuredClone(current.history) : []
  if (!current.history) {
    for (const { body } of events) {
      const event = JSON.parse(body)
      const view = event.views[room.seats[seatIndex].id]
      if (view?.matchId !== room.matchId) continue
      const v = view.observation as Position | undefined
      if (v?.lastMove && v.moves > 0 && v.moves <= current.moves) history[v.moves - 1] = v.lastMove
    }
  }
  const board = Array(current.board.length).fill(null)
  requireThat(history.length === current.moves, 'undo_history_unavailable', 409)
  for (let i = 0; i < history.length; i++) {
    const move = history[i]
    requireThat(
      move && move.seat === i % 2 && Number.isInteger(move.x) && Number.isInteger(move.y)
        && move.x >= 0 && move.x < current.size && move.y >= 0 && move.y < current.size,
      'undo_history_unavailable',
      409,
    )
    const cell = move.y * current.size + move.x
    requireThat(board[cell] === null, 'undo_history_unavailable', 409)
    board[cell] = move.seat
  }
  requireThat(JSON.stringify(board) === JSON.stringify(current.board), 'undo_history_mismatch', 409)
  const cut = history.findLastIndex(move => move.seat === seatIndex)
  requireThat(cut >= 0, 'nothing_to_undo', 409)
  for (const move of history.slice(cut)) board[move.y * current.size + move.x] = null
  const kept = history.slice(0, cut)
  return {
    size: current.size,
    board,
    moves: kept.length,
    history: kept,
    lastMove: kept.at(-1) ?? null,
    turn: seatIndex,
    undo: null,
    result: null,
  }
}
