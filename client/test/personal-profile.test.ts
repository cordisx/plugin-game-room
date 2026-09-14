import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LivePort } from '../src/data/live-restored.js'
import { PartialPanelError } from '../src/data/panel-results.js'
import { ledgerMovement } from '../src/data/ledger-presentation.js'
const sources = ['one', 'two'].map(id => ({ id, name: id, url: `https://${id}.example`, enabled: true, accountId: '' }))
test('personal profiles read the restored game account independently of wallets without creating identities or writes', async () => {
  const calls: string[] = []
  const port = new LivePort(sources, {
    dispose() {},
    restoreSession: async source => source.id === 'one' ? { account: { id: 'guest-one', guest: true } } : undefined,
    connect: async () => {
      throw new Error('must not authorize')
    },
    connectGuest: async () => {
      throw new Error('must not create guest')
    },
    request: async request => {
      calls.push(`${request.method ?? 'GET'} ${request.source.id} ${request.path}`)
      assert.equal(request.authenticated, true)
      return {
        account: { id: 'guest-one', guest: true, displayName: 'Actual player', avatar: 'https://bad.example/avatar' },
      }
    },
  })
  const rows = await port.personalProfiles(new AbortController().signal)
  assert.equal(rows[0].displayName, 'Actual player')
  assert.equal(rows[0].guest, true)
  assert.equal(rows[0].avatar, undefined)
  assert.equal(rows[1].state, 'disconnected')
  assert.deepEqual(calls, ['GET one /v1/me'])
  await assert.rejects(port.balances(new AbortController().signal), /本地钱包暂时不可用/)
})
test('profile failures retain other sources and never adopt a changed account', async () => {
  const port = new LivePort(sources, {
    dispose() {},
    restoreSession: async source => ({ account: { id: source.id, guest: true } }),
    request: async ({ source }) => ({
      account: { id: source.id === 'one' ? 'wrong-account' : source.id, displayName: 'Two' },
    }),
  })
  await assert.rejects(
    port.personalProfiles(new AbortController().signal),
    error => error instanceof PartialPanelError && error.data.length === 1 && error.data[0].sourceId === 'two',
  )
})
test('ledger separates spending and income from freeze and release', () => {
  assert.deepEqual(ledgerMovement({ availableDelta: -10, reservedDelta: 10 }), { label: '冻结', amount: 10 })
  assert.deepEqual(ledgerMovement({ availableDelta: 10, reservedDelta: -10 }), { label: '释放冻结', amount: 10 })
  assert.deepEqual(ledgerMovement({ availableDelta: 0, reservedDelta: -10 }), { label: '支出', amount: -10 })
  assert.deepEqual(ledgerMovement({ availableDelta: 25, reservedDelta: 0 }), { label: '收入', amount: 25 })
})
test('header balance never invents zero or aggregates independent wallets', async () => {
  const { headerBalanceLabel, headerBalanceAccessibleLabel } = await import('../src/data/header-balance.js')
  const wallet = { economyId: 'one', label: 'One', available: 42, reserved: 8 }
  assert.equal(headerBalanceLabel({ data: [], status: 'loading' }), '…')
  assert.equal(headerBalanceLabel({ data: [], status: 'error' }), '—')
  assert.equal(headerBalanceLabel({ data: [], status: 'ready' }), '—')
  assert.equal(headerBalanceLabel({ data: [wallet], status: 'ready' }), '42')
  assert.equal(headerBalanceAccessibleLabel({ data: [wallet], status: 'ready' }), '42 Token')
  assert.equal(headerBalanceLabel({ data: [wallet, { ...wallet, economyId: 'two' }], status: 'ready' }), '我的资产')
})
test('balance is a public text action between create and avatar and opens the ledger', async () => {
  const { pageHeaderActions } = await import('../src/components/profile-menu.js')
  const actions = pageHeaderActions('lobby')
  assert.deepEqual(actions.map(action => action.id), ['invite', 'create', 'balance', 'account'])
  assert.equal(actions.filter(action => action.presentation === 'primary').length, 1)
  assert.equal(actions[2].presentation, 'text')
  assert.equal(actions[2].command?.id, 'open-ledger')
})

test('personal and header ledger navigation delegates once to the independent Host route', async () => {
  const { openLedgerPage } = await import('../src/data/ledger-navigation.js')
  const destinations: string[] = []
  const result = { status: 'accepted' }
  assert.equal(
    await openLedgerPage(async page => {
      destinations.push(page)
      return result
    }),
    result,
  )
  assert.deepEqual(destinations, ['ledger'])
  const { pageHeaderActions } = await import('../src/components/profile-menu.js')
  for (const page of ['lobby', 'personal', 'settings', 'ledger']) {
    assert.equal(pageHeaderActions(page).find(action => action.id === 'balance')?.command?.id, 'open-ledger')
  }
})
