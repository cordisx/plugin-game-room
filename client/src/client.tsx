import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineReactPage, lazy, Suspense } from 'cordisx/react'
import {
  CORDISX_MANAGER_CONTENT_NAVIGATION_SCHEMA_V5,
  CORDISX_PAGE_SCHEMA_V3,
  CORDISX_PLUGIN_MANIFEST_SCHEMA_V11,
  CORDISX_ROUTE_SCHEMA_V2,
  type CordisXPluginManifestV11,
} from 'cordisx/contracts'
import { LivePort } from './data/live.js'
import { HostHttpTransport } from './data/host-http.js'
import type { AgentLoopProviderOptions, AgentProfile } from '@cordisx/game-room-agents'
import type { AgentLoopControlV1 } from '@cordisx/protocol/agent-loop-control/v1'
import type { BoundAgentLoopClient } from '@cordisx/protocol/agent-loop/v4'
import type { HttpClientV1 } from '@cordisx/protocol/plugin-http/v1'
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
  capabilities: [{
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
  }],
} as const satisfies CordisXPluginManifestV11
export const inject = ['i18n', 'pages', 'routes', 'slots', 'managerContent']
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
  sources: Schema.array(Schema.object({
    id: Schema.string().required().description('服务器 ID（握手返回）'),
    name: Schema.string().required().description('来源名称'),
    url: Schema.string().required().description('来源 HTTP(S) origin'),
    accountId: Schema.string().default('').description('此来源的账户 ID'),
    enabled: Schema.boolean().default(true),
  })).default([]).description('并行数据来源'),
})
const Page = lazy(async () => ({ default: (await import('./app.js')).GameRoomPage }))
const pages = {
  lobby: '大厅',
  agents: '我的 Agent',
  dispatch: '派遣中心',
  create: '创建房间',
  invite: '邀请加入',
  prepare: '房间准备',
  agent: 'Agent 详情',
  personal: '个人',
  replay: '回放',
  settings: '数据来源',
  publish: '发布游戏包',
  funding: '投入确认',
  configuration: '来源与 Agent 配置',
}
export function apply(
  ctx: Context,
  config: { sample?: boolean; sources?: Source[]; agentProfiles?: AgentProfile[]; providerId?: string } = {},
): void {
  const port = config.sample
    ? new SamplePort()
    : new LivePort(config.sources ?? [], new PublicDiscoveryTransport(), config.agentProfiles ?? [])
  const runtime: ClientRuntime = {
    port,
    navigate: page => {
      void ctx.routes.navigate({ id: page })
    },
  }
  if (!config.sample && port instanceof LivePort) {
    ctx.inject(['http'], child => {
      const transport = new HostHttpTransport((child as Context & { http: HttpClientV1 }).http)
      port.setHttp(transport)
      child.effect(() => () => {
        transport.dispose()
        port.setHttp(new PublicDiscoveryTransport())
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
  ctx.inject(['restrictedContent'], child => {
    runtime.restrictedContent = (child as Context & { restrictedContent: RestrictedContentV1 }).restrictedContent
    child.effect(() => () => {
      runtime.restrictedContent = undefined
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
    messages: { ...Object.fromEntries(Object.entries(pages).map(([id, title]) => [id, title])), sidebar: '游戏大厅' },
  })
  ctx.i18n.define({
    namespace: name,
    locale: 'en',
    messages: {
      sidebar: 'Game lobby',
      lobby: 'Lobby',
      agents: 'My Agents',
      dispatch: 'Dispatch',
      create: 'Create room',
      invite: 'Join invitation',
      prepare: 'Ready room',
      agent: 'Agent details',
      personal: 'Personal',
      replay: 'Replay',
      settings: 'Data sources',
    },
  })
  for (const [id, title] of Object.entries(pages)) {
    dispose.push(
      ctx.pages.register(
        {
          $schema: CORDISX_PAGE_SCHEMA_V3,
          schemaVersion: 3,
          id,
          title: { key: id, fallback: title },
          description: { key: 'description', fallback: '多人游戏与 Agent 对局' },
          icon: 'host:layers',
          chrome: id === 'configuration' ? 'standard' : 'body-only',
        },
        defineReactPage(() => (
          <Suspense fallback={null}>
            <Page page={id} runtime={runtime} />
          </Suspense>
        )),
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
        title: { key: id, fallback: title },
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
      icon: 'host:layers',
      route: { id: 'lobby' },
    }),
  )
}
