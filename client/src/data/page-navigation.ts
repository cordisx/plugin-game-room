import type { CordisXPageControls } from 'cordisx/contracts'

export const pages = {
  lobby: '大厅',
  agents: '代理',
  dispatch: '任务',
  create: '创建房间',
  invite: '邀请加入',
  prepare: '对局房间',
  agent: 'Agent 详情',
  personal: '个人',
  ledger: '收支明细',
  replay: '回放',
  settings: '数据来源',
  publish: '发布游戏包',
  funding: '费用确认',
  configuration: '来源与 Agent 配置',
}

const parents: Partial<Record<keyof typeof pages, keyof typeof pages>> = {
  agent: 'agents',
  ledger: 'personal',
  replay: 'personal',
  funding: 'prepare',
  publish: 'create',
}

/** Page hierarchy is stable for direct links and refreshes; it never depends on visit history. */
export function pageNavigation(page: string, roomName?: string) {
  if (page === 'configuration' || !Object.hasOwn(pages, page)) return undefined
  if (page === 'lobby') return { breadcrumbs: [], back: undefined }
  const id = page as keyof typeof pages
  const parent = parents[id] ?? 'lobby'
  const label = (target: keyof typeof pages) =>
    target === 'prepare' && roomName
      ? { key: 'room-name', fallback: roomName }
      : { key: target, fallback: pages[target] }
  return {
    breadcrumbs: [
      { key: 'sidebar', fallback: '游戏大厅' },
      ...(parent === 'lobby' ? [] : [label(parent)]),
      label(id),
    ],
    back: { id: parent },
  }
}

export function updatePageHeader(
  page: string,
  controls?: Pick<CordisXPageControls, 'setHeaderBreadcrumbs'>,
  roomName?: string,
) {
  const navigation = pageNavigation(page, roomName)
  if (!navigation?.back) return false
  return controls?.setHeaderBreadcrumbs?.(navigation.breadcrumbs, navigation.back) ?? false
}
