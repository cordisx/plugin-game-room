import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineReactPage, lazy, Suspense } from 'cordisx/react'
import {
  CORDISX_MANAGER_CONTENT_NAVIGATION_SCHEMA_V1,
  CORDISX_PAGE_SCHEMA_V3,
  CORDISX_PLUGIN_MANIFEST_SCHEMA_V1,
  CORDISX_ROUTE_SCHEMA_V2,
  type CordisXPluginManifestV1,
} from 'cordisx/contracts'
import { LivePort } from './data/live.js'
import { PublicDiscoveryTransport } from './data/http.js'
import type { Source } from './data/model.js'
import { SamplePort } from './data/sample.js'
import type { ClientRuntime } from './app.js'
export const name = 'game-room'
export const manifest = {
  $schema: CORDISX_PLUGIN_MANIFEST_SCHEMA_V1,
  schemaVersion: 1,
  id: name,
  name: 'Game Room',
  capabilities: [],
} as const satisfies CordisXPluginManifestV1
export const inject = ['i18n', 'pages', 'routes', 'slots', 'managerContent', 'commands']
export const Config = Schema.object({
  sample: Schema.boolean().default(false).description('样例数据预览；不运行真实游戏或改变余额。'),
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
}
export function apply(ctx: Context, config: { sample?: boolean; sources?: Source[] } = {}): void {
  const port = config.sample ? new SamplePort() : new LivePort(config.sources ?? [], new PublicDiscoveryTransport())
  const runtime: ClientRuntime = {
    port,
    navigate: page => {
      void ctx.routes.navigate({ id: page })
    },
  }
  const dispose: (() => void)[] = []
  ctx.effect(() => () => {
    port.dispose()
    for (const release of dispose.reverse()) release()
  })
  ctx.i18n.define({
    namespace: name,
    locale: 'zh-CN',
    default: true,
    messages: Object.fromEntries(Object.entries(pages).map(([id, title]) => [id, title])),
  })
  ctx.i18n.define({
    namespace: name,
    locale: 'en',
    messages: {
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
          icon: 'host:info',
          chrome: 'standard',
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
        path: `/manager/extensions/game-room/${id}`,
        outlet: 'manager.content',
        page: id,
        title: { key: id, fallback: title },
        description: { key: 'description', fallback: '多人游戏与 Agent 对局' },
      }),
    )
    const top = ['lobby', 'agents', 'dispatch'].includes(id)
    dispose.push(ctx.managerContent.register({
      $schema: CORDISX_MANAGER_CONTENT_NAVIGATION_SCHEMA_V1,
      schemaVersion: 1,
      id,
      route: { id },
      header: { title: { kind: 'route' } },
      ...(top
        ? { tabs: ['lobby', 'agents', 'dispatch'].map(id => ({ id, route: { id } })) }
        : { parentRoute: { id: id === 'agent' ? 'agents' : id === 'replay' ? 'personal' : 'lobby' } }),
    }))
  }
  dispose.push(
    ctx.slots.register({
      name: 'manager.settings.navigation-items',
      id: 'game-room',
      group: 'after-settings',
      order: 160,
    }, { route: { id: 'lobby' } }),
  )
  dispose.push(
    ctx.commands.register(
      { id: 'open-lobby', title: { key: 'lobby', fallback: '大厅' } },
      () => ctx.routes.navigate({ id: 'lobby' }),
    ),
  )
  dispose.push(
    ctx.slots.register({ name: 'sidebar.navigation.items', id: 'open', group: 'utility', order: 95 }, {
      label: { key: 'lobby', fallback: '棋牌' },
      icon: 'host:info',
      command: { id: 'open-lobby' },
    }),
  )
}
