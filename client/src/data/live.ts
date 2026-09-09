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
import { normalizeSourceUrl } from './model.js'
import { ClientAgents } from './agents.js'
import type { AgentLoopProviderOptions, AgentProfile } from '@cordisx/game-room-agents'
import { validateActionData } from './actions.js'
import { EconomyAccounts, type FundingQuote } from './economy.js'
import type { GameRoomPort } from './port.js'
import { array, type HttpTransport, number, object, RequestFailure, string } from './http.js'
export class LivePort implements GameRoomPort {
  readonly kind = 'live' as const
  private disposed = false
  private economy = new EconomyAccounts(() => this.http)
  private ownedRooms = new Map<string, Set<string>>()
  private accounts = new Map<string, string>()
  private packages = new Map<string, Record<string, unknown>[]>()
  private cards = new Map<string, Record<string, unknown>>()
  private views = new Map<string, Record<string, unknown>>()
  private agentController: ClientAgents
  constructor(readonly sources: Source[], private http: HttpTransport, profiles: AgentProfile[] = []) {
    if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('来源服务器 ID 不可重复')
    for (const source of sources) normalizeSourceUrl(source.url)
    this.agentController = new ClientAgents(profiles, id => this.source(id), () => this.http)
  }
  capabilities() {
    return { account: !!this.http.connect, agent: this.agentController.availability() }
  }
  configureAgents(options: AgentLoopProviderOptions) {
    this.agentController.configure(options)
  }
  setHttp(http: HttpTransport) {
    void this.http.dispose()
    this.economy.dispose()
    this.pendingActions.clear()
    this.ownedRooms.clear()
    this.accounts.clear()
    this.http = http
  }
  isConnected(sourceId: string) {
    return this.accounts.has(sourceId)
  }
  async connect(sourceId: string) {
    this.accounts.delete(sourceId)
    this.ownedRooms.delete(sourceId)
    const source = this.source(sourceId)
    if (!this.http.connect) throw new Error('此 Host 尚不支持安全账户连接')
    await this.http.connect(source, 'bearer')
    const me = object(await this.request(sourceId, '/v1/me', new AbortController().signal))
    const accountId = string(object(me.account).id)
    if (source.accountId && source.accountId !== accountId) {
      this.accounts.delete(sourceId)
      await this.http.disconnect?.(source)
      throw new Error('此凭证与配置账户不一致')
    }
    this.accounts.set(sourceId, accountId)
  }
  async publish(sourceId: string, document: Record<string, unknown>, digest: string, signal: AbortSignal) {
    const result = object(await this.request(sourceId, '/v1/packages', signal, document))
    if (result.hash !== digest) throw new Error('服务器发布内容的哈希与本地校验不一致')
    await this.list(this.source(sourceId), signal)
  }

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
    }).then(value => {
      signal.throwIfAborted()
      if (this.disposed) throw new Error('客户端已关闭')
      return value
    })
  }
  private game(value: unknown, packageHash: string, publisherId: string): Game {
    const m = object(value)
    const id = string(m.id)
    return {
      id,
      packageHash,
      publisherId,
      modes: array(m.modes) as Game['modes'],
      policies: Array.isArray(m.settlementPolicies) ? m.settlementPolicies as string[] : ['equal-winners-v1'],
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
    const pkg = this.packages.get(source.id)?.find(pkg => pkg.hash === r.packageHash)
    const game = this.game(r.manifest, string(r.packageHash), pkg ? string(pkg.publisherId) : '未知作者')
    return {
      id: string(r.id),
      sourceId: source.id,
      name: typeof config.roomName === 'string' ? config.roomName : game.name,
      game,
      owned: this.ownedRooms.get(source.id)?.has(string(r.id)) ?? false,
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
      economyId: r.economyIdentity && typeof r.economyIdentity === 'object'
        ? String(object(r.economyIdentity).instanceId)
        : undefined,
      review: r.reviewState === 'unreviewed' ? '作者自制 · 未审核' : String(r.reviewState),
      rules: `${game.description}\n包哈希：${string(r.packageHash)}\n每步时限 ${number(r.turnTimeoutMs) / 1000} 秒`,
      settlement: string(r.policy),
      compatible: true,
    }
  }
  async prepareSource(source: Source, signal: AbortSignal) {
    await this.http.prepare?.(source, signal)
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
    if (
      handshake.protocol !== 'game-room/1' || handshake.gamePackageVersion !== 1 || !Array.isArray(handshake.uiFormats)
      || !handshake.uiFormats.includes('scene-v1')
    ) {
      return {
        rooms: [],
        games: [],
        compatible: false,
        protocol: String(handshake.protocol),
        reason: '需要 game-room/1、GamePackage v1 与 scene-v1',
      }
    }
    this.economy.discover(source, handshake.economy)
    const [roomResponse, packageResponse] = await Promise.all([
      this.http.request({ source, path: '/v1/rooms', signal }),
      this.http.request({ source, path: '/v1/packages', signal }),
    ])
    signal.throwIfAborted()
    if (this.disposed) throw new Error('客户端已关闭')
    if (this.isConnected(source.id)) {
      const mine = object(await this.request(source.id, '/v1/me/rooms', signal))
      this.ownedRooms.set(source.id, new Set(array(mine.rooms).map(value => string(object(value).id))))
    }
    const packages = array(object(packageResponse).packages).map(object)
    this.packages.set(source.id, packages)
    for (const value of array(object(roomResponse).rooms)) {
      const card = object(value)
      this.cards.set(JSON.stringify([source.id, string(card.id)]), card)
    }
    return {
      rooms: array(object(roomResponse).rooms).map(room => this.room(room, source)),
      games: packages.map(pkg => this.game(pkg.manifest, string(pkg.hash), string(pkg.publisherId))),
      compatible: true,
      protocol: 'game-room/1',
    }
  }
  private async seat(sourceId: string, value: unknown): Promise<Seat> {
    const view = object(value)
    const room = this.room(view, this.source(sourceId))
    const key = JSON.stringify([sourceId, room.id])
    const previous = this.views.get(key)
    if (!previous || number(previous.version) <= number(view.version)) this.views.set(key, view)
    const observation = view.observation
    const self = array(view.seats).map(object).find(seat => seat.id === view.selfSeatId)
    return {
      room,
      seatId: string(view.selfSeatId),
      ready: self?.ready === true,
      consentRequired: self?.ready !== true,
      observation,
      scene: view.scene ?? null,
      sceneError: typeof view.sceneError === 'string' ? view.sceneError : null,
      matchId: typeof view.matchId === 'string' ? view.matchId : undefined,
      version: number(view.version),
      status: view.status as Seat['status'],
      canStart: view.creatorAccountId === (this.accounts.get(sourceId) ?? this.source(sourceId).accountId)
        && view.status === 'waiting' && array(view.seats).length >= number(object(view.manifest).minPlayers)
        && array(view.seats).map(object).every(seat => seat.ready === true),
      canNextMatch: view.creatorAccountId === (this.accounts.get(sourceId) ?? this.source(sourceId).accountId)
        && ['finished', 'aborted'].includes(String(view.status))
        && ['none', 'settled', 'refunded'].includes(String(view.settlement)),
      funding: view.funding as Seat['funding'],
      result: view.result,
      settlementState: String(view.settlement),
      ownedSeats: array(view.seats).map(object).filter(seat =>
        seat.accountId === (this.accounts.get(sourceId) ?? this.source(sourceId).accountId)
      ).map(
        seat => ({ id: string(seat.id), name: string(seat.name), kind: String(seat.kind) }),
      ),
      legalActions: observation && typeof observation === 'object' && !Array.isArray(observation)
        ? array(object(observation).legalActions ?? [])
        : [],
    }
  }
  async create(sourceId: string, draft: CreateRoom, signal: AbortSignal): Promise<Invitation> {
    const pkg = this.packages.get(sourceId)?.find(pkg => pkg.hash === draft.packageHash)
    if (!pkg) throw new Error('此来源玩法目录已变更，请刷新')
    if (draft.mode === 'token' && !draft.consentAccepted) throw new Error('请先确认固定包版本、审核说明与投入条款')
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
        stake: draft.mode === 'token' ? draft.stake : 0,
        policy: policies[0],
        ...(draft.mode === 'token'
          ? {
            consent: { packageHash: pkg.hash, stake: draft.stake, policy: policies[0], reviewState: pkg.reviewState },
          }
          : {}),
      }),
    )
    await this.seat(sourceId, view)
    return { sourceId, roomId: string(view.id) }
  }
  async join(invitation: Invitation, signal: AbortSignal) {
    const source = this.source(invitation.sourceId)
    if (invitation.sourceUrl && new URL(invitation.sourceUrl).origin !== new URL(source.url).origin) {
      throw new Error('邀请来源地址不匹配')
    }
    await this.list(source, signal)
    const key = JSON.stringify([source.id, invitation.roomId])
    const existing = this.views.get(key)
    if (existing && typeof existing.selfSeatId === 'string') {
      return this.seat(
        source.id,
        await this.request(source.id, `/v1/rooms/${encodeURIComponent(invitation.roomId)}`, signal),
      )
    }
    try {
      return await this.seat(
        source.id,
        await this.request(source.id, `/v1/rooms/${encodeURIComponent(invitation.roomId)}`, signal),
      )
    } catch (error) {
      if (!(error instanceof RequestFailure) || error.outcome !== 'rejected') throw error
    }
    const card = this.cards.get(key)
    if (!card) throw new Error('此来源没有该房间')
    if (card.mode === 'token') {
      this.views.set(key, card)
      return {
        room: this.room(card, source),
        seatId: '',
        ready: false,
        consentRequired: true,
        observation: null,
        legalActions: [],
        matchId: String(card.matchId),
        version: number(card.version),
        status: 'waiting' as const,
      }
    }
    return this.seat(
      source.id,
      await this.request(source.id, `/v1/rooms/${encodeURIComponent(invitation.roomId)}/join`, signal, {}),
    )
  }
  async ready(seat: Seat, consent: Consent, signal: AbortSignal) {
    const view = this.views.get(JSON.stringify([seat.room.sourceId, seat.room.id]))
    if (!view || consent.gameVersion !== object(view.manifest).version || consent.stake !== view.stake) {
      throw new Error('条款已变更，请重新查看房间')
    }
    if (
      consent.packageHash !== view.packageHash || consent.mode !== view.mode || consent.settlement !== view.policy
      || consent.review !== this.room(view, this.source(seat.room.sourceId)).review
    ) throw new Error('游戏包已变更，请重新确认')
    if (!seat.seatId) {
      await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/join`, signal, {
        consent: {
          packageHash: view.packageHash,
          stake: view.stake,
          policy: view.policy,
          reviewState: view.reviewState,
        },
      })
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
  async refreshSeat(seat: Seat, signal: AbortSignal) {
    return this.seat(
      seat.room.sourceId,
      await this.request(
        seat.room.sourceId,
        `/v1/rooms/${encodeURIComponent(seat.room.id)}?seatId=${encodeURIComponent(seat.seatId)}`,
        signal,
      ),
    )
  }
  async start(seat: Seat, signal: AbortSignal) {
    return this.seat(
      seat.room.sourceId,
      await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/start`, signal, {}),
    )
  }
  async nextMatch(seat: Seat, signal: AbortSignal) {
    return this.seat(
      seat.room.sourceId,
      await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/next-match`, signal, {}),
    )
  }
  private pendingActions = new Map<string, { expectedVersion: number; idempotencyKey: string; action: unknown }>()
  async act(seat: Seat, action: unknown, signal: AbortSignal) {
    if (seat.version === undefined || seat.status !== 'playing') throw new Error('当前席位不可操作')
    validateActionData(action)
    if (this.pendingActions.size > 100) throw new Error('有过多未确认动作，请先恢复连接')
    const key = JSON.stringify([seat.room.sourceId, seat.room.id, seat.seatId, seat.matchId, seat.version, action])
    const request = this.pendingActions.get(key)
      ?? { expectedVersion: seat.version, idempotencyKey: crypto.randomUUID(), action }
    this.pendingActions.set(key, request)
    try {
      const result = await this.seat(
        seat.room.sourceId,
        await this.request(
          seat.room.sourceId,
          `/v1/rooms/${encodeURIComponent(seat.room.id)}/actions`,
          signal,
          request,
        ),
      )
      this.pendingActions.delete(key)
      return result
    } catch (error) {
      if (error instanceof RequestFailure && error.outcome === 'rejected') this.pendingActions.delete(key)
      throw error
    }
  }
  async leave(seat: Seat, signal: AbortSignal) {
    if (!seat.seatId) return
    await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/leave`, signal, {})
    this.views.delete(JSON.stringify([seat.room.sourceId, seat.room.id]))
  }
  async agents(_signal: AbortSignal): Promise<Agent[]> {
    return this.agentController.agents()
  }
  async dispatches(_signal: AbortSignal): Promise<Dispatch[]> {
    return this.agentController.runs()
  }
  async dispatch(
    agent: string,
    invitation: Invitation,
    budget: number,
    signal: AbortSignal,
    consent?: Consent,
  ): Promise<Dispatch> {
    const snapshot = await this.list(this.source(invitation.sourceId), signal)
    const room = snapshot.rooms.find(room => room.id === invitation.roomId)
    if (!room) throw new Error('房间不存在')
    return this.agentController.dispatch(agent, invitation, room, budget, consent, signal)
  }
  async withdraw(dispatch: Dispatch, _signal: AbortSignal) {
    await this.agentController.withdraw(dispatch)
  }
  async balances(_signal: AbortSignal): Promise<Balance[]> {
    return this.economy.balances(_signal)
  }
  async connectEconomy(sourceId: string, signal: AbortSignal) {
    await this.economy.connect(sourceId, signal)
  }
  async linkEconomy(sourceId: string, signal: AbortSignal) {
    const me = object(await this.request(sourceId, '/v1/me', signal))
    const code = await this.economy.proof(sourceId, string(object(me.account).id), signal)
    await this.request(sourceId, '/v1/economy/link', signal, { code })
  }
  async quote(seat: Seat, signal: AbortSignal) {
    return this.economy.quote(seat, signal)
  }
  async reserve(seat: Seat, quote: FundingQuote, signal: AbortSignal) {
    await this.economy.reserve(seat, quote, signal)
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
    return Promise.all(
      array(response.events).map(async value => {
        const event = object(value)
        return {
          turn: number(event.version),
          description: string(event.kind),
          seat: await this.seat(record.sourceId, event.view),
        }
      }),
    )
  }
  async dispose() {
    this.disposed = true
    await this.agentController.dispose()
    await this.http.dispose()
    this.economy.dispose()
    this.pendingActions.clear()
    this.cards.clear()
    this.ownedRooms.clear()
    this.accounts.clear()
    this.views.clear()
    this.packages.clear()
  }
}
