import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SourceAggregator } from '../src/data/aggregate.js'
import { SamplePort } from '../src/data/sample.js'
import { decodeInvitation, encodeInvitation, filterRooms, roomKey, type SourceState } from '../src/data/model.js'
const tick = () => new Promise(resolve => setTimeout(resolve, 1))
test('a failed source does not hold up another source or mix equal room IDs', async () => {
  const port = new SamplePort()
  const original = port.list.bind(port)
  port.list = async (source, signal) => {
    if (source.id === 'community') return new Promise(() => {})
    return original(source, signal)
  }
  const events: SourceState[][] = []
  const aggregate = new SourceAggregator(port, states => events.push(states), 12)
  const pending = aggregate.refresh()
  await tick()
  assert.equal(events.at(-1)![0]!.state, 'online')
  assert.equal(events.at(-1)![1]!.state, 'loading')
  await pending
  assert.equal(events.at(-1)![0]!.state, 'online')
  assert.equal(events.at(-1)![1]!.state, 'offline')
  assert.notEqual(roomKey({ id: 'same', sourceId: 'one' }), roomKey({ id: 'same', sourceId: 'two' }))
  aggregate.dispose()
})
test('disposal and refresh replacement fence late results', async () => {
  const port = new SamplePort()
  let completed = 0
  const original = port.list.bind(port)
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  port.list = async (source, signal) => {
    await gate
    return original(source, signal)
  }
  const aggregate = new SourceAggregator(port, () => completed++)
  const first = aggregate.refresh()
  const second = aggregate.refresh()
  aggregate.dispose()
  const before = completed
  release()
  await Promise.all([first, second])
  assert.equal(completed, before)
})
test('search, source and vacancy filters compose without mutating cached rooms', async () => {
  const port = new SamplePort()
  const states: SourceState[] = await Promise.all(
    port.sources.map(async source => ({
      source,
      state: 'online',
      snapshot: await port.list(source, new AbortController().signal),
    })),
  )
  const filtered = filterRooms(states, {
    search: '落子',
    sourceId: 'friends',
    gameId: 'gomoku',
    vacancy: true,
    agents: true,
  })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]!.name, '落子无悔')
  assert.equal(states[0]!.snapshot!.rooms.length, 3)
})
test('invitation requires a configured enabled source, not a bare room ID', () => {
  const port = new SamplePort()
  const value = { sourceId: 'friends', roomId: 'friends:room:a:b' }
  assert.deepEqual(decodeInvitation(encodeInvitation(value, port.sources), port.sources), {
    ...value,
    sourceUrl: 'https://friends.example',
  })
  assert.throws(() => decodeInvitation('2048', port.sources))
  assert.throws(() => decodeInvitation(encodeInvitation({ sourceId: 'friends', roomId: '2048' }, port.sources), []))
})

test('invitation rejects same server id at another origin', () => {
  const port = new SamplePort()
  const invitation = encodeInvitation({ sourceId: 'friends', roomId: '2048' }, port.sources)
  assert.throws(() => decodeInvitation(invitation, [{ ...port.sources[0]!, url: 'https://different.example' }]))
})
