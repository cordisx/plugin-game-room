import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LivePort } from '../src/data/live-restored.js'
import { type PanelResult, PartialPanelError, requestPanel } from '../src/data/panel-results.js'
import type { Source } from '../src/data/model.js'
const sources: Source[] = ['one', 'two'].map(id => ({
  id,
  name: id,
  enabled: true,
  accountId: id,
  url: `https://${id}.example`,
}))
test('history distinguishes empty, all failed and partial failed sources', async () => {
  let failed: string[] = []
  let records = false
  const port = new LivePort(sources, {
    dispose() {},
    request: async ({ source }) => {
      if (failed.includes(source.id)) throw new Error('offline')
      return {
        rooms: records
          ? [{
            serverId: source.id,
            id: 'r',
            config: { roomName: 'Completed room' },
            seats: [],
            packageHash: 'hash',
            manifest: { id: 'gomoku', name: 'Gomoku', version: '1', modes: ['score'] },
            maxPlayers: 2,
            status: 'finished',
            mode: 'score',
            stake: 0,
            turnTimeoutMs: 1000,
            policy: 'equal',
          }]
          : [],
      }
    },
  })
  const signal = new AbortController().signal
  assert.deepEqual(await port.history(signal), [])
  failed = ['one', 'two']
  await assert.rejects(
    port.history(signal),
    error => error instanceof PartialPanelError && error.data.length === 0 && error.message.includes('one、two'),
  )
  failed = ['one']
  records = true
  await assert.rejects(
    port.history(signal),
    error =>
      error instanceof PartialPanelError && error.data.length === 1 && error.data[0].sourceId === 'two'
      && error.message.includes('one') && !error.message.includes('two'),
  )
  await port.dispose()
})
test('panel requests report errors, retain partial success, recover and ignore canceled completion', async () => {
  const controller = new AbortController()
  const states: PanelResult<number>[] = []
  await requestPanel(
    async () => {
      throw new Error('offline')
    },
    controller.signal,
    state => states.push(state),
  )
  assert.equal(states.at(-1)?.status, 'error')
  await requestPanel(
    async () => {
      throw new PartialPanelError('two failed', [1])
    },
    controller.signal,
    state => states.push(state),
  )
  assert.deepEqual(states.at(-1)?.data, [1])
  await requestPanel(async () => [], controller.signal, state => states.push(state))
  assert.equal(states.at(-1)?.status, 'ready')
  let finish!: (data: number[]) => void
  const pending = requestPanel(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
    controller.signal,
    state => states.push(state),
  )
  controller.abort()
  finish([9])
  await pending
  assert.equal(states.length, 3)
})

test('same-owner refresh retains rows and labels failed cached results; owner change clears', async () => {
  const { beginPanelRefresh, finishPanelRefresh } = await import('../src/data/panel-results.js')
  const previous: PanelResult<number> = { data: [42], status: 'ready' }
  const refreshing = beginPanelRefresh(previous, true)
  assert.deepEqual(refreshing.data, [42])
  assert.equal(refreshing.status, 'ready')
  assert.equal(refreshing.refreshing, true)
  const failed = finishPanelRefresh(refreshing, { data: [], status: 'error', error: 'offline' })
  assert.deepEqual(failed.data, [42])
  assert.equal(failed.stale, true)
  assert.equal(failed.status, 'error')
  assert.deepEqual(beginPanelRefresh(previous, false), { data: [], status: 'loading' })
  assert.deepEqual(finishPanelRefresh(failed, { data: [50], status: 'ready' }), { data: [50], status: 'ready' })
  assert.deepEqual(finishPanelRefresh(previous, { data: [2], status: 'error', error: 'partial' }).data, [2])
})
test('a canceled earlier generation cannot overwrite the newer successful refresh', async () => {
  const old = new AbortController()
  let finish!: (data: number[]) => void
  let current: PanelResult<number> = { data: [1], status: 'ready' }
  const pending = requestPanel(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
    old.signal,
    state => {
      current = state
    },
  )
  old.abort()
  await requestPanel(async () => [2], new AbortController().signal, state => {
    current = state
  })
  finish([99])
  await pending
  assert.deepEqual(current.data, [2])
})
