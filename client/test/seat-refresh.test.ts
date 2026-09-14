import assert from 'node:assert/strict'
import test from 'node:test'
import { startSeatRefresh } from '../src/data/seat-refresh.js'

test('read-only recovery backs off, resumes after a short failure, and stops after five failures', async () => {
  let scheduled: (() => void) | undefined
  const delays: number[] = []
  let fail = true
  let changed = 0, exhausted = 0, recovered = 0
  const stop = startSeatRefresh({
    refresh: async () => {
      if (fail) throw Error('offline')
      return 3
    },
    changed: () => changed++,
    recovered: () => recovered++,
    failed: () => exhausted++,
    schedule: (callback, delay) => {
      scheduled = callback
      delays.push(delay)
      return () => scheduled = undefined
    },
  })
  const tick = async () => {
    const next = scheduled!
    scheduled = undefined
    next()
    await new Promise(resolve => setImmediate(resolve))
  }
  await tick()
  await tick()
  fail = false
  await tick()
  assert.equal(changed, 1)
  assert.equal(recovered, 1)
  assert.deepEqual(delays, [1500, 3000, 6000, 1500])
  fail = true
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(exhausted, 1)
  assert.equal(scheduled, undefined)
  stop()
})

test('disposing an in-flight refresh ignores late results and cancels further polling', async () => {
  let scheduled: (() => void) | undefined
  let release!: (value: number) => void
  let changed = 0
  const stop = startSeatRefresh({
    refresh: () => new Promise<number>(resolve => release = resolve),
    changed: () => changed++,
    recovered: () => assert.fail('disposed result'),
    failed: () => assert.fail('disposed error'),
    schedule: callback => {
      scheduled = callback
      return () => scheduled = undefined
    },
  })
  scheduled!()
  stop()
  release(4)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(changed, 0)
  assert.equal(scheduled, undefined)
})
