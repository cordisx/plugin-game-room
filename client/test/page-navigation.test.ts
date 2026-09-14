import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../src/client.js'
import { pageNavigation, pages, updatePageHeader } from '../src/data/page-navigation.js'

test('every game child mounts a lobby-rooted header with a semantic Back destination', () => {
  const parents: Record<string, string> = {
    agents: 'lobby',
    dispatch: 'lobby',
    create: 'lobby',
    invite: 'lobby',
    prepare: 'lobby',
    agent: 'agents',
    personal: 'lobby',
    ledger: 'personal',
    replay: 'personal',
    settings: 'lobby',
    publish: 'create',
    funding: 'prepare',
  }
  for (const page of Object.keys(pages)) {
    const calls: unknown[] = []
    const controls = {
      setHeaderBreadcrumbs: (items: unknown, back: unknown) => {
        calls.push({ items, back })
        return true
      },
    }
    const updated = updatePageHeader(page, controls)
    if (page === 'lobby' || page === 'configuration') {
      assert.equal(updated, false)
      assert.deepEqual(calls, [])
      continue
    }
    assert.equal(updated, true)
    const navigation = pageNavigation(page)!
    assert.equal(navigation.breadcrumbs[0]?.fallback, '游戏大厅')
    assert.deepEqual(calls, [{ items: navigation.breadcrumbs, back: { id: parents[page] } }])
    assert.equal(navigation.breadcrumbs.length, parents[page] === 'lobby' ? 2 : 3)
  }
})

test('funding retains the actual room ancestor while returning to prepare, then lobby', () => {
  const calls: { labels: string[]; route: unknown }[] = []
  const controls = {
    setHeaderBreadcrumbs: (items: readonly { fallback: string }[], back: unknown) => {
      calls.push({ labels: items.map(item => item.fallback), route: back })
      return true
    },
  }
  updatePageHeader('funding', controls, '朋友来一局')
  updatePageHeader('prepare', controls, '朋友来一局')
  updatePageHeader('prepare', controls, '新房间')
  assert.deepEqual(calls, [
    { labels: ['游戏大厅', '朋友来一局', '费用确认'], route: { id: 'prepare' } },
    { labels: ['游戏大厅', '朋友来一局'], route: { id: 'lobby' } },
    { labels: ['游戏大厅', '新房间'], route: { id: 'lobby' } },
  ])
})

test('direct-link or missing session uses a stable room parent without reading history', () => {
  assert.deepEqual(pageNavigation('funding')?.breadcrumbs.map(item => item.fallback), [
    '游戏大厅',
    '对局房间',
    '费用确认',
  ])
  assert.deepEqual(pageNavigation('ledger')?.back, { id: 'personal' })
  assert.deepEqual(pageNavigation('replay')?.back, { id: 'personal' })
  assert.deepEqual(pageNavigation('personal')?.back, { id: 'lobby' })
})

test('unknown routes and missing or rejecting controls do not invent a header fallback', () => {
  assert.equal(pageNavigation('not-registered'), undefined)
  assert.equal(updatePageHeader('ledger'), false)
  assert.equal(updatePageHeader('ledger', { setHeaderBreadcrumbs: () => false }), false)
})

test('registered page mounts install semantic Back before the renderer body starts', () => {
  const mounts = new Map<string, (mount: unknown) => unknown>()
  const declarations = new Map<string, { breadcrumbs?: unknown }>()
  const release = () => {}
  const ctx = {
    inject: release,
    effect: release,
    i18n: { define: release },
    pages: {
      register: (declaration: { id: string }, mount: (mount: unknown) => unknown) => {
        declarations.set(declaration.id, declaration)
        mounts.set(declaration.id, mount)
        return release
      },
    },
    routes: { register: () => release },
    commands: { register: () => release },
    slots: { register: () => release },
    managerContent: { register: () => release },
  }
  apply(ctx as unknown as Parameters<typeof apply>[0], { sample: true })
  for (const page of ['ledger', 'replay', 'funding', 'publish', 'prepare', 'create', 'personal']) {
    const calls: unknown[] = []
    const abort = new AbortController()
    // The public Node React entry intentionally stops at the renderer boundary.
    // Header registration must already be complete before handing the body to Host.
    assert.throws(() =>
      mounts.get(page)!({
        signal: abort.signal,
        controls: {
          setHeaderBreadcrumbs: (items: unknown, back: unknown) => {
            calls.push({ items, back })
            return true
          },
        },
      }), /defineReactPage is available only inside the CordisX renderer Host/)
    abort.abort()
    const navigation = pageNavigation(page)!
    assert.equal(declarations.get(page)?.breadcrumbs, undefined) // Native header uses the dynamic room-aware public setter.
    assert.deepEqual(calls, [{ items: navigation.breadcrumbs, back: navigation.back }])
  }
  assert.deepEqual(declarations.get('lobby')?.breadcrumbs, [])
  assert.equal(declarations.get('configuration')?.breadcrumbs, undefined)
})
