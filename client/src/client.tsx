import { RoomRecovery } from './data/room-recovery.js'
import { DEFAULT_OFFICIAL_SOURCE_ORIGINS } from './data/create-source-selection.js'
import { CreatePreferences } from './data/create-preferences.js'
import type { WalletSpendV1 } from '@cordisx/protocol/wallet-spend/v1'
import { pages, updatePageHeader } from './data/page-navigation.js'
import { CanonicalGameWallet } from './data/canonical-wallet.js'
import { startWalletRefresh } from './data/wallet-refresh.js'
import { LOCAL_WALLET_SERVICE, type LocalWalletReadService } from '@cordisx/economy/local'
import { openLedgerPage } from './data/ledger-navigation.js'
import { openLobbyCreate } from './data/lobby-context.js'
import { type CurrentUserSource, type CurrentUserState, syncCurrentUser } from './data/current-user-sync.js'
import { accountHeaderLabel, headerDestinations, pageHeaderActions } from './components/profile-menu.js'
import type { IsolatedGameUiV1 } from '@cordisx/protocol/isolated-game-ui/v1'
import { agentPageBlocked } from './data/features.js'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineReactPage, lazy, Suspense } from 'cordisx/react'
import {
  CORDISX_MANAGER_CONTENT_NAVIGATION_SCHEMA_V5,
  CORDISX_PAGE_SCHEMA_V4,
  CORDISX_PLUGIN_MANIFEST_SCHEMA_V11,
  CORDISX_ROUTE_SCHEMA_V2,
  type CordisXPluginManifestV11,
} from 'cordisx/contracts'
import { LivePort } from './data/live-restored.js'
import { HostHttpTransport } from './data/host-http.js'
import type { AgentLoopProviderOptions, AgentProfile } from '@cordisx/game-room-agents'
import type { AgentLoopControlV1 } from '@cordisx/protocol/agent-loop-control/v1'
import type { BoundAgentLoopClient } from '@cordisx/protocol/agent-loop/v4'
import type { HttpClientV1 } from '@cordisx/protocol/plugin-http/v1'
import type { HttpClientV2 } from '@cordisx/protocol/plugin-http/v2'
import type { HttpClientV3 } from '@cordisx/protocol/plugin-http/v3'
import type { HttpClientV4 } from '@cordisx/protocol/plugin-http/v4'
import type { RestrictedContentV1 } from '@cordisx/protocol/restricted-content/v1'
import { PublicDiscoveryTransport } from './data/http.js'
import type { Source } from './data/model.js'
import { SamplePort } from './data/sample.js'
import type { ClientRuntime } from './app.js'
export const name = 'game-room'
export const manifest = {
  $schema: CORDISX_PLUGIN_MANIFEST_SCHEMA_V11,
  schemaVersion: 11,
  id: name,
  name: 'Game Room',
  services: [],
  capabilities: [
    {
      name: 'ui.extension-points.render',
      required: true,
      scope: {
        extensionPoints: [
          'sidebar.navigation.items',
          'main',
          'manager.settings.navigation-items',
          'manager.content',
        ],
      },
    },
  ],
} as const satisfies CordisXPluginManifestV11
export const inject = ['i18n', 'pages', 'routes', 'slots', 'managerContent', 'commands']
export const Config = Schema.object({
  sample: Schema.boolean().default(false).description('样例数据预览；不运行真实游戏或改变余额。'),
  providerId: Schema.string().default('').description('Agent 提供方 ID'),
  agentProfiles: Schema.array(
    Schema.object({
      id: Schema.string().required(),
      name: Schema.string().required(),
      gameIds: Schema.array(Schema.string()).default([]),
      personality: Schema.string().default(''),
      model: Schema.string().required(),
    }),
  ).default([]).description('我的 Agent'),
  officialSourceOrigins: Schema.array(Schema.string()).default(DEFAULT_OFFICIAL_SOURCE_ORIGINS).description(
    '创建房间默认优先的官方服务器 HTTP(S) origin。',
  ),
  sources: Schema.array(Schema.object({
    id: Schema.string().required().description('服务器 ID（握手返回）'),
    name: Schema.string().required().description('来源名称'),
    url: Schema.string().required().description('来源 HTTP(S) origin'),
    accountId: Schema.string().default('').description('此来源的账户 ID'),
    accountDisplayName: Schema.string().default('').description(
      '此来源的账号显示名；留空使用当前 Codex 名称，不改变登录身份。',
    ),
    enabled: Schema.boolean().default(true),
  })).default([]).description('并行数据来源'),
})
const Page = lazy(async () => ({ default: (await import('./app.js')).GameRoomPage }))

