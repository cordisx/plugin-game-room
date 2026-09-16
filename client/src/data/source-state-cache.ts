import type { GameRoomPort } from './port.js'
import type { SourceState } from './model.js'

const cache = new WeakMap<GameRoomPort, { ownerRevision: number | string; scope: string; states: SourceState[] }>()
const scope = (port: GameRoomPort) => JSON.stringify(port.sources.map(s => [s.id, s.url, s.accountId, s.enabled]))
export function cachedSourceStates(port: GameRoomPort, ownerRevision: number | string): SourceState[] {
  const saved = cache.get(port)
  return saved?.ownerRevision === ownerRevision && saved.scope === scope(port) ? saved.states : []
}
export function cacheSourceStates(port: GameRoomPort, ownerRevision: number | string, states: SourceState[]) {
  cache.set(port, {
    ownerRevision,
    scope: scope(port),
    states: states.map(state => ({ ...state, source: { ...state.source } })),
  })
}
