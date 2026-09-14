import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readInvitation } from '../src/data/invitation-preview.js'
import { SamplePort } from '../src/data/sample.js'
import { encodeInvitation } from '../src/data/model.js'
test('invitation preview reads exact source without joining and blocks stale/full/incompatible rooms', async () => {
  const port = new SamplePort()
  const signal = new AbortController().signal
  const room = (await port.list(port.sources[0]!, signal)).rooms[0]!
  const text = encodeInvitation({ sourceId: room.sourceId, roomId: room.id }, port.sources)
  let joins = 0
  port.join = async () => {
    joins++
    throw Error('should not join')
  }
  assert.equal((await readInvitation(port, text, signal)).room.id, room.id)
  assert.equal(joins, 0)
  const list = port.list.bind(port)
  for (
    const patch of [{ state: 'finished' as const }, { state: 'playing' as const }, { occupied: room.capacity }, {
      compatible: false,
    }, { sourceId: 'other' }]
  ) {
    port.list = async (source, signal) => ({ ...await list(source, signal), rooms: [{ ...room, ...patch }] })
    await assert.rejects(readInvitation(port, text, signal))
  }
  port.list = list
  await assert.rejects(
    readInvitation(
      port,
      text.replace(encodeURIComponent(port.sources[0]!.url), encodeURIComponent('https://unknown.example')),
      signal,
    ),
  )
  assert.equal(joins, 0)
})
test('aborted delayed preview never publishes a room', async () => {
  const port = new SamplePort()
  const controller = new AbortController()
  const room = (await port.list(port.sources[0]!, controller.signal)).rooms[0]!
  const text = encodeInvitation({ sourceId: room.sourceId, roomId: room.id }, port.sources)
  const snapshot = await port.list(port.sources[0]!, controller.signal)
  let finish!: () => void
  port.list = () =>
    new Promise(resolve => {
      finish = () => resolve(snapshot)
    })
  const pending = readInvitation(port, text, controller.signal)
  controller.abort()
  finish()
  await assert.rejects(pending)
})

test('existing participants can preview a full finished room to resume their original seat', async () => {
  const port = new SamplePort()
  const signal = new AbortController().signal
  const snapshot = await port.list(port.sources[0]!, signal)
  const room = { ...snapshot.rooms[0]!, owned: true, state: 'finished' as const, occupied: 2, capacity: 2 }
  port.list = async () => ({ ...snapshot, rooms: [room] })
  const text = encodeInvitation({ sourceId: room.sourceId, roomId: room.id }, port.sources)
  assert.equal((await readInvitation(port, text, signal)).room.id, room.id)
})
