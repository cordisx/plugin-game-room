import { latestGameCatalog } from '../data/game-catalog.js'
import { useEffect, useRef, useState } from 'cordisx/react'
import { Button, SearchField, Select, SelectionRail } from 'cordisx/ui'
import type { Filters, SourceState } from '../data/model.js'
import { Symbol, type SymbolName } from './icons.js'
export function LobbyFilters(
  { filters, setFilters, states }: { filters: Filters; setFilters: (value: Filters) => void; states: SourceState[] },
) {
  const catalog = latestGameCatalog(states)
  const games = [...new Map(catalog.map(item => [JSON.stringify([item.source.id, item.game.id]), item])).entries()]
  const scopedIds = filters.sourceIds?.length ? filters.sourceIds : filters.sourceId ? [filters.sourceId] : []
  const scopedGames = games.filter(([, item]) => !scopedIds.length || scopedIds.includes(item.source.id))
  const selectedGame = filters.gameId ? scopedGames.filter(([, item]) => item.game.id === filters.gameId) : []
  const selectedValue = selectedGame.length === 1 ? selectedGame[0]![0] : filters.gameId ? 'unresolved-game' : ''
  const [query, setQuery] = useState('')
  const menu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  const statuses: { value: NonNullable<Filters['status']>; label: string; icon: SymbolName }[] = [
    { value: 'active', label: '未结束', icon: 'clock' },
    { value: 'available', label: '可加入', icon: 'check' },
    { value: 'all', label: '全部', icon: 'grid' },
  ]
  const selected = filters.sourceIds ?? []
  return (
    <div className='gr-inline-filters' aria-label='房间筛选'>
      <div className='gr-filter-row'>
        <span className='gr-filter-label'>
          <Symbol name='game' />游戏
        </span>
        <Select
          density='compact'
          aria-label='选择游戏'
          value={selectedValue}
          options={[
            { value: '', label: '全部游戏' },
            ...(filters.gameId && selectedValue === 'unresolved-game'
              ? [{ value: 'unresolved-game', label: '请重新选择游戏与来源' }]
              : []),
            ...scopedGames.map(([value, item]) => ({
              value,
              label: states.length > 1 ? `${item.game.name} · ${item.source.name}` : item.game.name,
            })),
          ]}
          onChange={value => {
            if (!value) setFilters({ ...filters, gameId: '' })
            else if (value !== 'unresolved-game') {
              const [sourceId, gameId] = JSON.parse(value) as [string, string]
              setFilters({ ...filters, gameId, sourceId: '', sourceIds: [sourceId] })
            }
          }}
        />
      </div>
      <div className='gr-filter-row'>
        <span className='gr-filter-label'>
          <Symbol name='clock' />房间状态
        </span>
        <SelectionRail
          aria-label='房间状态'
          layout='horizontal'
          value={filters.status ?? 'active'}
          options={statuses.map(item => ({
            value: item.value,
            label: (
              <>
                <Symbol name={item.icon} />
                {item.label}
              </>
            ),
          }))}
          onChange={value => setFilters({ ...filters, status: value as Filters['status'], vacancy: false })}
        />
        <Button
          className='gr-filter-reset gr-toolbar-icon'
          variant='ghost'
          aria-label='重置筛选'
          title='重置筛选'
          onClick={() =>
            setFilters({
              ...filters,
              status: 'active',
              gameId: '',
              agents: false,
              sourceIds: [],
              sourceId: '',
              vacancy: false,
            })}
        >
          <Symbol name='reset' size={16} />
        </Button>
      </div>
      <div className='gr-filter-row'>
        <span className='gr-filter-label'>
          <Symbol name='agent' />Agent
        </span>
        <SelectionRail
          aria-label='Agent 加入条件'
          layout='horizontal'
          value={filters.agents ? 'allowed' : 'all'}
          options={[{
            value: 'all',
            label: (
              <>
                <Symbol name='grid' />不限
              </>
            ),
          }, {
            value: 'allowed',
            label: (
              <>
                <Symbol name='agent' />允许加入
              </>
            ),
          }]}
          onChange={value => setFilters({ ...filters, agents: value === 'allowed' })}
        />
      </div>
      <div className='gr-filter-row'>
        <span className='gr-filter-label'>
          <Symbol name='source' />服务器来源
        </span>
        <details
          ref={menu}
          className='gr-source-select'
          onKeyDown={event => {
            if (event.key === 'Escape' && menu.current) {
              menu.current.open = false
              menu.current.querySelector('summary')?.focus()
            }
          }}
        >
          <summary aria-label='选择服务器来源' title='选择服务器来源'>
            <span>{selected.length ? `已选 ${selected.length} 个来源` : '全部来源'}</span>
            <Symbol name='down' />
          </summary>
          <div className='gr-source-options'>
            <SearchField aria-label='搜索服务器来源' placeholder='搜索来源' value={query} onChange={setQuery} />
            <label>
              <input
                type='checkbox'
                checked={!selected.length}
                onChange={() => setFilters({ ...filters, sourceIds: [], sourceId: '' })}
              />全部来源
            </label>
            {states.filter(({ source }) => source.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((
              { source, state },
            ) => (
              <label key={source.id}>
                <input
                  type='checkbox'
                  checked={selected.includes(source.id)}
                  onChange={() =>
                    setFilters({
                      ...filters,
                      sourceId: '',
                      sourceIds: selected.includes(source.id)
                        ? selected.filter(id => id !== source.id)
                        : [...selected, source.id],
                    })}
                />
                <span>{source.name}</span>
                <span
                  className='gr-source-health'
                  title={state === 'online' ? '已连接' : '未连接'}
                  data-online={state === 'online'}
                />
              </label>
            ))}
          </div>
        </details>
      </div>
    </div>
  )
}
