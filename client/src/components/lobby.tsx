import type { ReactElement } from 'react'
import { Button, EmptyState, SearchField, Select } from 'cordisx/ui'
import type { Agent, Dispatch, Filters, Room, SourceState } from '../data/model.js'
import { economyLabel, filterRooms, roomKey } from '../data/model.js'
import '../styles/lobby.css'
export function Lobby(
  { states, filters, setFilters, agents, dispatches, join, create, invite, agentDetail, navigate }: {
    states: SourceState[]
    filters: Filters
    setFilters: (filters: Filters) => void
    agents: Agent[]
    dispatches: Dispatch[]
    join: (room: Room) => void
    create: () => void
    invite: () => void
    agentDetail: (agent: Agent) => void
    navigate: (page: string) => void
  },
): ReactElement {
  const rooms = filterRooms(states, filters)
  const games = [...new Map(states.flatMap(state => state.snapshot?.games ?? []).map(game => [game.id, game])).values()]
  return (
    <div className='gr-lobby'>
      <section className='gr-room-area' aria-label='房间'>
        <div className='gr-room-toolbar'>
          <h2 className='gr-section-title'>房间</h2>
          <div className='gr-room-actions'>
            <SearchField
              aria-label='搜索房间或房间号'
              placeholder='搜索房间或房间号'
              value={filters.search}
              onChange={search => setFilters({ ...filters, search })}
            />
            <Button onClick={invite}>邀请加入</Button>
            <Button variant='primary' onClick={create}>＋ 创建房间</Button>
          </div>
        </div>
        <div className='gr-filter-row' aria-label='玩法筛选'>
          <Button
            variant={!filters.gameId ? 'primary' : 'secondary'}
            aria-pressed={!filters.gameId}
            onClick={() => setFilters({ ...filters, gameId: '' })}
          >
            ▦ 全部
          </Button>
          {games.map(game => (
            <Button
              key={game.id}
              variant={filters.gameId === game.id ? 'primary' : 'secondary'}
              aria-pressed={filters.gameId === game.id}
              onClick={() => setFilters({ ...filters, gameId: game.id })}
            >
              {game.icon} {game.name}
            </Button>
          ))}
        </div>
        <div className='gr-filter-row'>
          <Select
            aria-label='来源筛选'
            value={filters.sourceId}
            options={[
              { value: '', label: '全部来源' },
              ...states.map(({ source }) => ({ value: source.id, label: source.name })),
            ]}
            onChange={sourceId => setFilters({ ...filters, sourceId })}
          />
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
      <aside className='gr-agents-panel' aria-label='我的 Agent'>
        <div className='gr-panel-title'>
          <h2 className='gr-section-title'>我的 Agent</h2>
          <Button variant='ghost' onClick={() => navigate('agents')}>管理 →</Button>
        </div>
        {agents.map(agent => {
          const run = dispatches.find(run => run.agentId === agent.id && run.state === 'running')
          const room = states.flatMap(state => state.snapshot?.rooms ?? []).find(room =>
            room.id === run?.roomId && room.sourceId === run?.sourceId
          )
          return (
            <div className='gr-agent-row' key={agent.id}>
              <span className='gr-avatar' aria-hidden='true'>{agent.avatar}</span>
              <div className='gr-agent-copy'>
                <strong>{agent.name}</strong>
                <span className={agent.status === 'playing' ? 'gr-status' : 'gr-muted'}>
                  {agent.status === 'playing' ? '● 对局中' : '● 空闲'}
                </span>
                <p className='gr-agent-subtitle'>{room?.name ?? '随时准备加入新对局'}</p>
              </div>
              <Button onClick={() => agentDetail(agent)}>{agent.status === 'playing' ? '查看' : '派遣'}</Button>
            </div>
          )
        })}
        {agents.length === 0 && <p className='gr-muted'>尚未添加 Agent</p>}
        <Button variant='ghost' onClick={() => navigate('agents')}>⊕ 管理 Agent</Button>
      </aside>
    </div>
  )
}
function RoomCard({ room, sourceName, join }: { room: Room; sourceName: string; join: () => void }): ReactElement {
  const available = room.state === 'waiting' && room.occupied < room.capacity && room.compatible
  return (
    <article className='gr-room-card'>
      <div className='gr-room-heading'>
        <span className='gr-game-icon' data-game={room.game.id} aria-hidden='true'>{room.game.icon}</span>
        <div className='gr-room-name'>
          <h3>{room.name}</h3>
          <span className='gr-muted'>{room.game.name}</span>
        </div>
        <span className='gr-status' data-playing={room.state === 'playing'}>
          <span className='gr-dot' />
          {room.state === 'waiting' ? '等待中' : room.state === 'playing' ? '进行中' : '已结束'}
        </span>
      </div>
      <div className='gr-room-meta'>
        <span>⌂ {sourceName} · #{room.id.split(':').at(-1)?.slice(0, 8)}</span>
        <span className='gr-tag'>{room.allowAgents ? '真人与 Agent' : '仅真人'}</span>
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
        <Button disabled={!available} title={room.compatibilityReason} onClick={join}>
          {available ? '加入' : room.state === 'playing' ? '对局中' : '无空位'}
        </Button>
      </div>
    </article>
  )
}
