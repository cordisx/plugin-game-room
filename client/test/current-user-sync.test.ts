import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type CurrentUserSource,
  type CurrentUserState,
  safeCurrentUserAvatar,
  syncCurrentUser,
} from '../src/data/current-user-sync.js'
import { pageHeaderActions } from '../src/components/profile-menu.js'

type Result = Awaited<ReturnType<CurrentUserSource['read']>>
function deferred() {
  let resolve!: (result: Result) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Result>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function source() {
  const read = deferred()
  let listener!: (result: Result) => void
  let releases = 0
  const value: CurrentUserSource = {
    contract: 'cordisx.current-user/v1',
    read: () => read.promise,
    subscribe: next => {
      listener = next
      return () => {
        releases++
      }
    },
  }
  return { value, read, emit: (result: Result) => listener(result), releases: () => releases }
}
const available = (subject: string, displayName = subject): Result => ({
  status: 'available',
  profile: { subject, displayName },
})
const flush = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
}
function png(width = 96, height = 96) {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

test('subscription account switch supersedes a delayed initial profile read', async () => {
  const current = source()
  const states: CurrentUserState[] = []
  const dispose = syncCurrentUser(current.value, state => states.push(state))
  current.emit(available('user-b', 'B'))
  current.read.resolve(available('user-a', 'A'))
  await flush()
  assert.deepEqual(states, [{ status: 'available', subject: 'user-b', displayName: 'B' }])
  dispose()
})

test('synchronous initial subscription also supersedes an older read result', async () => {
  const read = deferred()
  const states: CurrentUserState[] = []
  const dispose = syncCurrentUser({
    contract: 'cordisx.current-user/v1',
    read: () => read.promise,
    subscribe: listener => {
      listener(available('new'))
      return () => {}
    },
  }, state => states.push(state))
  read.resolve(available('old'))
  await flush()
  assert.deepEqual(states, [{ status: 'available', subject: 'new', displayName: 'new' }])
  dispose()
})

test('signed-out and retired generation never retain prior profile fields', async () => {
  const current = source()
  const states: CurrentUserState[] = []
  const dispose = syncCurrentUser(current.value, state => states.push(state))
  current.emit({ status: 'available', profile: { subject: 'a', displayName: 'A', avatar: png() } })
  current.emit({ status: 'unavailable', reason: 'signed-out' })
  current.read.resolve(available('a'))
  await flush()
  assert.deepEqual(states.at(-1), { status: 'unavailable', reason: 'signed-out' })
  current.emit({ status: 'unavailable', reason: 'generation-retired' })
  assert.deepEqual(states.at(-1), { status: 'unavailable', reason: 'generation-retired' })
  dispose()
})

test('cleanup prevents old binding callbacks from overwriting a recovered binding', async () => {
  const old = source()
  const recovered = source()
  const states: CurrentUserState[] = []
  const changed = (state: CurrentUserState) => states.push(state)
  const disposeOld = syncCurrentUser(old.value, changed)
  disposeOld()
  disposeOld()
  const disposeNew = syncCurrentUser(recovered.value, changed)
  recovered.emit(available('new'))
  old.emit(available('old'))
  old.read.resolve(available('old'))
  await flush()
  assert.deepEqual(states, [{ status: 'available', subject: 'new', displayName: 'new' }])
  assert.equal(old.releases(), 1)
  disposeNew()
})

test('read rejection cannot clobber a newer subscribed account; absent capability falls back', async () => {
  const current = source()
  const states: CurrentUserState[] = []
  const dispose = syncCurrentUser(current.value, state => states.push(state))
  current.emit(available('new'))
  current.read.reject(new Error('retired read'))
  await flush()
  assert.equal(states.length, 1)
  dispose()
  syncCurrentUser(undefined, state => states.push(state))
  assert.deepEqual(states.at(-1), { status: 'unavailable', reason: 'host-unavailable' })
})

test('initial read updates profile and safe avatar while incomplete identity fails closed', async () => {
  const current = source()
  const states: CurrentUserState[] = []
  const dispose = syncCurrentUser(current.value, state => states.push(state))
  current.read.resolve({ status: 'available', profile: { subject: 'a', displayName: ' A ', avatar: png() } })
  await flush()
  assert.deepEqual(states.at(-1), { status: 'available', subject: 'a', displayName: 'A', avatar: png() })
  current.emit(available(''))
  assert.deepEqual(states.at(-1), { status: 'unavailable', reason: 'host-unavailable' })
  dispose()
})

test('avatar metadata rejects remote, SVG, malformed, oversized and wrong-size images', () => {
  assert.equal(safeCurrentUserAvatar(png()), png())
  for (
    const unsafe of [
      'https://example.test/avatar.png',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,!!!!',
      `data:image/png;base64,${'A'.repeat(65_536)}`,
      png(192),
      'data:image/png;base64,YWJjZA==',
    ]
  ) assert.equal(safeCurrentUserAvatar(unsafe), undefined)
})

test('profile header retains actions and avatar fallback without exposing subject in metadata', () => {
  const guest = pageHeaderActions('prepare')
  const user = pageHeaderActions('prepare', { status: 'available', subject: 'opaque', displayName: 'A', avatar: png() })
  assert.deepEqual(user.slice(0, -1), guest.slice(0, -1))
  assert.deepEqual(user.at(-1)?.visual, { kind: 'avatar', src: png() })
  assert.deepEqual(user.at(-1)?.label, { key: 'header.current-user-account', fallback: 'A · 个人菜单' })
  assert.equal(JSON.stringify(user).includes('opaque'), false)
  assert.deepEqual(pageHeaderActions('lobby', { status: 'unavailable', reason: 'signed-out' }).at(-1)?.visual, {
    kind: 'avatar',
  })
  assert.deepEqual(
    pageHeaderActions('lobby', { status: 'available', subject: 'a', avatar: 'https://bad' }).at(-1)?.visual,
    {
      kind: 'avatar',
    },
  )
})