export function apply(
  ctx: Context,
  config: {
    sample?: boolean
    sources?: Source[]
    officialSourceOrigins?: string[]
    agentProfiles?: AgentProfile[]
    providerId?: string
  } = {},
): void {
  let walletProvider: LocalWalletReadService | undefined
  const walletListeners = new Set<() => void>()
  const port = config.sample
    ? new SamplePort()
    : new LivePort(
      config.sources ?? [],
      new PublicDiscoveryTransport(),
      config.agentProfiles ?? [],
      transport => new CanonicalGameWallet(transport, () => walletProvider),
      true,
    )
  const preferences = new CreatePreferences()
  ctx.effect(() => () => preferences.dispose())
  const runtime: ClientRuntime = {
    createPreferences: preferences,
    port,
    officialSourceOrigins: config.officialSourceOrigins ?? DEFAULT_OFFICIAL_SOURCE_ORIGINS,
    subscribeWallet: changed => {
      walletListeners.add(changed)
      return () => {
        walletListeners.delete(changed)
      }
    },
    navigate: page => {
      if (agentPageBlocked(page)) page = 'lobby'
      void ctx.routes.navigate({ id: page })
    },
  }
  ctx.inject(['documents'], child => {
    const documents = child.documents
    preferences.attach(documents)
    child.effect(() => () => preferences.detach(documents))
  })
  if (!config.sample && port instanceof LivePort) {
    // A new plugin activation resumes retained source and wallet sessions through the public Host client.
    ctx.inject(['http'], child => {
      const transport = new HostHttpTransport(
        (child as Context & { http: HttpClientV1 | HttpClientV2 | HttpClientV3 | HttpClientV4 }).http,
      )
      port.setHttp(transport)
      child.effect(() => () => {
        transport.dispose()
        port.setHttp(new PublicDiscoveryTransport(), transport)
      })
    })
  }
  if (port instanceof LivePort) {
    ctx.inject(['walletSpend'], child => {
      const capability = child.get('walletSpend') as WalletSpendV1
      port.setWalletSpend(capability)
      child.effect(() => () => port.setWalletSpend(undefined, capability))
    })
    ctx.inject([LOCAL_WALLET_SERVICE], child => {
      const provider = child.get(LOCAL_WALLET_SERVICE) as LocalWalletReadService
      walletProvider = provider
      const notify = () => {
        for (const changed of walletListeners) changed()
      }
      const stop = startWalletRefresh(
        async signal => {
          const balances = await port.refreshWallet(signal)
          return { status: port.walletStatus(), balances }
        },
        notify,
        2000,
        () => walletProvider === provider,
      )
      child.effect(() => () => {
        stop()
        if (walletProvider !== provider) return
        walletProvider = undefined
        port.invalidateWallet()
        runtime.balanceLabel = '—'
        runtime.balanceAriaLabel = 'Token 本地钱包不可用'
        runtime.updateBalanceLabel?.('—', runtime.balanceAriaLabel)
        notify()
      })
    })
  }
  if (port instanceof LivePort) {
    ctx.inject(['agentLoop', 'agentLoopControl'], child => {
      const capabilities = child as Context & { agentLoop: BoundAgentLoopClient; agentLoopControl: AgentLoopControlV1 }
      port.configureAgents({
        agentLoop: capabilities.agentLoop,
        agentLoopControl: capabilities.agentLoopControl,
        providerId: config.providerId ?? '',
        executionMode: 'ordinary',
      })
    })
  }
  ctx.inject(['isolatedGameUi'], child => {
    runtime.isolatedGameUi = (child as Context & { isolatedGameUi: IsolatedGameUiV1 }).isolatedGameUi
    child.effect(() => () => {
      runtime.isolatedGameUi = undefined
    })
  })
  ctx.inject(['restrictedContent'], child => {
    runtime.restrictedContent = (child as Context & { restrictedContent: RestrictedContentV1 }).restrictedContent
    child.effect(() => () => {
      runtime.restrictedContent = undefined
    })
  })
  let currentUser: CurrentUserState = { status: 'unavailable', reason: 'host-unavailable' }
  const profileListeners = new Set<(state: CurrentUserState) => void>()
  const currentUserListeners = new Set<() => void>()
  runtime.subscribeCurrentUser = changed => {
    currentUserListeners.add(changed)
    return () => {
      currentUserListeners.delete(changed)
    }
  }
  const roomRecovery = new RoomRecovery()
  let recoveryEpoch = 0
  const publishCurrentUser = (state: CurrentUserState) => {
    if (JSON.stringify(currentUser) === JSON.stringify(state)) return
    const recoverySeat = roomRecovery.update(currentUser, state, runtime.seat)
    const epoch = ++recoveryEpoch
    runtime.recoveringRoom = state.status === 'unavailable' && state.reason !== 'signed-out' && roomRecovery.pending

    if (
      currentUser.status === 'available'
      && (state.status !== 'available' || currentUser.subject !== state.subject)
    ) {
      delete runtime.seat
      delete runtime.agent
      delete runtime.replay
      delete runtime.quote
      delete runtime.lobbyTarget
    }
    currentUser = state
    runtime.currentUser = state
    if (port instanceof LivePort) port.setCurrentUser(state)
    if (recoverySeat && state.status === 'available' && port instanceof LivePort) {
      runtime.recoveringRoom = true
      const signal = AbortSignal.timeout(20000)
      void (async () => {
        if (!port.isConnected?.(recoverySeat.room.sourceId)) await port.connect?.(recoverySeat.room.sourceId)
        signal.throwIfAborted()
        const seat = await port.refreshSeat!(recoverySeat, signal)
        if (epoch !== recoveryEpoch || runtime.seat) return
        runtime.seat = seat
        roomRecovery.clear()
      })().catch(() => {}).finally(() => {
        if (epoch !== recoveryEpoch) return
        runtime.recoveringRoom = false
        for (const listener of currentUserListeners) listener()
      })
    }

    for (const listener of profileListeners) listener(state)
    for (const listener of currentUserListeners) listener()
  }
  ctx.inject(['currentUser'], child => {
    const unsubscribe = syncCurrentUser(
      (child as Context & { currentUser: CurrentUserSource }).currentUser,
      publishCurrentUser,
    )
    child.effect(() => () => {
      unsubscribe()
      publishCurrentUser({ status: 'unavailable', reason: 'generation-retired' })
    })
  })
  const dispose: (() => void)[] = []
  ctx.effect(() => async () => {
    await port.dispose()
    for (const release of dispose.reverse()) release()
  })
  ctx.i18n.define({
    namespace: name,
    locale: 'zh-CN',
    default: true,
    messages: {
      ...Object.fromEntries(Object.entries(pages).map(([id, title]) => [id, title])),
      sidebar: '游戏大厅',
      'header.invite': '邀请加入',
      'header.create': '开一局',
      'header.account': '个人菜单',
      'header.personal': '个人中心',
      'header.settings': '服务器来源',
      'header.configuration': '配置',
      'header.room-details': '房间详情',
      'header.room-sync': '同步局面',
      'header.room-leave': '离开房间',
    },
  })
  ctx.i18n.define({
    namespace: name,
    locale: 'en',
    messages: {
      sidebar: 'Game lobby',
      'header.invite': 'Join invitation',
      'header.create': 'New game',
      'header.account': 'Personal menu',
      'header.personal': 'Personal',
      'header.settings': 'Servers',
      'header.configuration': 'Configuration',
      'header.room-details': 'Room details',
      'header.room-sync': 'Sync game',
      'header.room-leave': 'Leave room',
      lobby: 'Lobby',
      agents: 'Agents',
      dispatch: 'Tasks',
      create: 'Create room',
      invite: 'Join invitation',
      prepare: 'Ready room',
      agent: 'Agent details',
      personal: 'Personal',
      ledger: 'Account ledger',
      replay: 'Replay',
      settings: 'Data sources',
    },
  })
  dispose.push(ctx.commands.register(
    { id: 'open-ledger', title: { key: 'header.ledger', fallback: '收支明细' } },
    () => {
      return openLedgerPage(id => ctx.routes.navigate({ id }))
    },
  ))
  for (const id of headerDestinations) {
    dispose.push(
      ctx.commands.register(
        { id: `open-${id}`, title: { key: id, fallback: pages[id] } },
        () => {
          return id === 'create' ? openLobbyCreate(runtime) : ctx.routes.navigate({ id })
        },
      ),
    )
  }
  for (
    const [id, action] of [
      ['room-details', 'details'],
      ['room-sync', 'sync'],
      ['room-leave', 'leave'],
    ] as const
  ) {
    dispose.push(
      ctx.commands.register(
        { id, title: { key: `header.${id}`, fallback: id } },
        ({ signal }) => {
          if (!runtime.roomHeaderAction) throw new Error('room header action is unavailable')
          return runtime.roomHeaderAction(action, signal)
        },
      ),
    )
  }
  for (const [id, title] of Object.entries(pages)) {
    dispose.push(
      ctx.pages.register(
        {
          $schema: CORDISX_PAGE_SCHEMA_V4,
          schemaVersion: 4,
          id,
          title: { key: id, fallback: title },
          description: { key: 'description', fallback: '多人游戏与 Agent 对局' },
          icon: 'host:dice',
          chrome: 'standard',
          ...(['prepare', 'lobby'].includes(id) ? { contentInset: 'none' as const } : {}),
          headerActions: pageHeaderActions(id, currentUser),
          ...(id === 'lobby' ? { breadcrumbs: [] } : {}),
        },
        mount => {
          const updateBalanceLabel = (label: string, ariaLabel?: string) =>
            mount.controls?.setHeaderActionLabel?.(
              'balance',
              { key: 'header.balance-current', fallback: label },
              ariaLabel ? { key: 'header.balance-accessible', fallback: ariaLabel } : undefined,
            )
          runtime.updateBalanceLabel = updateBalanceLabel
          updateBalanceLabel(runtime.balanceLabel ?? '…', runtime.balanceAriaLabel ?? 'Token 余额正在加载')
          const updateAvatar = (state: CurrentUserState) => {
            const visual = {
              kind: 'avatar' as const,
              ...(state.status === 'available' && state.avatar ? { src: state.avatar } : {}),
            }
            mount.controls?.setHeaderActionVisual?.('account', visual)
            mount.controls?.setHeaderActionLabel?.('account', accountHeaderLabel(state))
          }
          const updateRoomHeader = (name: string) => updatePageHeader(id, mount.controls, name)
          updatePageHeader(id, mount.controls, runtime.seat?.room.name)
          if (['prepare', 'funding'].includes(id)) runtime.updateRoomHeader = updateRoomHeader
          profileListeners.add(updateAvatar)
          updateAvatar(currentUser)
          const unsubscribe = () => profileListeners.delete(updateAvatar)
          mount.signal.addEventListener('abort', unsubscribe, { once: true })
          const release = defineReactPage(() => (
            <Suspense fallback={null}>
              <Page page={id} runtime={runtime} />
            </Suspense>
          ))(mount)
          return async () => {
            unsubscribe()
            if (runtime.updateBalanceLabel === updateBalanceLabel) runtime.updateBalanceLabel = undefined
            if (runtime.updateRoomHeader === updateRoomHeader) runtime.updateRoomHeader = undefined
            mount.signal.removeEventListener('abort', unsubscribe)
            await release?.()
          }
        },
      ),
    )
    dispose.push(
      ctx.routes.register({
        $schema: CORDISX_ROUTE_SCHEMA_V2,
        schemaVersion: 2,
        id,
        path: id === 'configuration' ? '/manager/extensions/game-room/configuration' : `/main/game-room/${id}`,
        outlet: id === 'configuration' ? 'manager.content' : 'main',
        page: id,
        title: id === 'lobby'
          ? { key: 'sidebar', fallback: '游戏大厅' }
          : { key: id, fallback: title },
        description: { key: 'description', fallback: '多人游戏与 Agent 对局' },
      }),
    )
    if (id === 'configuration') {
      dispose.push(ctx.managerContent.register({
        $schema: CORDISX_MANAGER_CONTENT_NAVIGATION_SCHEMA_V5,
        schemaVersion: 5,
        id,
        route: { id },
        header: { title: { kind: 'route' } },
        body: { kind: 'plugin-config-form', namespace: name },
      }))
    }
  }
  dispose.push(
    ctx.slots.register({
      name: 'manager.settings.navigation-items',
      id: 'game-room',
      group: 'after-settings',
      order: 160,
    }, { route: { id: 'configuration' } }),
  )
  dispose.push(
    ctx.slots.register({ name: 'sidebar.navigation.items', id: 'open', group: 'utility', order: 95 }, {
      label: { key: 'sidebar', fallback: '游戏大厅' },
      icon: 'host:dice',
      route: { id: 'lobby' },
    }),
  )
}
