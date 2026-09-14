import type { ReactNode } from 'cordisx/react'
import '../styles/page-shell.css'
const titles: Record<string, string> = {
  lobby: '大厅',
  agents: '代理',
  dispatch: '任务',
  personal: '个人',
  ledger: '收支明细',
  settings: '数据来源',
  create: '创建房间',
  invite: '邀请加入',
  prepare: '对局房间',
  agent: 'Agent 详情',
  replay: '对局回放',
  publish: '发布游戏包',
  funding: '投入确认',
}
export function PageShell(
  { page, children }: {
    page: string
    navigate: (page: string) => void
    children: ReactNode
    /** Kept for existing callers during the isolated header migration; Host metadata owns actions. */
    actions?: ReactNode
  },
) {
  return (
    <div className='gr-root'>
      <main
        className={`gr-page-body${
          page === 'lobby'
            ? ' gr-page-body-lobby'
            : page === 'create'
            ? ' gr-page-body-create'
            : ['agents', 'dispatch'].includes(page)
            ? ' gr-page-body-directory'
            : ''
        }`}
        aria-label={titles[page]}
      >
        {children}
      </main>
    </div>
  )
}
