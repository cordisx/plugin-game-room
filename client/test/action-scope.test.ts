import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ActionScope, runPageAction } from '../src/data/action-scope.js'
test('Fast Refresh cleanup/setup produces usable signal while retained scope rejects stale completion', async () => {
  const scope = new ActionScope()
  const cleanup = scope.activate()
  const old = scope.begin()!
  assert.equal(scope.begin(), undefined)
  let release!: () => void
  const pending = new Promise<void>(resolve => {
    release = resolve
  }).then(() => scope.finish(old))
  cleanup()
  const cleanupNew = scope.activate()
  const current = scope.begin()!
  assert.equal(old.signal.aborted, true)
  assert.equal(current.signal.aborted, false)
  assert.equal(scope.owns(old), false)
  release()
  assert.equal(await pending, false)
  assert.equal(scope.begin(), undefined, 'old finally must not release the new submission lock')
  cleanup()
  assert.equal(scope.owns(current), true, 'late old cleanup must not abort current generation')
  assert.equal(scope.finish(current), true)
  assert.ok(scope.begin(), 'a settled action must allow retry')
  cleanupNew()
  assert.equal(scope.begin(), undefined)
})
test('activation aborts a prior generation even when cleanup has not arrived', () => {
  const scope = new ActionScope()
  scope.activate()
  const first = scope.begin()!
  scope.activate()
  assert.equal(first.signal.aborted, true)
  assert.equal(scope.finish(first), false)
  assert.equal(scope.begin()!.signal.aborted, false)
})

test('the page runner shows failures, unlocks retry, and ignores old-generation completion', async () => {
  const scope = new ActionScope()
  const cleanup = scope.activate()
  let busy = false
  let error = ''
  let completed = 0
  const effects = {
    busy: (value: boolean) => {
      busy = value
    },
    error: (value: string) => {
      error = value
    },
    complete: () => {
      completed++
    },
  }
  let releaseOld!: () => void
  const old = runPageAction(scope, () =>
    new Promise<void>(resolve => {
      releaseOld = resolve
    }), effects)
  await Promise.resolve()
  cleanup()
  scope.activate()
  let failNew!: (error: Error) => void
  const current = runPageAction(scope, signal => {
    assert.equal(signal.aborted, false)
    return new Promise<void>((_resolve, reject) => {
      failNew = reject
    })
  }, effects)
  await Promise.resolve()
  releaseOld()
  await old
  assert.equal(busy, true)
  assert.equal(completed, 0)
  failNew(new Error('连接失败，可重试'))
  await current
  assert.equal(error, '连接失败，可重试')
  assert.equal(busy, false)
  await runPageAction(scope, async () => {}, effects)
  assert.equal(error, '')
  assert.equal(busy, false)
  assert.equal(completed, 1)
  await runPageAction(scope, () => {
    throw new Error('同步失败')
  }, effects)
  assert.equal(error, '同步失败')
  assert.equal(busy, false)
})
