import { defaultLobbyFilters, lobbyEmptyState } from '../data/lobby-context.js'
import { LobbyEmptyState } from './lobby-empty-state.js'
import { useRoomLayoutMotion } from './use-room-layout-motion.js'
import { RoomDetails } from './room-details.js'
import { useEffect, useState } from 'cordisx/react'
import { LobbyFilters } from './lobby-filters.js'
import type { ReactElement } from 'react'
import { Button, EmptyState, SearchField } from 'cordisx/ui'
import type { Filters, Room, SourceState } from '../data/model.js'
import { filterRooms, roomKey } from '../data/model.js'
import '../styles/lobby.css'
import { Symbol } from './icons.js'
import { RoomCard } from './room-card.js'
export function Lobby(
  {
    initialRoom,
    initialWatching,
    spectator,
    connected,
    configured,
    create,
    refresh,
    bots,
    busy,
    states,
    filters,
    setFilters,
    join,
    dispatch,
  }: {
    initialRoom?: Room
    configured: boolean
    initialWatching?: boolean
    spectator?: (room: Room, close: () => void) => ReactElement
    connected: (sourceId: string) => boolean
    bots?: (room: Room, change: import('../data/model.js').BotChange) => void
    refresh: () => void
    busy: boolean
    states: SourceState[]
    filters: Filters
    setFilters: (filters: Filters) => void
    join: (room: Room) => void
    create: () => void
    invite: () => void
    dispatch: (room: Room) => void
  },
): ReactElement {
  const [joiningKey, setJoiningKey] = useState<string | null>(null)
  useEffect(() => {
    if (!busy) setJoiningKey(null)
  }, [busy])
  const [watching, setWatching] = useState(initialWatching ?? false)
  const [retainedRoom, setRetainedRoom] = useState<Room | null>(initialRoom ?? null)
  const [detailKey, setDetailKey] = useState<string | null>(initialRoom ? roomKey(initialRoom) : null)
  const motion = useRoomLayoutMotion(detailKey)
  const detailRoom = states.flatMap(state => state.snapshot?.rooms ?? []).find(room => roomKey(room) === detailKey)
  const sourcesAvailable = (room: Room) => states.some(state => state.source.id === room.sourceId)
  const panelRoom = detailRoom ?? retainedRoom
  const [filtersOpen, setFiltersOpen] = useState(false)
  const count = Number((filters.status ?? 'active') !== 'active') + Number(filters.agents) + Number(!!filters.gameId)
    + Number(!!filters.sourceIds?.length)
  const rooms = filterRooms(states, filters).sort((a, b) =>
    ['waiting', 'playing', 'finished'].indexOf(a.state) - ['waiting', 'playing', 'finished'].indexOf(b.state)
  )
  const empty = lobbyEmptyState(states, filters, configured)
  return (
    <div className='gr-lobby' ref={motion.root} data-detail-open={!!detailRoom}>
      <div className='gr-lobby-controls'>
        <div className='gr-lobby-tools'>
          <SearchField
            className='gr-lobby-search'
            clearable
            clearLabel='清空搜索'
            aria-label='搜索房间或房间号'
            placeholder='搜索房间或房间号'
            value={filters.search}
            onChange={search => setFilters({ ...filters, search })}
          />
          <Button
            variant='ghost'
            className='gr-lobby-filter gr-toolbar-icon'
            aria-label='筛选房间'
            title='筛选房间'
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Symbol name='filter' size={16} />
            {count > 0 && <span className='gr-filter-count'>{count}</span>}
          </Button>
        </div>
      </div>
      <section className='gr-room-area' aria-label='房间'>
        {filtersOpen && <LobbyFilters filters={filters} setFilters={setFilters} states={states} />}
        {states.filter(state => state.state !== 'online' && state.state !== 'loading').map(state => (
          <div className='gr-source-notice' role='status' key={state.source.id}>
            {state.source.name} · {state.state === 'incompatible' ? '协议不兼容' : '连接中断'}
            {state.error && ` · ${state.error}`}
            <Button
              variant='ghost'
              disabled={busy}
              className='gr-square-button'
              aria-label='重试连接'
              title='重试连接'
              onClick={refresh}
            >
              <Symbol name='reset' />
            </Button>
          </div>
        ))}
        <div className='gr-room-results' data-empty={rooms.length === 0}>
          {rooms.length > 0 && (
            <div className='gr-room-grid'>
              {rooms.map(room => (
                <RoomCard
                  key={roomKey(room)}
                  inspect={() => {
                    motion.capture()
                    setRetainedRoom(room)
                    setDetailKey(current => current === roomKey(room) ? null : roomKey(room))
                  }}
                  connected={connected(room.sourceId)}
                  busy={busy}
                  joining={busy && joiningKey === roomKey(room)}
                  room={room}
                  sourceName={states.find(state => state.source.id === room.sourceId)?.source.name ?? room.sourceId}
                  join={() => {
                    setJoiningKey(roomKey(room))
                    join(room)
                  }}
                  dispatch={() => dispatch(room)}
                  sources={states.map(state => state.source)}
                />
              ))}
            </div>
          )}
          {rooms.length === 0 && (empty.kind === 'error'
            ? (
              <EmptyState
                title='暂时无法获取房间'
                description='请检查上方来源状态后重试。已有房间不会被删除。'
              />
            )
            : empty.kind !== 'populated' && (
              <LobbyEmptyState
                kind={empty.kind}
                game={'game' in empty ? empty.game : undefined}
                create={create}
                reset={empty.kind === 'lobby'
                  ? undefined
                  : () => setFilters(empty.kind === 'search' ? { ...filters, search: '' } : defaultLobbyFilters())}
              />
            ))}
        </div>
      </section>
      <div className='gr-detail-reveal' data-open={!!detailRoom} aria-hidden={!detailRoom} inert={!detailRoom}>
        {panelRoom && sourcesAvailable(panelRoom) && (
          watching && spectator ? spectator(panelRoom, () => setWatching(false)) : (
            <RoomDetails
              bots={bots ? change => bots(panelRoom, change) : undefined}
              watch={() => setWatching(true)}
              key={roomKey(panelRoom)}
              room={panelRoom}
              sources={states.map(state => state.source)}
              busy={busy}
              join={() => join(panelRoom)}
              dispatch={() => dispatch(panelRoom)}
              close={() => {
                motion.capture()
                setDetailKey(null)
              }}
            />
          )
        )}
      </div>
    </div>
  )
}
