import assert from 'node:assert/strict'
import test from 'node:test'
import { reconnectSeat } from '../src/data/reconnect-seat.js'
import { RequestFailure } from '../src/data/http.js'
import type { GameRoomPort } from '../src/data/port.js'
import type { Seat } from '../src/data/model.js'
const seat = { seatId: 'original-seat', room: { sourceId: 'source', id: 'room' } } as Seat

test('expired session reconnects the account and reads the original seat', async () => {
  let reads = 0
  const port = {
    refreshSeat: async (current: Seat) => {
      assert.equal(current, seat)
      if (++reads === 1) throw new RequestFailure('session_unavailable', 'rejected')
      return current
    },
    connect: async (source: string, mode: string) => {
      assert.equal(source, 'source')
      assert.equal(mode, 'account')
    },
  } as unknown as GameRoomPort
  assert.equal(await reconnectSeat(port, seat, new AbortController().signal), seat)
  assert.equal(reads, 2)
})
test('network uncertainty does not create a new identity or retry a mutation', async () => {
  const error = new RequestFailure('timeout', 'uncertain')
  const port = {
    refreshSeat: async () => {
      throw error
    },
    connect: async () => assert.fail('must not login on timeout'),
  } as unknown as GameRoomPort
  await assert.rejects(reconnectSeat(port, seat, new AbortController().signal), error)
})
test('leaving while login is pending cancels the subsequent seat read', async () => {
  const abort = new AbortController()
  let reads = 0
  const port = {
    refreshSeat: async () => {
      reads++
      throw new RequestFailure('session_unavailable', 'rejected')
    },
    connect: async () => {
      abort.abort()
    },
  } as unknown as GameRoomPort
  await assert.rejects(reconnectSeat(port, seat, abort.signal), { name: 'AbortError' })
  assert.equal(reads, 1)
})
