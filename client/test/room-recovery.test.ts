import assert from 'node:assert/strict'
import test from 'node:test'
import { RoomRecovery } from '../src/data/room-recovery.js'
import type { Seat } from '../src/data/model.js'
const a = { status: 'available', subject: 'a' } as const
const unavailable = { status: 'unavailable', reason: 'host-unavailable' } as const
const seat = { seatId: 'existing-seat' } as Seat
test('temporary account loss retains a private recovery candidate only for the same user', () => {
  const recovery = new RoomRecovery()
  assert.equal(recovery.update(a, unavailable, seat), undefined)
  assert.equal(recovery.update(unavailable, a), seat)
  recovery.clear()
  assert.equal(recovery.update(unavailable, a), undefined)
})
test('account switch or explicit signout cannot recover another account seat', () => {
  for (
    const next of [{ status: 'available', subject: 'b' }, { status: 'unavailable', reason: 'signed-out' }] as const
  ) {
    const recovery = new RoomRecovery()
    recovery.update(a, unavailable, seat)
    assert.equal(recovery.update(unavailable, next), undefined)
    assert.equal(recovery.update(unavailable, a), undefined)
  }
})
