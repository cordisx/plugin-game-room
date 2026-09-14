import { type ReactNode, useState } from 'cordisx/react'
import { Button, EmptyState } from 'cordisx/ui'
import type { PanelResource } from '../data/use-panel-resource.js'
import { Symbol } from './icons.js'
import '../styles/personal-schedule.css'
export function PanelState<T>({ resource, unavailable, empty, description, action, next, children }: {
  resource: PanelResource<T>
  unavailable?: string
  empty: string
  description: string
  action: string
  next: () => void
  children: ReactNode
}) {
  if (unavailable) {
    return (
      <EmptyState
        style={{ minHeight: 0, padding: '12px 0', textAlign: 'left', alignItems: 'flex-start' }}
        title='当前能力不可用'
        description={unavailable}
        action={<Button onClick={next}>{action}</Button>}
      />
    )
  }
  if (resource.status === 'loading') return <div className='gr-panel-loading' role='status'>正在加载…</div>
  if (resource.status === 'error') {
    return (
      <>
        <div className='gr-panel-message' role='alert'>
          <div className='gr-panel-copy'>
            <strong>
              {resource.stale ? '刷新失败 · 显示上次结果' : resource.data.length ? '部分数据加载失败' : '加载失败'}
            </strong>
            <span className='gr-muted'>{resource.error}</span>
          </div>
          <Button disabled={resource.refreshing} onClick={resource.retry}>
            {resource.refreshing ? '刷新中…' : '重试'}
          </Button>
        </div>
        {resource.data.length > 0 && children}
      </>
    )
  }
  if (!resource.data.length) {
    return (
      <EmptyState
        style={{ minHeight: 0, padding: '12px 0', textAlign: 'left', alignItems: 'flex-start' }}
        title={empty}
        description={description}
        action={<Button onClick={next}>{action}</Button>}
      />
    )
  }
  return (
    <>{resource.refreshing && <span className='gr-panel-refresh-status' role='status'>正在刷新…</span>}{children}</>
  )
}
export function RecordDetails({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className='gr-panel-details'>
      <Button
        variant='ghost'
        className='gr-square-button'
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <Symbol name='document' />
      </Button>
      {open && (
        <div className='gr-panel-identifiers'>
          {children}
          <Button onClick={() => setOpen(false)}>收起</Button>
        </div>
      )}
    </div>
  )
}
