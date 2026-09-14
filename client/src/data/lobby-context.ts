import { latestGameCatalog, latestSourceGames } from './game-catalog.js'
import { filterRooms, type Filters, type SourceState } from './model.js'
export const defaultLobbyFilters = (): Filters => ({
  search: '',
  gameId: '',
  sourceId: '',
  sourceIds: [],
  vacancy: false,
  status: 'active',
  agents: false,
})
export type CreateContext = { sourceId?: string; gameId?: string; chooseSource: boolean; chooseGame: boolean }
const sourceIds = (filters: Filters) => [
  ...new Set([
    ...(filters.sourceIds ?? []),
    ...(filters.sourceId ? [filters.sourceId] : []),
  ]),
]
/** Logical game identity is resolved against the selected source, never a package from another server. */
export function createContext(states: readonly SourceState[], filters: Filters): CreateContext {
  const online = states.filter(s => s.state === 'online' && s.snapshot?.compatible)
  const ids = sourceIds(filters)
  const explicitSource = ids.length === 1 ? online.find(s => s.source.id === ids[0]) : undefined
  const source = ids.length ? explicitSource : online.length === 1 ? online[0] : undefined
  const selectedGame = filters.gameId
    ? online.some(s => (!source || s === source) && latestSourceGames(s).some(g => g.id === filters.gameId))
    : false
  return {
    sourceId: source?.source.id,
    gameId: selectedGame ? filters.gameId : undefined,
    chooseSource: !source,
    chooseGame: !!filters.gameId && !selectedGame,
  }
}
export function resolveCreateSelection(states: readonly SourceState[], context?: CreateContext) {
  const online = states.filter(s => s.state === 'online' && s.snapshot?.compatible)
  const source = context?.sourceId
    ? online.find(s => s.source.id === context.sourceId)
    : !context?.chooseSource && online.length === 1
    ? online[0]
    : undefined
  const games = latestSourceGames(source)
  const candidates = context?.gameId
    ? games.filter(g => g.id === context.gameId)
    : !context?.chooseGame
    ? games.filter(g => g.id === games[0]?.id)
    : []
  const game = candidates.length === 1 ? candidates[0] : undefined
  return { sourceId: source?.source.id ?? '', packageHash: game?.packageHash ?? '' }
}
export function openLobbyCreate(runtime: {
  lobbyStates?: SourceState[]
  lobbyFilters?: Filters
  createContext?: CreateContext
  navigate: (page: string) => void
}) {
  runtime.createContext = createContext(runtime.lobbyStates ?? [], runtime.lobbyFilters ?? defaultLobbyFilters())
  runtime.navigate('create')
}
export function lobbyEmptyState(states: readonly SourceState[], filters: Filters, configured = true) {
  const ids = sourceIds(filters)
  const scoped = ids.length ? states.filter(s => ids.includes(s.source.id)) : states
  const online = scoped.filter(s => s.state === 'online' && s.snapshot)
  const count = filterRooms(states, filters).length
  if (count) return { kind: 'populated' as const }
  if (!states.length && !configured) return { kind: 'error' as const }
  if (!states.length || scoped.some(s => s.state === 'loading' || (s.state === 'online' && !s.snapshot))) {
    return { kind: 'loading' as const }
  }
  if (scoped.some(s => s.state === 'offline' || s.state === 'incompatible')) return { kind: 'error' as const }
  if (filters.search.trim()) return { kind: 'search' as const }
  const selected = latestGameCatalog(online).filter(item => item.game.id === filters.gameId)
  const game = selected.length === 1 ? selected[0]!.game : undefined
  if (game) return { kind: 'game' as const, game: { id: game.id, name: game.name } }
  const rooms = online.flatMap(s => s.snapshot?.rooms ?? [])
  if (
    ids.length || filters.gameId || filters.agents || filters.vacancy || filters.status === 'available' || rooms.length
  ) {
    return { kind: 'filter' as const }
  }
  return { kind: 'lobby' as const }
}
