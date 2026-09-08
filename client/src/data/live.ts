import type {
  Agent,
  Balance,
  Consent,
  CreateRoom,
  Dispatch,
  Game,
  History,
  Invitation,
  Room,
  Seat,
  Source,
  SourceSnapshot,
} from './model.js'
import type { GameRoomPort } from './port.js'
import { array, type HttpTransport, number, object, string } from './http.js'
export class LivePort implements GameRoomPort {
  readonly kind = 'live' as const
  private packages = new Map<string, Record<string, unknown>[]>()
  private views = new Map<string, Record<string, unknown>>()
  constructor(readonly sources: Source[], private http: HttpTransport) {}
  private source(id: string) {
    const source = this.sources.find(source => source.id === id && source.enabled)
    if (!source) throw new Error('来源未连接')
    return source
  }
  private request(sourceId: string, path: string, signal: AbortSignal, body?: unknown) {
    return this.http.request({
      source: this.source(sourceId),
      path,
      signal,
      authenticated: true,
      ...(body === undefined ? {} : { method: 'POST', body }),
    })
  }
  private game(value: unknown): Game {
    const m = object(value)
    const id = string(m.id)
    return {
      id,
      name: string(m.name),
      version: string(m.version),
      icon: id.includes('gomoku') ? '◉' : '♠',
      description: typeof m.description === 'string' ? m.description : '',
    }
  }
  private room(value: unknown, source: Source): Room {
    const r = object(value)
    if (r.serverId !== source.id) throw new Error('房间身份与来源不一致')
    const config = object(r.config)
    const seats = array(r.seats).map(object)
    const game = this.game(r.manifest)
    return {
      id: string(r.id),
      sourceId: source.id,
      name: typeof config.roomName === 'string' ? config.roomName : game.name,
      game,
      occupied: seats.length,
      capacity: number(r.maxPlayers),
      state: r.status === 'playing' || r.status === 'funding'
        ? 'playing'
        : r.status === 'waiting'
        ? 'waiting'
        : 'finished',
      allowAgents: r.allowAgents === true,
      players: seats.map(seat => string(seat.name)),
      mode: r.mode as Room['mode'],
      stake: number(r.stake),
      review: r.reviewState === 'unreviewed' ? '作者自制 · 未审核' : String(r.reviewState),
      rules: `${game.description}\n包哈希：${string(r.packageHash)}\n每步时限 ${number(r.turnTimeoutMs) / 1000} 秒`,
      settlement: string(r.policy),
      compatible: true,
    }
  }
  async list(source: Source, signal: AbortSignal): Promise<SourceSnapshot> {
    const handshake = object(await this.http.request({ source, path: '/v1/handshake', signal }))
    if (handshake.serverId !== source.id) {
      return {
        rooms: [],
        games: [],
        compatible: false,
        protocol: String(handshake.protocol),
        reason: '服务器身份已变化，请在设置重新核对来源',
      }
    }
    if (handshake.protocol !== 'game-room/1' || handshake.gamePackageVersion !== 1) {
      return {
        rooms: [],
        games: [],
        compatible: false,
        protocol: String(handshake.protocol),
        reason: '需要 game-room/1 与 GamePackage v1',
      }
    }
    const [roomResponse, packageResponse] = await Promise.all([
      this.http.request({ source, path: '/v1/rooms', signal }),
      this.http.request({ source, path: '/v1/packages', signal }),
    ])
    const packages = array(object(packageResponse).packages).map(object)
    this.packages.set(source.id, packages)
    return {
      rooms: array(object(roomResponse).rooms).map(room => this.room(room, source)),
      games: packages.map(pkg => this.game(pkg.manifest)),
      compatible: true,
      protocol: 'game-room/1',
    }
  }
  private async seat(sourceId: string, value: unknown): Promise<Seat> {
    const view = object(value)
    const room = this.room(view, this.source(sourceId))
    this.views.set(JSON.stringify([sourceId, room.id]), view)
    const observation = view.observation
    const self = array(view.seats).map(object).find(seat => seat.id === view.selfSeatId)
    return {
      room,
      seatId: string(view.selfSeatId),
      ready: self?.ready === true,
      consentRequired: self?.ready !== true,
      observation,
      legalActions: observation && typeof observation === 'object' && !Array.isArray(observation)
        ? array(object(observation).legalActions ?? [])
        : [],
    }
  }
  async create(sourceId: string, draft: CreateRoom, signal: AbortSignal): Promise<Invitation> {
    const pkg = this.packages.get(sourceId)?.find(pkg =>
      object(pkg.manifest).id === draft.gameId && object(pkg.manifest).version === draft.gameVersion
    )
    if (!pkg) throw new Error('此来源玩法目录已变更，请刷新')
    if (draft.mode === 'token') throw new Error('请先完成经济实例连接与投入条款确认')
    const manifest = object(pkg.manifest)
    const policies = Array.isArray(manifest.settlementPolicies) ? manifest.settlementPolicies : ['equal-winners-v1']
    const view = object(
      await this.request(sourceId, '/v1/rooms', signal, {
        packageHash: string(pkg.hash),
        mode: draft.mode,
        config: { roomName: draft.name },
        maxPlayers: manifest.maxPlayers,
        allowAgents: draft.allowAgents,
        turnTimeoutMs: 60000,
        stake: 0,
        policy: policies[0],
      }),
    )
    await this.seat(sourceId, view)
    return { sourceId, roomId: string(view.id) }
  }
  async join(invitation: Invitation, signal: AbortSignal) {
    await this.list(this.source(invitation.sourceId), signal)
    const value = await this.request(
      invitation.sourceId,
      `/v1/rooms/${encodeURIComponent(invitation.roomId)}/join`,
      signal,
      {},
    )
    return this.seat(invitation.sourceId, value)
  }
  async ready(seat: Seat, consent: Consent, signal: AbortSignal) {
    const view = this.views.get(JSON.stringify([seat.room.sourceId, seat.room.id]))
    if (!view || consent.gameVersion !== object(view.manifest).version || consent.stake !== view.stake) {
      throw new Error('条款已变更，请重新查看房间')
    }
    return this.seat(
      seat.room.sourceId,
      await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/ready`, signal, {
        ready: true,
        consent: {
          packageHash: view.packageHash,
          stake: view.stake,
          policy: view.policy,
          reviewState: view.reviewState,
        },
      }),
    )
  }
  async leave(seat: Seat, signal: AbortSignal) {
    await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/leave`, signal, {})
  }
  async agents(_signal: AbortSignal): Promise<Agent[]> {
    return []
  }
  async dispatches(_signal: AbortSignal): Promise<Dispatch[]> {
    return []
  }
  async dispatch(_agent: string, _invitation: Invitation, _budget: number, _signal: AbortSignal): Promise<Dispatch> {
    throw new Error('Agent 派遣服务尚未连接')
  }
  async withdraw(_dispatch: Dispatch, _signal: AbortSignal) {
    throw new Error('Agent 派遣服务尚未连接')
  }
  async balances(_signal: AbortSignal): Promise<Balance[]> {
    return []
  }
  async history(signal: AbortSignal): Promise<History[]> {
    const results = await Promise.allSettled(
      this.sources.filter(source => source.enabled).map(async source => {
        const response = object(await this.request(source.id, '/v1/me/rooms', signal))
        return array(response.rooms).map(value => this.room(value, source)).filter(room => room.state === 'finished')
          .map(room => ({
            id: room.id,
            sourceId: source.id,
            roomName: room.name,
            gameName: room.game.name,
            result: '已结束',
            mode: room.mode,
            delta: 0,
            completedAt: '',
          }))
      }),
    )
    return results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  }
  async replay(record: History, signal: AbortSignal) {
    const response = object(
      await this.request(record.sourceId, `/v1/rooms/${encodeURIComponent(record.id)}/replay`, signal),
    )
    return array(response.events).map(value => {
      const event = object(value)
      return { turn: number(event.version), description: string(event.kind) }
    })
  }
  dispose() {
    this.http.dispose()
    this.views.clear()
    this.packages.clear()
  }
}
