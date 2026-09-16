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

test('human authorization is outside the network budget and can be cancelled', async () => {
  const port = new SamplePort()
  let allow!: () => void
  const authorization = new Promise<void>(resolve => {
    allow = resolve
  })
  const prepared = Object.assign(port, { prepareSource: () => authorization })
  const events: SourceState[][] = []
  const aggregate = new SourceAggregator(prepared, states => events.push(states), 5)
  const pending = aggregate.refresh()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(events.at(-1)!.every(state => state.state === 'loading'))
  allow()
  await pending
  assert.ok(events.at(-1)!.every(state => state.state === 'online'))
  aggregate.dispose()
  const cancelled = new SourceAggregator(
    Object.assign(new SamplePort(), {
      prepareSource: () => new Promise<void>(() => {}),
    }),
    () => {},
  )
  const waiting = cancelled.refresh()
  cancelled.dispose()
  await waiting
})

test('room state and multiple sources compose; joinable excludes incompatible rooms', async () => {
  const port = new SamplePort()
  const states: SourceState[] = await Promise.all(
    port.sources.map(async source => ({
      source,
      state: 'online',
      snapshot: await port.list(source, new AbortController().signal),
    })),
  )
  const base = { search: '', gameId: '', sourceId: '', vacancy: false, agents: false }
  const all = filterRooms(states, { ...base, status: 'all' })
  assert.ok(all.length > 0)
  assert.deepEqual(filterRooms(states, { ...base, status: 'active' }), all.filter(room => room.state !== 'finished'))
  const sourceIds = states.map(state => state.source.id)
  assert.deepEqual(filterRooms(states, { ...base, status: 'all', sourceIds }), all)
  assert.deepEqual(
    filterRooms(states, { ...base, status: 'all', sourceIds: [sourceIds[0]!] }),
    all.filter(room => room.sourceId === sourceIds[0]),
  )
  const available = all.filter(room => room.compatible && room.state === 'waiting' && room.occupied < room.capacity)
  assert.deepEqual(filterRooms(states, { ...base, status: 'available' }), available)
  if (available[0]) {
    available[0].compatible = false
    assert.ok(!filterRooms(states, { ...base, status: 'available' }).includes(available[0]))
  }
})

test('an unsettled source preparation reaches its separate deadline and exits loading', async () => {
  const port = Object.assign(new SamplePort(), { prepareSource: () => new Promise<void>(() => {}) })
  const events: SourceState[][] = []
  const aggregate = new SourceAggregator(port, states => events.push(states), 5, 10)
  await aggregate.refresh()
  assert.ok(events.at(-1)!.every(state => state.state === 'offline' && state.error === '来源连接准备超时'))
  aggregate.dispose()
})

test('background source refresh retains the last successful listing while the next read is held', async () => {
  const port = new SamplePort(), events: SourceState[][] = []
  const aggregate = new SourceAggregator(port, states => events.push(states))
  await aggregate.refresh()
  const previous = events.at(-1)![0]!.snapshot
  const original = port.list.bind(port)
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  port.list = async (source, signal) => {
    await held
    return original(source, signal)
  }
  const pending = aggregate.refresh()
  await tick()
  assert.equal(events.at(-1)![0]!.state, 'online')
  assert.equal(events.at(-1)![0]!.snapshot, previous)
  release()
  await pending
  aggregate.dispose()
})
