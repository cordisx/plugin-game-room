import assert from 'node:assert/strict'
import test from 'node:test'
import { LivePort } from '../src/data/live-restored.js'
import type { Seat } from '../src/data/model.js'

test('score refresh and committed move are independent of a stalled wallet recovery', async () => {
  const seat = {
    status: 'playing',
    version: 8,
    seatId: 's',
    matchId: 'm',
    room: { id: 'r', sourceId: 'source' },
  } as Seat
  const paths: string[] = []
  const receiver = {
    pendingActions: new Map(),
    spend: {
      recover: async () => {
        assert.fail('score play must not wait for wallet recovery')
      },
    },
    request: async (_id: string, path: string) => {
      paths.push(path)
      return seat
    },
    seat: async (_id: string, value: Seat) => value,
  } as unknown as LivePort
  const signal = new AbortController().signal
  assert.equal(await LivePort.prototype.refreshSeat.call(receiver, seat, signal), seat)
  assert.equal(await LivePort.prototype.act.call(receiver, seat, { type: 'place', x: 1, y: 1 }, signal), seat)
  assert.deepEqual(paths, ['/v1/rooms/r?seatId=s', '/v1/rooms/r/actions'])
})
