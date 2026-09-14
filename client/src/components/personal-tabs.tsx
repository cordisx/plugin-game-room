import { Button } from 'cordisx/ui'
import { Symbol, type SymbolName } from './icons.js'
const tabs: { id: string; label: string; icon: SymbolName }[] = [
  { id: 'overview', label: '概览', icon: 'grid' },
  { id: 'history', label: '战绩', icon: 'score' },
  { id: 'assets', label: '资产', icon: 'coins' },
]
export function PersonalTabs({ selected, changed }: { selected: string; changed: (tab: string) => void }) {
  return (
    <div className='gr-personal-tabs' role='tablist' aria-label='个人中心数据'>
      {tabs.map((tab, index) => (
        <Button
          variant='ghost'
          role='tab'
          key={tab.id}
          id={`gr-personal-tab-${tab.id}`}
          aria-controls='gr-personal-tab-panel'
          aria-selected={selected === tab.id}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => changed(tab.id)}
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
          <Symbol name={tab.icon} size={16} />
          {tab.label}
        </Button>
      ))}
    </div>
  )
}
