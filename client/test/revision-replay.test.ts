import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Revision } from '../src/data/revision.js'
import { readOnly, replayIndex } from '../src/data/replay-view.js'
test('editing/source change/disposal invalidates a delayed inspection or file read', async () => {
  const revision = new Revision()
  const old = revision.next()
  let finish!: (value: string) => void
  let result = ''
  const pending = new Promise<string>(resolve => {
    finish = resolve
  }).then(value => {
    if (revision.current(old)) result = value
  })
  const latest = revision.next()
  finish('stale')
  await pending
  assert.equal(result, '')
  assert.equal(revision.current(latest), true)
  revision.next()
  assert.equal(revision.current(latest), false)
})
test('replay projection disables author actions without changing private projection contents', () => {
  const scene = {
    root: {
      type: 'column',
      children: [{ type: 'button', label: 'Act', action: { type: 'call' } }, {
        type: 'number-action',
        label: 'Amount',
        value: 30,
      }, { type: 'text', text: 'owned seat only' }],
    },
  }
  const readonly = readOnly(scene) as typeof scene
  assert.equal((readonly.root.children[0] as { disabled?: boolean }).disabled, true)
  assert.deepEqual(readonly.root.children[1], { type: 'text', text: 'Amount: 30' })
  assert.deepEqual(readonly.root.children[2], scene.root.children[2])
  assert.equal((scene.root.children[0] as { disabled?: boolean }).disabled, undefined)
  assert.equal(replayIndex(5, 0), 0)
  assert.equal(replayIndex(5, 2), 1)
  assert.equal(replayIndex(-1, 2), 0)
})
