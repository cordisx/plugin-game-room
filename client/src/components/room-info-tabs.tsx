import { Button } from 'cordisx/ui'
import { Symbol } from './icons.js'
import '../styles/room-info-tabs.css'
const baseTabs = [{ id: 'overview', label: '概览', icon: 'grid' }, { id: 'rules', label: '规则', icon: 'document' }, {
  id: 'source',
  label: '来源',
  icon: 'source',
}] as const
/** Shared presentation for lobby details, seated room summary and creation preview. */
export function RoomInfoTabs({ selected, changed, prefix, panelId, preview = false, players = false }: {
  selected: string
  changed: (tab: string) => void
  prefix: string
  panelId: string
  preview?: boolean
  players?: boolean
}) {
  const tabs = players
    ? [baseTabs[0], { id: 'players', label: '玩家', icon: 'personal' } as const, ...baseTabs.slice(1)]
    : baseTabs
  return (
    <div className='gr-room-info-tabs' data-preview={preview} role='tablist' aria-label='房间详情页签'>
      {tabs.map((item, index) => (
        <Button
          key={item.id}
          variant='ghost'
          role='tab'
          id={`${prefix}-${item.id}`}
          aria-controls={panelId}
          aria-selected={selected === item.id}
          tabIndex={selected === item.id ? 0 : -1}
          onClick={() => changed(item.id)}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft'
              ? (index + tabs.length - 1) % tabs.length
              : event.key === 'Home'
              ? 0
              : event.key === 'End'
              ? tabs.length - 1
              : -1
            if (next < 0) return
            event.preventDefault()
            changed(tabs[next]!.id)
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
          }}
        >
          <Symbol name={item.icon} size={16} />
          {item.label}
        </Button>
      ))}
    </div>
  )
}
