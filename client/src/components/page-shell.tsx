import type { ReactNode } from 'cordisx/react'
import { Button } from 'cordisx/ui'
import { Symbol, type SymbolName } from './icons.js'
import '../styles/page-shell.css'
const navigation: { id: string; label: string; icon: SymbolName }[] = [
  { id: 'lobby', label: '大厅', icon: 'game' },
  { id: 'agents', label: '我的 Agent', icon: 'agent' },
  { id: 'dispatch', label: '派遣中心', icon: 'dispatch' },
]
const titles: Record<string, string> = {
  personal: '个人',
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
  { page, navigate, children }: { page: string; navigate: (page: string) => void; children: ReactNode },
) {
  const detail = !navigation.some(item => item.id === page) && !['personal', 'settings'].includes(page)
  return (
    <div className='gr-root'>
      <header className='gr-page-header'>
        <nav className='gr-page-navigation' aria-label='游戏导航'>
          {navigation.map(item => (
            <Button
              key={item.id}
              variant={page === item.id ? 'primary' : 'ghost'}
              aria-label={item.label}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <Symbol name={item.icon} />
              <span className='gr-page-navigation-label'>{item.label}</span>
            </Button>
          ))}
        </nav>
        <div className='gr-page-utilities'>
          <Button variant='ghost' aria-label='个人 · 资产与战绩' onClick={() => navigate('personal')}>
            <Symbol name='personal' />
            <span className='gr-page-utility-label'>个人</span>
          </Button>
          <Button
            variant='ghost'
            aria-label='设置 · 数据来源'
            title='设置 · 数据来源'
            onClick={() => navigate('settings')}
          >
            <Symbol name='settings' />
          </Button>
        </div>
      </header>
      {detail && (
        <div className='gr-page-context'>
          <Button
            variant='ghost'
            onClick={() => navigate(page === 'agent' ? 'agents' : page === 'replay' ? 'personal' : 'lobby')}
          >
            <Symbol name='back' />返回
          </Button>
          <h1>{titles[page] ?? '游戏大厅'}</h1>
        </div>
      )}
      <main
        className={page === 'lobby' ? 'gr-page-body gr-page-body-lobby' : 'gr-page-body'}
        aria-label={navigation.find(item => item.id === page)?.label ?? titles[page]}
      >
        {children}
      </main>
    </div>
  )
}
