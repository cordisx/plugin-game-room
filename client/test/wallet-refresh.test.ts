import assert from 'node:assert/strict'
import test from 'node:test'
import { startWalletRefresh } from '../src/data/wallet-refresh.js'
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const balance = {
  economyId: 'test',
  accountId: 'test',
  origin: 'http://127.0.0.1:1',
  label: 'test',
  available: 0,
  reserved: 0,
}
test('wallet polling is sequential, suppresses equal reads and publishes changed amounts or availability', async () => {
  let calls = 0, active = 0, peak = 0, publications = 0, amount = 0, unavailable = false
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const stop = startWalletRefresh(async () => {
    calls++
    active++
    peak = Math.max(peak, active)
    if (calls === 1) await held
    active--
    if (unavailable) throw Error('test unavailable')
    return { status: 'ready', balances: [{ ...balance, available: amount }] }
  }, () => {
    publications++
  }, 5)
  try {
    await wait(20)
    assert.equal(calls, 1)
    release()
    await wait(20)
    assert.ok(calls >= 3)
    assert.equal(peak, 1)
    assert.equal(publications, 1)
    amount = 1
    await wait(15)
    assert.equal(publications, 2)
    unavailable = true
    await wait(15)
    assert.equal(publications, 3)
    await wait(15)
    assert.equal(publications, 3)
  } finally {
    stop()
  }
})
test('closing a held wallet read prevents late notifications and queued polls', async () => {
  let release!: () => void, calls = 0, publications = 0
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const stop = startWalletRefresh(async () => {
    calls++
    await held
    return { status: 'ready', balances: [balance] }
  }, () => {
    publications++
  }, 5)
  stop()
  release()
  await wait(20)
  assert.equal(calls, 1)
  assert.equal(publications, 0)
})

test('a replacement owner before old cleanup fences its held read and prevents duplicate polling', async () => {
  let owner = 'A', release!: () => void, oldReads = 0, oldPublications = 0, newReads = 0
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const stopOld = startWalletRefresh(
    async () => {
      oldReads++
      await held
      return { status: 'ready', balances: [balance] }
    },
    () => {
      oldPublications++
    },
    5,
    () => owner === 'A',
  )
  owner = 'B'
  const stopNew = startWalletRefresh(
    async () => {
      newReads++
      return { status: 'ready', balances: [balance] }
    },
    () => {},
    5,
    () => owner === 'B',
  )
  try {
    release()
    await wait(25)
    assert.equal(oldReads, 1)
    assert.equal(oldPublications, 0)
    assert.ok(newReads >= 2)
  } finally {
    stopOld()
    stopNew()
  }
})
