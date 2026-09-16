import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'cordisx/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GlobalProfileIdentity } from '../src/components/global-profile-identity.js'
import { pageHeaderActions } from '../src/components/profile-menu.js'
import { LivePort } from '../src/data/live-restored.js'
test('changing source account metadata never replaces the public global identity or menu label', async () => {
  const native = Object.freeze({ status: 'available' as const, subject: 'public-display-user', displayName: 'GH L' })
  const source = {
    id: 'local',
    name: 'Game',
    url: 'http://127.0.0.1:18973',
    enabled: true,
    accountDisplayName: '本地棋友',
  }
  let localName = ''
  const account = { id: 'source-owned-account', guest: false }
  const port = new LivePort(
    [source],
    {
      dispose() {},
      connectAccount: async () => ({ instanceId: source.id, account }),
      request: async request => {
        if (request.path === '/v1/handshake') {
          return {
            serverId: source.id,
            protocol: 'game-room/1',
            gamePackageVersion: 1,
            uiFormats: ['scene-v1'],
            displayProfiles: ['self-display-profile-v1'],
            access: { guests: false },
            managedAccount: {
              contract: 'cordisx.managed-source/v1',
              binding: {
                origin: source.url,
                sourceId: source.id,
                instanceId: source.id,
                audience: 'source-account',
              },
            },
          }
        }
        if (request.path === '/v1/me/profile') {
          localName = (request.body as { displayName: string }).displayName
          return {}
        }
        if (request.path === '/v1/me') return { account: { ...account, displayName: localName } }
        if (request.path === '/v1/packages') return { packages: [] }
        return { rooms: [] }
      },
    },
    [],
    undefined,
    true,
  )
  try {
    port.setCurrentUser(native)
    for (const alias of ['本地棋友', '第二个来源昵称']) {
      source.accountDisplayName = alias
      await port.list(source, new AbortController().signal)
      assert.equal((await port.personalProfiles(new AbortController().signal))[0]?.displayName, alias)
      const html = renderToStaticMarkup(createElement(GlobalProfileIdentity, { currentUser: native }))
      assert(html.includes('<h1>GH L</h1>'))
      assert(!html.includes(alias))
      assert.equal(
        pageHeaderActions('personal', native).find(action => action.id === 'account')?.label?.fallback,
        'GH L · 个人菜单',
      )
    }
    assert.equal(native.displayName, 'GH L')
    const unknown = renderToStaticMarkup(
      createElement(GlobalProfileIdentity, { currentUser: { status: 'unavailable', reason: 'host-unavailable' } }),
    )
    assert(unknown.includes('<h1>个人中心</h1>'))
    assert(!unknown.includes(localName))
  } finally {
    port.dispose()
  }
})
