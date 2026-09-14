import { GameWalletSpend } from './game-wallet-spend.js'
import type { WalletSpendV1 } from '@cordisx/protocol/wallet-spend/v1'
import { SourceAccountSessions } from './source-account-sessions.js'
import { SourceDisplayProfiles } from './source-display-profiles.js'
import { type WalletFactory, WalletLifecycle } from './wallet-lifecycle.js'
import type { CurrentUserState } from './current-user-sync.js'
import { gameParticipants } from './game-participants.js'
import { collectPanelResults } from './panel-results.js'
import { parseGameConfigSchema, validateGameConfig } from '../../../sdk/game-config.mjs'
import type {
  Agent,
  Balance,
  Consent,
  CreateRoom,
  Dispatch,
  Game,
  History,
  Invitation,
  PersonalProfile,
  Room,
  Seat,
  Source,
  SourceSnapshot,
} from './model.js'
import { normalizeSourceUrl } from './model.js'
import { ClientAgents } from './agents.js'
import type { AgentLoopProviderOptions, AgentProfile } from '@cordisx/game-room-agents'
import { validateActionData } from './actions.js'
import type { FundingQuote } from './economy.js'
import type { GameRoomPort } from './port.js'
import { array, type HttpTransport, number, object, RequestFailure, string } from './http.js'
export class LivePort implements GameRoomPort {
  readonly kind = 'live' as const
  private displays = new SourceDisplayProfiles()
  private displayUserSubject?: string
  setCurrentUser(state: CurrentUserState) {
    const subject = state.status === 'available' ? state.subject : undefined
    if (this.displayUserSubject && this.displayUserSubject !== subject && this.managedLocalAccounts) {
      this.sourceSessions.retire()
      this.http.retireSessions?.()
      for (const cache of [this.accounts, this.sessionKinds, this.ownedRooms, this.views, this.pendingActions]) {
        cache.clear()
      }
      this.wallet.invalidate()
    }
    this.displayUserSubject = subject
    this.displays.setCurrentUser(state)
  }
  private syncDisplayProfile(sourceId: string, signal: AbortSignal) {
    return this.displays.sync(
      this.source(sourceId),
      this.accounts.get(sourceId),
      signal,
      (payload, combined) => this.request(sourceId, '/v1/me/profile', combined, payload),
      this.sourceSessions.hasManagedBinding(sourceId) && this.sessionKinds.get(sourceId) === 'account',
    )
  }
  private disposed = false
  private targetedBotSources = new Set<string>()
  private botSources = new Set<string>()
  private wallet: WalletLifecycle
  private get economy() {
    return this.wallet.adapter
  }
  walletMode() {
    return this.wallet.mode
  }
  walletStatus() {
    return this.wallet.status
  }
  tokenStatus(sourceId: string) {
    if (!this.economy.supportsService(sourceId)) return 'source-unsupported' as const
    if (this.disposed || this.walletStatus() !== 'ready') return 'wallet-unavailable' as const
    return this.spend.supported() ? 'ready' as const : 'host-unavailable' as const
  }
  economyAvailable(sourceId: string) {
    return !this.disposed && this.economy.hasService(sourceId) && this.spend.supported()
  }
  invalidateWallet() {
    this.wallet.invalidate()
  }
  refreshWallet(signal: AbortSignal) {
    return this.wallet.refresh(signal)
  }
  private spend: GameWalletSpend
  setWalletSpend(capability?: WalletSpendV1, expected?: WalletSpendV1) {
    this.spend.setCapability(capability, expected)
  }
  private ownedRooms = new Map<string, Set<string>>()
  private sessionKinds = new Map<string, 'guest' | 'account'>()
  private guestSources = new Set<string>()
  private accounts = new Map<string, string>()
  private packages = new Map<string, Record<string, unknown>[]>()
  private cards = new Map<string, Record<string, unknown>>()
  private views = new Map<string, Record<string, unknown>>()
  private agentController: ClientAgents
  constructor(
    readonly sources: Source[],
    private http: HttpTransport,
    profiles: AgentProfile[] = [],
    walletFactory?: WalletFactory,
    private readonly managedLocalAccounts = false,
  ) {
    this.sourceSessions = new SourceAccountSessions(id => this.source(id), () => this.http, managedLocalAccounts)
    this.wallet = new WalletLifecycle(() => this.http, walletFactory)
    this.spend = new GameWalletSpend(
      (id, path, signal, body) => this.request(id, path, signal, body),
      id => this.accounts.get(id),
      id => this.source(id),
      id => this.economy.binding(id),
    )
    if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('来源服务器 ID 不可重复')
    for (const source of sources) normalizeSourceUrl(source.url)
    this.agentController = new ClientAgents(profiles, id => this.source(id), () => this.http)
  }
  capabilities() {
    return { account: !!(this.http.connect || this.http.connectAccount), agent: this.agentController.availability() }
  }
  configureAgents(options: AgentLoopProviderOptions) {
    this.agentController.configure(options)
  }
  setHttp(http: HttpTransport, expected?: HttpTransport) {
    if (this.disposed || (expected && this.http !== expected)) {
      void http.dispose()
      return
    }
    this.sourceSessions.retire()
    void this.http.dispose()
    this.wallet.reset()
    this.pendingActions.clear()
    this.ownedRooms.clear()
    this.accounts.clear()
    this.sessionKinds.clear()
    this.http = http
  }
  private sourceSessions: SourceAccountSessions
  usesCodexAccount(sourceId: string) {
    return this.sourceSessions.usesCodexAccount(sourceId)
  }
  private async loginManaged(source: Source, signal: AbortSignal) {
    const lease = this.sourceSessions.capture(source.id)
    let accountId: string
    try {
      accountId = await this.sourceSessions.login(source, signal)
    } catch (error) {
      if (!signal.aborted && this.sourceSessions.valid(source.id, lease)) this.sourceSessions.paused.add(source.id)
      throw error
    }
    if (this.disposed || !this.sourceSessions.valid(source.id, lease)) throw new Error('授权已被替换')
    this.displays.reset(source.id, accountId)
    this.ownedRooms.delete(source.id)
    this.accounts.set(source.id, accountId)
    this.sessionKinds.set(source.id, 'account')
    await this.syncDisplayProfile(source.id, signal)
  }
  allowsGuests(sourceId: string) {
    return this.guestSources.has(sourceId)
  }
  isConnected(sourceId: string) {
    return this.accounts.has(sourceId)
  }
  connectionKind(sourceId: string) {
    return this.sessionKinds.get(sourceId)
  }
  async disconnect(sourceId: string) {
    const epoch = this.sourceSessions.advance(sourceId)
    this.sourceSessions.paused.add(sourceId)
    try {
      await this.http.disconnect?.(this.source(sourceId))
    } finally {
      if (this.sourceSessions.epoch(sourceId) === epoch) {
        this.accounts.delete(sourceId)
        this.sessionKinds.delete(sourceId)
        this.ownedRooms.delete(sourceId)
        this.displays.reset(sourceId)
      }
    }
  }
  async connect(sourceId: string, mode?: 'account') {
    const epoch = this.sourceSessions.advance(sourceId)
    const source = this.source(sourceId)
    this.sourceSessions.paused.delete(sourceId)
    if (this.usesCodexAccount(sourceId)) {
      await this.loginManaged(source, new AbortController().signal)
      return
    }
    if (mode === 'account' && this.guestSources.has(sourceId)) {
      throw new Error('此来源支持免密钥访客连接；账户登录不能使用服务器访问令牌代替')
    }
    if (mode !== 'account' && await this.restoreSession(source, new AbortController().signal)) return
    if (mode !== 'account' && !this.guestSources.has(sourceId)) {
      throw new Error('尚未登录此游戏服务器；此服务器暂未接入 Codex 自动登录。')
    }
    if (!this.http.connect) throw new Error('此 Host 尚不支持安全账户连接')
    const guest = mode !== 'account' && this.guestSources.has(sourceId)
    if (guest) {
      if (!this.http.connectGuest) throw new Error('当前 Host 不支持访客连接')
      await this.http.connectGuest(source, new AbortController().signal)
    } else await this.http.connect(source, 'bearer')
    const me = object(await this.request(sourceId, '/v1/me', new AbortController().signal))
    if (this.sourceSessions.epoch(sourceId) !== epoch) throw new Error('授权已被替换')
    const accountId = string(object(me.account).id)
    if (!guest && source.accountId && source.accountId !== accountId) {
      this.accounts.delete(sourceId)
      await this.http.disconnect?.(source)
      throw new Error('此凭证与配置账户不一致')
    }
    this.ownedRooms.delete(sourceId)
    this.sessionKinds.set(sourceId, guest ? 'guest' : 'account')
    this.accounts.set(sourceId, accountId)
    await this.syncDisplayProfile(sourceId, new AbortController().signal)
  }
  private async restoreSession(source: Source, signal: AbortSignal) {
    if (this.sourceSessions.paused.has(source.id)) return false
    const value = await this.http.restoreSession?.(source, signal)
    signal.throwIfAborted()
    if (this.disposed) throw new Error('客户端已关闭')
    if (value === undefined) return false
    const account = object(object(value).account)
    const accountId = string(account.id)
    const guest = account.guest === true
    if (!guest && source.accountId && source.accountId !== accountId) throw new Error('此凭证与配置账户不一致')
    this.accounts.set(source.id, accountId)
    this.sessionKinds.set(source.id, guest ? 'guest' : 'account')
    return true
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
    const lease = this.sourceSessions.capture(sourceId)
    return this.http.request({
      source: this.source(sourceId),
      path,
      signal,
      authenticated: true,
      ...(body === undefined ? {} : { method: 'POST', body }),
    }).then(value => {
      signal.throwIfAborted()
      if (this.disposed) throw new Error('客户端已关闭')
      if (!this.sourceSessions.valid(sourceId, lease)) throw new Error('授权已被替换')
      return value
    }).catch(error => {
      if (this.sourceSessions.valid(sourceId, lease)) this.retireRejectedAccount(sourceId, error)
      throw error
    })
  }
  private retireRejectedAccount(sourceId: string, error: unknown) {
    if (
      !(error instanceof RequestFailure) || error.outcome !== 'rejected'
      || !['invalid_session', 'authentication_required', 'session_unavailable', 'session_identity_changed'].includes(
        error.code,
      )
    ) return
    this.accounts.delete(sourceId)
    this.sessionKinds.delete(sourceId)
    this.ownedRooms.delete(sourceId)
    this.displays.reset(sourceId)
    if (error.code === 'session_unavailable' || error.code === 'session_identity_changed') {
      this.sourceSessions.paused.add(sourceId)
    }
  }
  private discovery(source: Source, path: string, signal: AbortSignal) {
    const lease = this.sourceSessions.capture(source.id)
    return this.http.request({ source, path, signal }).catch(error => {
      if (this.sourceSessions.valid(source.id, lease)) this.retireRejectedAccount(source.id, error)
      throw error
    })
  }
  private game(value: unknown, packageHash: string, publisherId: string, bots = false): Game {
    const m = object(value)
    const id = string(m.id)
    return {
      id,
      packageHash,
      publisherId,
      spectating: m.spectating === true,
      waitingUi: m.waitingUi === true,
      rulesBot: bots && m.rulesBot === 'rules-bot-v1',
      minPlayers: m.minPlayers === undefined ? undefined : number(m.minPlayers),
      maxPlayers: m.maxPlayers === undefined ? undefined : number(m.maxPlayers),
      ...(m.minimumViewport === undefined
        ? {}
        : {
          minimumViewport: {
            width: number(object(m.minimumViewport).width),
            height: number(object(m.minimumViewport).height),
          },
        }),
      modes: array(m.modes) as Game['modes'],
      policies: Array.isArray(m.settlementPolicies) ? m.settlementPolicies as string[] : ['equal-winners-v1'],
      name: string(m.name),
      version: string(m.version),
      icon: id.includes('gomoku') ? '◉' : '♠',
      ...(m.configSchema === undefined ? {} : { configSchema: parseGameConfigSchema(m.configSchema) }),
      description: typeof m.description === 'string' ? m.description : '',
    }
  }
  private room(value: unknown, source: Source): Room {
    const r = object(value)
    if (r.serverId !== source.id) throw new Error('房间身份与来源不一致')
    const config = object(r.config)
    const seats = array(r.seats).map(object)
    const pkg = this.packages.get(source.id)?.find(pkg => pkg.hash === r.packageHash)
    const game = this.game(
      r.manifest,
      string(r.packageHash),
      pkg ? string(pkg.publisherId) : '未知作者',
      this.botSources.has(source.id),
    )
    return {
      id: string(r.id),
      sourceId: source.id,
      name: typeof config.roomName === 'string' ? config.roomName : game.name,
      game,
      owned: this.ownedRooms.get(source.id)?.has(string(r.id)) ?? false,
      participants: gameParticipants(r).map((p, ordinal) => ({
        ...p,
        id: string(seats[ordinal]?.id),
        ready: seats[ordinal]?.ready === true,
      })),
      canManageBots: this.targetedBotSources.has(source.id) && r.status === 'waiting'
        && r.creatorAccountId === this.accounts.get(source.id),
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
      rules: `${game.description}\n每步时限 ${number(r.turnTimeoutMs) / 1000} 秒`,
      settlement: string(r.policy),
      compatible: true,
    }
  }
  async gameUi(room: Room, signal: AbortSignal) {
    return this.gameUiPackage(room.sourceId, room.game.packageHash, signal)
  }
  async gameUiPackage(sourceId: string, packageHash: string, signal: AbortSignal) {
    const source = this.source(sourceId)
    const meta = object(
      await this.http.request({
        source,
        path: `/v1/packages/${packageHash}`,
        authenticated: false,
        signal,
      }),
    )
    const bundle = await this.http.request({
      source,
      path: `/v1/packages/${packageHash}/ui`,
      authenticated: false,
      signal,
    })
    if (meta.hash !== packageHash) throw new Error('游戏包身份不匹配')
    return { bundle, digest: string(meta.uiSha256) }
  }
  async spectate(room: Room, signal: AbortSignal) {
    const source = this.source(room.sourceId)
    const value = object(
      await this.http.request({
        source,
        path: `/v1/rooms/${encodeURIComponent(room.id)}/spectate`,
        authenticated: !this.guestSources.has(source.id),
        signal,
      }),
    )
    // Existing game-room/1 servers expose owner identity in public room cards.
    // Match the observation revision rather than mixing metadata from another round.
    const listing = object(await this.http.request({ source, path: '/v1/rooms', authenticated: false, signal }))
    const card = array(listing.rooms).map(object).find(card =>
      card.id === room.id
      && card.matchId === value.matchId && card.version === value.version
    )
    if (!card) throw new Error('房间已更新，正在恢复观战')
    return {
      matchId: string(value.matchId),
      version: number(value.version),
      status: string(value.status),
      participants: gameParticipants(card),
      observation: value.observation ?? null,
      scene: value.scene ?? null,
    }
  }
  async prepareSource(source: Source, signal: AbortSignal) {
    await this.http.prepare?.(source, signal)
    // Wallet source approval belongs to explicit connectEconomy, not lobby discovery.
  }
  async list(source: Source, signal: AbortSignal): Promise<SourceSnapshot> {
    if (this.disposed) throw new Error('客户端已关闭')
    const [discovery] = await Promise.all([
      this.discovery(source, '/v1/handshake', signal),
      this.refreshWallet(signal).catch(() => signal.throwIfAborted()),
    ])
    const handshake = object(discovery)
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
    if (Array.isArray(handshake.rulesBots) && handshake.rulesBots.includes('rules-bot-v1')) {
      this.botSources.add(source.id)
    } else this.botSources.delete(source.id)
    if (Array.isArray(handshake.seatManagement) && handshake.seatManagement.includes('targeted-bot-seats-v1')) {
      this.targetedBotSources.add(source.id)
    } else this.targetedBotSources.delete(source.id)
    if (Array.isArray(handshake.displayProfiles) && handshake.displayProfiles.includes('self-display-profile-v1')) {
      this.displays.supported.add(source.id)
    } else this.displays.supported.delete(source.id)
    if (handshake.access && object(handshake.access).guests === true) this.guestSources.add(source.id)
    else this.guestSources.delete(source.id)
    this.sourceSessions.discover(source, handshake.managedAccount)
    this.economy.discover(source, handshake.walletSpend)
    if (!this.isConnected(source.id) && !this.sourceSessions.paused.has(source.id)) {
      if (this.usesCodexAccount(source.id)) await this.loginManaged(source, signal)
      else await this.restoreSession(source, signal)
    }
    const [roomResponse, packageResponse, mine] = await Promise.all([
      this.syncDisplayProfile(source.id, signal).then(() => this.discovery(source, '/v1/rooms', signal)),
      this.discovery(source, '/v1/packages', signal),
      this.isConnected(source.id) ? this.request(source.id, '/v1/me/rooms', signal) : undefined,
    ])
    signal.throwIfAborted()
    if (this.disposed) throw new Error('客户端已关闭')
    if (mine) {
      this.ownedRooms.set(source.id, new Set(array(object(mine).rooms).map(value => string(object(value).id))))
    }
    const packages = array(object(packageResponse).packages).map(object)
    this.packages.set(source.id, packages)
    for (const value of array(object(roomResponse).rooms)) {
      const card = object(value)
      this.cards.set(JSON.stringify([source.id, string(card.id)]), card)
    }
    return {
      rooms: array(object(roomResponse).rooms).map(room => this.room(room, source)),
      games: packages.map(pkg =>
        this.game(pkg.manifest, string(pkg.hash), string(pkg.publisherId), this.botSources.has(source.id))
      ),
      compatible: true,
      guestAccess: this.guestSources.has(source.id),
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
      closed: view.closedAt !== undefined,
      canCloseRoom: view.closedAt === undefined
        && view.creatorAccountId === (this.accounts.get(sourceId) ?? this.source(sourceId).accountId),
      canManageBots: view.status === 'waiting'
        && view.creatorAccountId === (this.accounts.get(sourceId) ?? this.source(sourceId).accountId),
      gameParticipants: gameParticipants(view),
      participants: array(view.seats).map(object).map(s => ({
        id: string(s.id),
        name: string(s.name),
        kind: string(s.kind),
        ready: s.ready === true,
      })),
      canStart: view.creatorAccountId === (this.accounts.get(sourceId) ?? this.source(sourceId).accountId)
        && view.status === 'waiting' && array(view.seats).length >= number(object(view.manifest).minPlayers)
        && array(view.seats).map(object).every(seat => seat.ready === true),
      canNextMatch: view.closedAt === undefined
        && view.creatorAccountId === (this.accounts.get(sourceId) ?? this.source(sourceId).accountId)
        && ['finished', 'aborted'].includes(String(view.status))
        && ['none', 'settled', 'refunded'].includes(String(view.settlement)),
      funding: view.funding as Seat['funding'],
      walletSpend: view.walletSpend as Seat['walletSpend'],
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
    if (draft.botCount && !this.botSources.has(sourceId)) throw new Error('此服务器尚未支持规则电脑')
    const manifest = object(pkg.manifest)
    const policies = Array.isArray(manifest.settlementPolicies) ? manifest.settlementPolicies : ['equal-winners-v1']
    const view = object(
      await this.request(sourceId, '/v1/rooms', signal, {
        packageHash: string(pkg.hash),
        mode: draft.mode,
        config: {
          ...(manifest.configSchema
            ? validateGameConfig(parseGameConfigSchema(manifest.configSchema), draft.config)
            : {}),
          roomName: draft.name,
        },
        maxPlayers: draft.maxPlayers === undefined ? manifest.maxPlayers : draft.maxPlayers,
        botCount: draft.botCount ?? 0,
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
  async createAndJoin(sourceId: string, draft: CreateRoom, signal: AbortSignal): Promise<Seat> {
    const invitation = await this.create(sourceId, draft, signal)
    signal.throwIfAborted()
    // Creation already seats the owner and returns the authenticated RoomView.
    // Do not block entry on a second lobby/catalog/wallet refresh.
    const view = this.views.get(JSON.stringify([sourceId, invitation.roomId]))
    if (!view) throw new Error('房间已创建，请从大厅返回房间')
    return this.seat(sourceId, view)
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
        observation: {
          phase: 'waiting',
          selfSeat: null,
          config: card.config,
          capacity: card.maxPlayers,
          minPlayers: object(card.manifest).minPlayers,
          participants: array(card.seats).map(object).map((s, seat) => ({
            seat,
            name: s.name,
            kind: s.kind,
            ready: s.ready,
          })),
          legalActions: [],
        },
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
  async ready(seat: Seat, ready: boolean, consent: Consent | undefined, signal: AbortSignal) {
    const view = this.views.get(JSON.stringify([seat.room.sourceId, seat.room.id]))
    if (
      !view
      || (ready && (!consent || consent.gameVersion !== object(view.manifest).version || consent.stake !== view.stake))
    ) {
      throw new Error('条款已变更，请重新查看房间')
    }
    if (
      ready && consent && (
        consent.packageHash !== view.packageHash || consent.mode !== view.mode || consent.settlement !== view.policy
        || consent.review !== this.room(view, this.source(seat.room.sourceId)).review
      )
    ) throw new Error('游戏包已变更，请重新确认')
    if (ready && !seat.seatId) {
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
        ready,
        ...(ready
          ? {
            consent: {
              packageHash: view.packageHash,
              stake: view.stake,
              policy: view.policy,
              reviewState: view.reviewState,
            },
          }
          : {}),
      }),
    )
  }
  async refreshSeat(seat: Seat, signal: AbortSignal) {
    await this.spend.recover(seat.room.sourceId, signal)
    return this.seat(
      seat.room.sourceId,
      await this.request(
        seat.room.sourceId,
        `/v1/rooms/${encodeURIComponent(seat.room.id)}?seatId=${encodeURIComponent(seat.seatId)}`,
        signal,
      ),
    )
  }
  async roomBots(room: Room, change: { add: true; seatIndex: number } | { removeSeatId: string }, signal: AbortSignal) {
    if (!this.targetedBotSources.has(room.sourceId)) throw new Error('此来源尚不支持指定席位电脑管理')
    return this.seat(
      room.sourceId,
      await this.request(room.sourceId, `/v1/rooms/${encodeURIComponent(room.id)}/bots`, signal, change),
    )
  }
  async bots(seat: Seat, change: { add: true; seatIndex: number } | { removeSeatId: string }, signal: AbortSignal) {
    return this.seat(
      seat.room.sourceId,
      await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/bots`, signal, change),
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
      await this.spend.recover(seat.room.sourceId, signal)
      return result
    } catch (error) {
      if (error instanceof RequestFailure && error.outcome === 'rejected') this.pendingActions.delete(key)
      throw error
    }
  }
  async closeRoom(seat: Seat, signal: AbortSignal) {
    await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/close`, signal, {})
    await this.spend.recover(seat.room.sourceId, signal)
    this.views.delete(JSON.stringify([seat.room.sourceId, seat.room.id]))
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
  ledger(signal: AbortSignal) {
    return this.economy.ledger(signal)
  }
  async personalProfiles(signal: AbortSignal): Promise<PersonalProfile[]> {
    const sources = this.sources.filter(source => source.enabled)
    const results = await Promise.allSettled(sources.map(async source => {
      if (!this.isConnected(source.id) && !await this.restoreSession(source, signal)) {
        return [{ sourceId: source.id, state: 'disconnected' as const }]
      }
      const account = object(object(await this.request(source.id, '/v1/me', signal)).account)
      const accountId = string(account.id)
      if (accountId !== this.accounts.get(source.id)) throw new Error('游戏账户身份发生变化，请重新读取来源')
      const displayName = typeof account.displayName === 'string' && account.displayName.trim()
        ? account.displayName.trim().slice(0, 128)
        : account.guest === true
        ? '访客玩家'
        : typeof account.name === 'string'
        ? account.name.slice(0, 128)
        : '游戏玩家'
      const avatar = gameParticipants({ seats: [{ avatar: account.avatar }] })[0]?.avatar
      return [{
        sourceId: source.id,
        state: 'connected' as const,
        accountId,
        displayName,
        ...(avatar ? { avatar } : {}),
        guest: account.guest === true,
        economyAvailable: this.economyAvailable(source.id),
      }]
    }))
    signal.throwIfAborted()
    return collectPanelResults<PersonalProfile>(results, sources.map(source => source.name))
  }
  async balances(_signal: AbortSignal): Promise<Balance[]> {
    if (this.disposed) throw new Error('客户端已关闭')
    return this.economy.balances(_signal)
  }
  async economyLinked(sourceId: string, signal: AbortSignal) {
    if (!this.isConnected(sourceId) || !this.economy.hasService(sourceId)) return false
    return this.spend.linked(sourceId, signal)
  }
  async connectEconomy(sourceId: string, signal: AbortSignal) {
    await this.refreshWallet(signal)
    await this.spend.authorize(sourceId, signal)
    await this.spend.recover(sourceId, signal)
  }
  async linkEconomy(sourceId: string, signal: AbortSignal) {
    await this.spend.bind(sourceId, signal)
  }
  async quote(seat: Seat, signal: AbortSignal): Promise<FundingQuote> {
    return this.spend.quote(seat, signal)
  }
  async reserve(seat: Seat, quote: FundingQuote, signal: AbortSignal) {
    await this.spend.reserve(seat, quote, signal)
    await this.refreshWallet(signal)
  }
  async history(signal: AbortSignal): Promise<History[]> {
    const results = await Promise.allSettled(
      this.sources.filter(source => source.enabled).map(async source => {
        if (!this.isConnected(source.id) && this.http.restoreSession && !await this.restoreSession(source, signal)) {
          return []
        }
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
    signal.throwIfAborted()
    return collectPanelResults(results, this.sources.filter(source => source.enabled).map(source => source.name))
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
    this.sourceSessions.retire()
    this.spend.setCapability(undefined)
    this.wallet.dispose()
    this.displays.dispose()
    await this.agentController.dispose()
    await this.http.dispose()
    this.pendingActions.clear()
    this.cards.clear()
    this.ownedRooms.clear()
    this.accounts.clear()
    this.sessionKinds.clear()
    this.views.clear()
    this.packages.clear()
  }
}
