import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canResumeFinishedGame, leaveGameView, performGameAction } from '../src/data/game-action.js'
import type { Seat } from '../src/data/model.js'
import type { GameRoomPort } from '../src/data/port.js'

test('finished score game resumes its original seat through explicit undo, never ordinary moves', async () => {
  const seat = { status: 'finished', canResumeUndo: true, observation: { kind: 'gomoku', moves: 36 } } as Seat
  const resumed = { ...seat, status: 'playing' } as Seat
  let calls = 0
  const port = {
    resumeUndo: async (original: Seat) => {
      assert.equal(original, seat)
      calls++
      return resumed
    },
  } as GameRoomPort
  const signal = new AbortController().signal
  assert.equal(canResumeFinishedGame(seat), true)
  assert.equal(await performGameAction(port, seat, { type: 'resume-undo' }, signal), resumed)
  await assert.rejects(performGameAction(port, seat, { type: 'place', x: 1, y: 1 }, signal))
  for (
    const bad of [{ ...seat, canResumeUndo: false }, { ...seat, closed: true }, {
      ...seat,
      observation: { kind: 'gomoku', moves: 0 },
    }]
  ) {
    assert.equal(canResumeFinishedGame(bad), false)
    await assert.rejects(performGameAction(port, bad, { type: 'resume-undo' }, signal))
  }
  assert.equal(calls, 1)
})

test('returning to lobby after start or finish never calls the waiting-seat removal endpoint', async () => {
  const { leaveGameView } = await import('../src/data/game-action.js')
  let calls = 0
  const port = {
    leave: async () => {
      calls++
    },
  } as unknown as GameRoomPort
  const signal = new AbortController().signal
  for (const status of ['playing', 'finished', 'aborted'] as const) {
    await leaveGameView(port, { status, room: { game: {} } } as Seat, signal)
  }
  assert.equal(calls, 0)
  await leaveGameView(port, { status: 'waiting', room: { game: {} } } as Seat, signal)
  await leaveGameView(port, { status: 'funding', room: { game: {} } } as Seat, signal)
  assert.equal(calls, 2)
})

test('new game exit calls the authoritative leave endpoint even while playing', async () => {
  let calls = 0
  const port = {
    leave: async () => {
      calls++
    },
  } as unknown as GameRoomPort
  const seat = { status: 'playing', room: { game: { playerExit: true } } } as Seat
  await leaveGameView(port, seat, new AbortController().signal)
  assert.equal(calls, 1)
})
