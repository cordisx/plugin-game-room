import type { ReactElement } from 'react'
import { Button, EmptyState, SearchField, Select } from 'cordisx/ui'
import type { Filters, Room, SourceState } from '../data/model.js'
import { economyLabel, filterRooms, roomKey } from '../data/model.js'
import '../styles/lobby.css'
import { GameIcon, Symbol } from './icons.js'
export function Lobby(
  {
    connected,
    refresh,
    busy,
    states,
    filters,
    setFilters,
    join,
    create,
    invite,
  }: {
    connected: (sourceId: string) => boolean
    refresh: () => void
    busy: boolean
    states: SourceState[]
    filters: Filters
    setFilters: (filters: Filters) => void
    join: (room: Room) => void
    create: () => void
    invite: () => void
  },
): ReactElement {
  const rooms = filterRooms(states, filters).sort((a, b) =>
    ['waiting', 'playing', 'finished'].indexOf(a.state) - ['waiting', 'playing', 'finished'].indexOf(b.state)
  )
  const games = [...new Map(states.flatMap(state => state.snapshot?.games ?? []).map(game => [game.id, game])).values()]
  return (
    <div className='gr-lobby'>
      <section className='gr-room-area' aria-label='房间'>
        <div className='gr-room-toolbar'>
          <h2 className='gr-section-title'>房间</h2>
          <div className='gr-room-actions'>
            <Button variant='ghost' onClick={invite}>邀请加入</Button>
            <Button variant='primary' onClick={create}>
              <Symbol name='plus' />创建房间
            </Button>
          </div>
        </div>
        <div className='gr-filter-toolbar'>
          <div className='gr-room-search'>
            <SearchField
              aria-label='搜索房间或房间号'
              placeholder='搜索房间或房间号'
              value={filters.search}
              onChange={search => setFilters({ ...filters, search })}
            />
          </div>
          <Select
            aria-label='来源筛选'
            value={filters.sourceId}
            options={[
              { value: '', label: '全部来源' },
              ...states.map(({ source }) => ({ value: source.id, label: source.name })),
            ]}
            onChange={sourceId => setFilters({ ...filters, sourceId })}
          />
          <div className='gr-game-filters' role='group' aria-label='玩法筛选'>
            <Button
              className='gr-filter-chip'
              variant='ghost'
              aria-pressed={!filters.gameId}
              data-active={!filters.gameId}
              onClick={() => setFilters({ ...filters, gameId: '' })}
            >
              <Symbol name='grid' />全部
            </Button>
            {games.map(game => (
              <Button
                key={game.id}
                className='gr-filter-chip'
                variant='ghost'
                aria-pressed={filters.gameId === game.id}
                data-active={filters.gameId === game.id}
                onClick={() => setFilters({ ...filters, gameId: game.id })}
              >
                <GameIcon id={game.id} size={16} />
                {game.name}
              </Button>
            ))}
          </div>
          <label className='gr-check'>
            <input
              type='checkbox'
              checked={filters.vacancy}
              onChange={event => setFilters({ ...filters, vacancy: event.target.checked })}
            />有空位
          </label>
          <label className='gr-check'>
            <input
              type='checkbox'
              checked={filters.agents}
              onChange={event => setFilters({ ...filters, agents: event.target.checked })}
            />允许 Agent
          </label>
          <span className='gr-source-summary'>
            <span className='gr-dot' />
            {states.filter(state => state.state === 'online').length} 个来源已连接
          </span>
          <Button variant='ghost' disabled={busy} onClick={refresh}>刷新</Button>
        </div>
        {states.filter(state => state.state !== 'online').map(state => (
          <div className='gr-source-notice' role='status' key={state.source.id}>
            {state.source.name} ·{' '}
            {state.state === 'loading' ? '连接中' : state.state === 'incompatible' ? '协议不兼容' : '连接中断'}
            {state.error && ` · ${state.error}`}
          </div>
        ))}
        <div className='gr-room-results'>
          <div className='gr-room-grid'>
            {rooms.map(room => (
              <RoomCard
                key={roomKey(room)}
                connected={connected(room.sourceId)}
                busy={busy}
                room={room}
                sourceName={states.find(state => state.source.id === room.sourceId)?.source.name ?? room.sourceId}
                join={() => join(room)}
              />
            ))}
          </div>
          {rooms.length === 0 && (
            <EmptyState
              title={states.some(state => state.state === 'loading')
                ? '正在获取房间'
                : '没有符合条件的房间'}
              description='调整玩法与来源筛选，或创建一个新房间。'
            />
          )}
          <p className='gr-result-count'>显示 {rooms.length} 个房间</p>
        </div>
      </section>
    </div>
  )
}
function RoomCard(
  { room, sourceName, join, busy, connected }: {
    room: Room
    sourceName: string
    join: () => void
    busy: boolean
    connected: boolean
  },
): ReactElement {
  const available = room.state === 'waiting' && room.occupied < room.capacity && room.compatible
  return (
    <article className='gr-room-card' data-state={room.state}>
      <div className='gr-room-heading'>
        <span className='gr-game-icon' data-game={room.game.id} aria-hidden='true'>
          <GameIcon id={room.game.id} />
        </span>
        <div className='gr-room-name'>
          <h3>{room.name}</h3>
          <span className='gr-muted'>{room.game.name}</span>
        </div>
        <span className='gr-status' data-state={room.state}>
          <span className='gr-dot' />
          {room.state === 'waiting' ? '等待中' : room.state === 'playing' ? '进行中' : '已结束'}
        </span>
      </div>
      <div className='gr-room-meta'>
        <span>
          <Symbol name='source' size={14} /> {sourceName} · #{room.id.split(':').at(-1)?.slice(0, 8)}
        </span>
        <span className='gr-tag'>{room.allowAgents ? '可派遣 Agent' : '不支持派遣'}</span>
      </div>
      <div className='gr-room-bottom'>
        <div className='gr-occupants'>
          <span className='gr-player-stack'>
            {room.players.slice(0, 3).map((name, i) => (
              <span key={i} className='gr-player' data-index={i}>{name.slice(0, 1)}</span>
            ))}
          </span>
          <span>{room.occupied} / {room.capacity}</span>
        </div>
        <span className='gr-economy'>{economyLabel(room.mode)}{room.stake > 0 ? ` · ${room.stake}` : ''}</span>
        <Button
          disabled={busy || !room.compatible || (connected && !available && !room.owned)}
          title={room.compatibilityReason}
          onClick={join}
        >
          {!connected && !available
            ? '查看房间'
            : room.owned
            ? '恢复席位'
            : available
            ? '加入'
            : room.state === 'playing'
            ? '进行中'
            : room.state === 'finished'
            ? '已结束'
            : '已满员'}
        </Button>
      </div>
    </article>
  )
}
