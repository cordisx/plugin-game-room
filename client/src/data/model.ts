/** Client view models. HTTP wire decoding belongs exclusively to the server adapter. */
export type EconomyMode = 'score' | 'local-chips' | 'token'
export type Source = {
  id: string
  name: string
  url: string
  accountId: string
  enabled: boolean
  connectionId?: string
}
export type Game = { id: string; name: string; version: string; icon: string; description: string }
export type Room = {
  id: string
  sourceId: string
  name: string
  game: Game
  occupied: number
  capacity: number
  state: 'waiting' | 'playing' | 'finished'
  allowAgents: boolean
  players: string[]
  mode: EconomyMode
  economyId?: string
  stake: number
  review: string
  rules: string
  settlement: string
  compatible: boolean
  compatibilityReason?: string
}
export type Agent = {
  id: string
  name: string
  avatar: string
  games: string[]
  status: 'idle' | 'playing'
  description: string
}
export type Dispatch = {
  id: string
  sourceId: string
  roomId: string
  agentId: string
  state: 'running' | 'withdrawn' | 'completed'
  budget: number
  turns: number
}
export type Balance = { economyId: string; label: string; available: number; reserved: number }
export type History = {
  id: string
  sourceId: string
  roomName: string
  gameName: string
  result: string
  mode: EconomyMode
  economyId?: string
  delta: number
  completedAt: string
}
export type Seat = {
  room: Room
  seatId: string
  ready: boolean
  consentRequired: boolean
  observation: unknown
  legalActions: readonly unknown[]
}
export type SourceSnapshot = { rooms: Room[]; games: Game[]; compatible: boolean; protocol: string; reason?: string }
export type SourceState = {
  source: Source
  state: 'loading' | 'online' | 'offline' | 'incompatible'
  snapshot?: SourceSnapshot
  error?: string
}
export type CreateRoom = {
  name: string
  gameId: string
  gameVersion: string
  mode: EconomyMode
  stake: number
  allowAgents: boolean
}
export type Consent = {
  gameVersion: string
  rules: string
  review: string
  mode: EconomyMode
  economyId?: string
  stake: number
  settlement: string
}
export type Invitation = { sourceId: string; roomId: string; sourceUrl?: string }
export const roomKey = (room: Pick<Room, 'sourceId' | 'id'>) => JSON.stringify([room.sourceId, room.id])
export const consentFor = (room: Room): Consent => ({
  gameVersion: room.game.version,
  rules: room.rules,
  review: room.review,
  mode: room.mode,
  economyId: room.economyId,
  stake: room.stake,
  settlement: room.settlement,
})
export const economyLabel = (mode: EconomyMode) =>
  ({ score: '积分', 'local-chips': '本局筹码', token: '虚拟 Token' })[mode]
export type Filters = { search: string; gameId: string; sourceId: string; vacancy: boolean; agents: boolean }
export function filterRooms(states: readonly SourceState[], filters: Filters): Room[] {
  const query = filters.search.trim().toLocaleLowerCase()
  return states.flatMap(state => state.state === 'online' ? state.snapshot?.rooms ?? [] : []).filter(room =>
    (!filters.sourceId || room.sourceId === filters.sourceId) && (!filters.gameId || room.game.id === filters.gameId)
    && (!filters.vacancy || (room.state === 'waiting' && room.occupied < room.capacity))
    && (!filters.agents || room.allowAgents)
    && (!query || `${room.name} ${room.id} ${room.game.name}`.toLocaleLowerCase().includes(query))
  )
}
export function normalizeSourceUrl(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.pathname !== '/'
  ) throw new Error('来源须为不含凭证的 HTTP(S) origin')
  return url.origin
}
export function encodeInvitation(invitation: Invitation, sources: readonly Source[]): string {
  const source = sources.find(source => source.id === invitation.sourceId)
  if (!source) throw new Error('未知邀请来源')
  return `game-room:v1:${encodeURIComponent(normalizeSourceUrl(source.url))}:${
    encodeURIComponent(invitation.sourceId)
  }:${encodeURIComponent(invitation.roomId)}`
}
export function decodeInvitation(value: string, sources: readonly Source[]): Invitation {
  const parts = value.trim().split(':')
  if (parts.length !== 5 || parts[0] !== 'game-room' || parts[1] !== 'v1') {
    throw new Error('请粘贴包含来源地址的完整邀请 ID')
  }
  const sourceUrl = normalizeSourceUrl(decodeURIComponent(parts[2]!))
  const sourceId = decodeURIComponent(parts[3]!)
  const roomId = decodeURIComponent(parts[4]!)
  if (
    !roomId
    || !sources.some(source => source.id === sourceId && source.enabled && normalizeSourceUrl(source.url) === sourceUrl)
  ) throw new Error('邀请地址与已连接来源不匹配，请在设置中核对')
  return { sourceId, roomId, sourceUrl }
}
