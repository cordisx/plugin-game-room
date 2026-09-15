import assert from 'node:assert/strict'
import test from 'node:test'
import { cachedSourceStates, cacheSourceStates } from '../src/data/source-state-cache.js'
import { SourceAggregator } from '../src/data/aggregate.js'
import type { GameRoomPort } from '../src/data/port.js'
import type { SourceState } from '../src/data/model.js'

test('returning to create reuses loaded sources while the fresh request is pending', async () => {
  const source = { id: 'one', name: 'One', url: 'https://one.test', accountId: 'a', enabled: true }
  const snapshot = { rooms: [], games: [], compatible: true, protocol: 'game-room/1' }
  let finish!: (value: typeof snapshot) => void
  const port = {
    sources: [source],
    list: () =>
      new Promise(resolve => {
        finish = resolve
      }),
  } as GameRoomPort
  const states: SourceState[] = [{ source, snapshot, state: 'online' }]
  cacheSourceStates(port, 0, states)
  const published: SourceState[][] = []
  const aggregate = new SourceAggregator(
    port,
    value => published.push(value),
    15000,
    30000,
    cachedSourceStates(port, 0),
  )
  const pending = aggregate.refresh()
  assert.equal(published[0]![0]!.state, 'online')
  assert.equal(published[0]![0]!.snapshot, snapshot)
  await new Promise(resolve => setImmediate(resolve))
  finish(snapshot)
  await pending
  aggregate.dispose()
  assert.deepEqual(cachedSourceStates(port, 1), [])
  source.accountId = 'different'
  assert.deepEqual(cachedSourceStates(port, 0), [])
})
