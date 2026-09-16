import { canResumeGomoku, resumedPosition, undoPackage } from './gomoku-resume.js'
import { GameSpend, type GameSpendRecord } from './game-spend.js'
import { DisplayProfiles } from './display-profile.js'
import { allocateSeat, orderSeats } from './seat-positions.js'
import { waitingObservation } from './waiting.js'
import { validateGameConfig } from '../sdk/game-config.mjs'
import { parseScene, type Scene } from '../sdk/scene.js'
import { randomBytes } from 'node:crypto'
import type {
  ActionRequest,
  Consent,
  CreateRoomRequest,
  EconomyIdentity,
  Json,
  RoomCard,
  RoomView,
  SceneError,
  Transition,
} from '../sdk/index.js'
import type { Account } from './accounts.js'
import { digest } from './accounts.js'
import { ApiError, canonical, integer, object, requireThat } from './errors.js'
import type { GameStore as Store } from './store-contract.js'
import { Packages } from './packages.js'
import { invoke, invokeUi, transition } from './runner.js'
import { addRulesBots, runRulesBot } from './rules-bots.js'
import { historicalTokenRoom, writableRoom } from './legacy-transactions.js'
import { type EconomyAdapter, type FundingTerms } from './economy.js'
export interface Room extends RoomCard {
  cashouts?: (number | null)[]
  departedSeatIds?: string[]
  state: Json
  seed: string
  cursor: number
  observations: Record<string, Json>
  scenes: Record<string, Scene | null>
  sceneErrors: Record<string, SceneError | null>
  economyAccounts: Record<string, string>
  economyTerms: FundingTerms | null
  economyOp: 'create' | 'settle' | 'cancel' | null
  fundingDeadline: number | null
  matchDeadline: number | null
}
interface Command {
  digest: string
  response: string
}
export class Engine {
  private disposed = false
  dispose() {
    this.disposed = true
  }
  get isDisposed() {
    return this.disposed
  }
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    readonly store: Store,
    readonly packages: Packages,
    _retiredEconomy?: EconomyAdapter,
    readonly now = Date.now,
    readonly spend?: GameSpend,
  ) {}
  async serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn)
    this.queue = next.catch(() => {})
    return next
  }
  async load(id: string): Promise<Room> {
    const row = await this.store.db.prepare('SELECT body FROM rooms WHERE id=?').get(id) as {
      body: string
    } | undefined
    requireThat(row, 'room_not_found', 404)
    return JSON.parse(row.body)
  }
  async all(): Promise<Room[]> {
    return (await this.store.db.prepare('SELECT body FROM rooms').all() as {
      body: string
    }[]).map(r => JSON.parse(r.body))
  }
  async card(room: Room): Promise<RoomCard> {
    const {
      id,
      matchId,
      handNo,
      serverId,
      packageHash,
      manifest,
      mode,
      config,
      maxPlayers,
      allowAgents,
      turnTimeoutMs,
      stake,
      policy,
      reviewState,
      status,
      version,
      seats,
      turn,
      deadline,
      result,
      settlement,
      funding,
      economyIdentity,
    } = room
    return structuredClone({
      creatorAccountId: room.creatorAccountId,
      ...(room.closedAt !== undefined ? { closedAt: room.closedAt } : {}),
      id,
      matchId,
      handNo,
      serverId,
      packageHash,
      manifest,
      mode,
      config,
      maxPlayers,
      allowAgents,
      turnTimeoutMs,
      stake,
      policy,
      reviewState,
      status,
      version,
      seats: await Promise.all(seats.map(async (seat) => {
        if (seat.kind !== 'human') {
          return seat
        }
        const profile = await new DisplayProfiles(this.store).read(seat.accountId)
        return {
          ...seat,
          ...(profile.displayName ? { name: profile.displayName } : {}),
          ...(profile.avatar ? { avatar: profile.avatar } : {}),
        }
      })),
      turn,
      deadline,
      result,
      settlement,
      funding,
      economyIdentity,
      ...(room.walletSpend ? { walletSpend: { ...room.walletSpend, termsHash: null, acceptBefore: null } } : {}),
    })
  }
  seat(room: Room, accountId: string, seatId?: string) {
    const i = room.seats.findIndex(s => s.accountId === accountId && (seatId ? s.id === seatId : s.kind === 'human'))
    const selected = i >= 0 ? i : seatId ? -1 : room.seats.findIndex(s => s.accountId === accountId)
    requireThat(selected >= 0, 'not_a_member', 403)
    return selected
  }
  async view(room: Room, accountId: string, seatId?: string): Promise<RoomView> {
    const i = this.seat(room, accountId, seatId)
    return {
      ...await this.card(room),
      selfSeatId: room.seats[i].id,
      observation: room.status === 'waiting' || room.status === 'funding'
        ? waitingObservation(room, i)
        : structuredClone(room.observations[room.seats[i].id] ?? null),
      scene: structuredClone(room.scenes?.[room.seats[i].id] ?? null),
      sceneError: room.sceneErrors?.[room.seats[i].id] ?? null,
    }
  }
  async list(accountId?: string) {
    return await Promise.all(
      (await this.all()).filter(r =>
        accountId
          ? r.seats.some(s => s.accountId === accountId && !r.departedSeatIds?.includes(s.id))
          : r.closedAt === undefined
      ).map(async (r) => await this.card(r)),
    )
  }
  private consent(room: Room, consent: Consent | undefined) {
    if (room.mode === 'token') {
      requireThat(
        consent && consent.packageHash === room.packageHash && consent.stake === room.stake
          && consent.policy === room.policy && consent.reviewState === room.reviewState,
        'consent_required',
        400,
      )
    }
  }
  private async observations(room: Room) {
    if (room.status === 'waiting' || room.status === 'funding' || (room.status === 'aborted' && room.state === null)) {
      return
    }
    room.scenes ??= {}
    room.sceneErrors ??= {}
    for (let i = 0; i < room.seats.length; i++) {
      const seatId = room.seats[i].id
      room.scenes[seatId] = null
      room.sceneErrors[seatId] = null
      try {
        room.observations[room.seats[i].id] = (await this.run(room, 'observe', [room.state, i], i)).value
      } catch {
        room.observations[seatId] = null
        this.abort(room, 'observation_failed')
        return
      }
      let rendered: Json
      try {
        const ui = (await this.packages.get(room.packageHash)).ui
        if (ui.format === 'html-v1') {
          continue
        }
        requireThat(ui.format === 'scene-v1', 'unsupported_ui_format')
        rendered = (await invokeUi({
          render: ui.render,
          observation: room.observations[seatId],
          context: {
            seatIndex: i,
            seatCount: room.seats.length,
            mode: room.mode === 'token' ? 'local-chips' : room.mode,
            canAct: room.status === 'playing' && room.turn === i,
          },
        })).value
      } catch {
        this.abort(room, 'ui_render_failed')
        return
      }
      try {
        room.scenes[seatId] = parseScene(rendered)
      } catch {
        this.abort(room, 'ui_scene_invalid')
        return
      }
    }
  }
  private async save(
    room: Room,
    expected: number | null,
    kind: string,
    command?: {
      accountId: string
      seatId: string
      key: string
      digest: string
      response?: RoomView
    },
    extra?: () => Promise<void>,
    spendRecord?: GameSpendRecord,
  ): Promise<Room> {
    // Author projections run before committing a rule transition and before any
    // settlement can be dispatched. Economic acknowledgements reuse that projection
    // instead of running author code after an irreversible money operation.
    if (
      ['started', 'funded', 'action', 'timeout', 'player_exit'].includes(kind)
      && ['playing', 'finished'].includes(room.status)
    ) {
      await this.observations(room)
    }
    if (room.walletSpend && room.walletSpend.termsHash && this.spend) {
      spendRecord ??= await this.spend.load(room.matchId)
      if (['finished', 'aborted'].includes(room.status) && !spendRecord.decision) {
        await this.spend.final(spendRecord, room.status === 'finished' ? 'capture' : 'refund', room)
      }
      if (room.status === 'playing') await this.spend.checkpoint(spendRecord, room)
      room.walletSpend.phase = spendRecord.phase
      room.settlement = spendRecord.phase === 'capture'
        ? 'settled'
        : spendRecord.phase === 'refund'
        ? 'refunded'
        : spendRecord.phase === 'active'
        ? 'reserved'
        : 'pending'
    }
    await this.store.atomic(async () => {
      if (expected !== null) {
        requireThat((await this.load(room.id)).version === expected, 'version_conflict', 409)
      }
      await this.store.db.prepare('INSERT INTO rooms VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
        .run(room.id, JSON.stringify(room))
      const views = Object.fromEntries(
        await Promise.all(room.seats.map(async (s) => [s.id, await this.view(room, s.accountId, s.id)])),
      )
      await this.store.db.prepare('INSERT INTO events VALUES (?,?,?)').run(
        room.id,
        room.version,
        JSON.stringify({ version: room.version, kind, at: this.now(), views }),
      )
      if (command) {
        command.response = views[command.seatId] as RoomView
        await this.store.db.prepare('INSERT INTO commands VALUES (?,?,?,?,?)').run(
          room.id,
          command.seatId,
          command.key,
          command.digest,
          JSON.stringify(command.response),
        )
      }
      if (spendRecord) await this.spend!.write(room.id, spendRecord)
      await extra?.()
    })
    return room
  }
  private addSeat(room: Room, account: Account) {
    const seatIndex = allocateSeat(room.seats, room.maxPlayers)
    const seat: Room['seats'][number] = {
      seatIndex,
      id: this.store.id('seat'),
      kind: 'human',
      participantId: null,
      accountId: account.id,
      name: account.name,
      ready: false,
    }
    room.seats.push(seat)
    orderSeats(room.seats)
    return seat
  }
  async economyIdentity(): Promise<EconomyIdentity | null> {
    const row = await this.store.db.prepare('SELECT value FROM meta WHERE key=?').get('economyIdentity') as {
      value: string
    } | undefined
    return row ? JSON.parse(row.value) : null
  }
  async create(account: Account, input: CreateRoomRequest) {
    object(input)
    const pkg = await this.packages.get(input.packageHash)
    let config = input.config ?? {}
    if (pkg.manifest.configSchema) {
      object(config)
      const { roomName, ...gameConfig } = config
      requireThat(roomName === undefined || typeof roomName === 'string' && roomName.length <= 100, 'invalid_room_name')
      try {
        config = {
          ...validateGameConfig(pkg.manifest.configSchema, gameConfig),
          ...(roomName === undefined ? {} : { roomName }),
        }
      } catch {
        requireThat(false, 'invalid_game_config')
      }
    }
    requireThat(pkg.manifest.modes.includes(input.mode), 'unsupported_mode')
    const maxPlayers = input.maxPlayers === undefined ? pkg.manifest.maxPlayers : input.maxPlayers
    requireThat(integer(maxPlayers, pkg.manifest.minPlayers, pkg.manifest.maxPlayers), 'invalid_max_players')
    const timeout = input.turnTimeoutMs ?? 60000
    requireThat(integer(timeout, 1000, 3600000))
    requireThat(input.mode !== 'token' || !input.botCount, 'token_bot_unfunded', 409)
    const stake = input.stake ?? 0
    requireThat(integer(stake, input.mode === 'token' ? 1 : 0, 1000000))
    requireThat(input.mode === 'token' || stake === 0, 'stake_not_allowed')
    const policy = input.policy ?? pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1'
    requireThat((pkg.manifest.settlementPolicies ?? ['equal-winners-v1']).includes(policy), 'unsupported_policy')
    requireThat(input.allowAgents === undefined || typeof input.allowAgents === 'boolean')
    requireThat(input.mode !== 'token' || this.spend, 'wallet_spend_unavailable', 503)
    if (input.mode === 'token') {
      await this.spend!.service.pin(this.store)
      await this.spend!.requirePoolWallet(account.id)
    }
    requireThat(JSON.stringify(input.config ?? {}).length <= 16384, 'config_too_large')
    const room: Room = {
      id: this.store.id('room'),
      creatorAccountId: account.id,
      matchId: this.store.id('match'),
      handNo: 1,
      serverId: this.store.serverId,
      packageHash: input.packageHash,
      manifest: pkg.manifest,
      mode: input.mode,
      config,
      maxPlayers,
      allowAgents: input.allowAgents ?? false,
      turnTimeoutMs: timeout,
      stake,
      policy,
      reviewState: 'unreviewed',
      status: 'waiting',
      version: 0,
      seats: [],
      turn: null,
      deadline: null,
      result: null,
      settlement: 'none',
      ...(input.mode === 'token'
        ? {
          walletSpend: {
            protocol: 'economy.pool/v1' as const,
            termsHash: null,
            acceptBefore: null,
            phase: 'waiting' as const,
          },
        }
        : {}),
      funding: null,
      economyIdentity: null,
      state: null,
      seed: randomBytes(32).toString('hex'),
      cursor: 0,
      observations: {},
      scenes: {},
      sceneErrors: {},
      economyAccounts: {},
      economyTerms: null,
      economyOp: null,
      fundingDeadline: null,
      matchDeadline: null,
    }
    this.consent(room, input.consent)
    this.addSeat(room, account)
    // Creation already acknowledged these exact terms; funding authorization remains separate.
    room.seats[0].ready = true
    await addRulesBots(this, room, input.botCount ?? 0)
    return await this.view(await this.save(room, null, 'created'), account.id)
  }
  async join(account: Account, id: string, consent?: Consent) {
    const room = writableRoom(await this.load(id))
    if (room.seats.some(s => s.accountId === account.id && s.kind === 'human')) {
      return await this.view(room, account.id)
    }
    requireThat(room.status === 'waiting', 'room_started', 409)
    requireThat(room.seats.length < room.maxPlayers, 'room_full', 409)
    if (room.mode === 'token') await this.spend!.requirePoolWallet(account.id)
    this.consent(room, consent)
    this.addSeat(room, account)
    const old = room.version++
    return await this.view(await this.save(room, old, 'joined'), account.id)
  }
  async bots(account: Account, id: string, input: Record<string, unknown>) {
    const room = writableRoom(await this.load(id))
    requireThat(room.creatorAccountId === account.id, 'creator_required', 403)
    requireThat(room.status === 'waiting', 'room_started', 409)
    const old = room.version++
    if (input.removeSeatId !== undefined) {
      const index = room.seats.findIndex(s => s.id === input.removeSeatId && s.kind === 'bot')
      requireThat(index >= 0, 'bot_not_found', 404)
      room.seats.splice(index, 1)
    } else {
      requireThat(input.add === true, 'invalid_bot_command')
      await addRulesBots(this, room, 1, input.seatIndex)
    }
    return await this.view(await this.save(room, old, 'bots_changed'), account.id)
  }
  async agentSeat(account: Account, id: string, input: Record<string, unknown>) {
    const room = writableRoom(await this.load(id))
    requireThat(room.status === 'waiting', 'room_started', 409)
    requireThat(room.allowAgents, 'agents_not_allowed', 403)
    requireThat(typeof input.participantId === 'string' && /^[a-zA-Z0-9_:-]{1,128}$/.test(input.participantId))
    requireThat(typeof input.name === 'string' && input.name.length > 0 && input.name.length <= 80)
    const prior = room.seats.find(s =>
      s.accountId === account.id && s.participantId === input.participantId && s.kind === 'agent'
    )
    if (prior) {
      return { seat: prior, view: await this.view(room, account.id, prior.id) }
    }
    requireThat(room.seats.length < room.maxPlayers, 'room_full', 409)
    this.consent(room, input.consent as Consent | undefined)
    if (room.mode === 'token') await this.spend!.requirePoolWallet(account.id)
    const seat = this.addSeat(room, account)
    seat.kind = 'agent'
    seat.participantId = input.participantId
    seat.name = input.name
    const old = room.version++
    await this.save(room, old, 'agent_joined')
    return { seat, view: await this.view(room, account.id, seat.id) }
  }
  async resumeUndo(account: Account, id: string, expectedVersion: unknown) {
    const room = writableRoom(await this.load(id))
    requireThat(canResumeGomoku(room, account.id), 'undo_resume_not_allowed', 403)
    requireThat(room.version === expectedVersion, 'version_conflict', 409)
    const seat = this.seat(room, account.id)
    const events = await this.store.db.prepare('SELECT body FROM events WHERE room_id=? ORDER BY version').all(id) as {
      body: string
    }[]
    const state = resumedPosition(room, seat, events)
    const metadata = await this.packages.publish(account.id, undoPackage)
    const old = room.version++
    room.packageHash = metadata.hash
    room.manifest = metadata.manifest
    room.state = state
    room.result = null
    room.status = 'playing'
    room.turn = seat
    room.deadline = this.now() + room.turnTimeoutMs
    room.matchDeadline = this.now() + 23 * 3600000
    await this.observations(room)
    requireThat(room.status === 'playing', 'undo_restore_failed', 409)
    return await this.view(await this.save(room, old, 'undo_resumed'), account.id)
  }
  async closeRoom(account: Account, id: string) {
    const room = await this.load(id)
    this.seat(room, account.id)
    requireThat(room.creatorAccountId === account.id, 'creator_required', 403)
    if (room.closedAt !== undefined) return { closed: true }
    writableRoom(room)
    requireThat(
      !(room.status === 'playing' && room.walletSpend?.protocol === 'economy.pool/v1'),
      'active_pool_requires_exit',
      409,
    )
    const old = room.version++
    room.closedAt = this.now()
    // Preserve completed results and their settlement; unfinished matches refund
    // through the same durable spend finalization used by cancellation/timeouts.
    if (!['finished', 'aborted'].includes(room.status)) this.abort(room)
    await this.save(room, old, 'room_closed')
    return { closed: true }
  }
  async leave(account: Account, id: string, seatId?: string) {
    const room = writableRoom(await this.load(id))
    const seat = this.seat(room, account.id, seatId)
    if (room.departedSeatIds?.includes(room.seats[seat].id)) return { left: true }
    if (room.status === 'playing' && room.manifest.playerExit) {
      const output = await this.run(room, 'exit', [room.state], seat)
      const old = room.version++
      this.apply(room, transition(output.value, room.seats.length), output.cursor)
      room.departedSeatIds = [...(room.departedSeatIds ?? []), room.seats[seat].id]
      if (room.creatorAccountId === account.id) {
        room.creatorAccountId = room.seats.find(s =>
          s.kind !== 'bot' && !room.departedSeatIds!.includes(s.id)
        )?.accountId ?? account.id
      }
      await this.save(room, old, 'player_exit')
      return { left: true }
    }
    if (['finished', 'aborted'].includes(room.status)) return { left: true }
    if (room.mode === 'token' && room.walletSpend && room.status === 'funding') {
      await this.cancelSpend(account, id)
      return { left: true }
    }
    if (
      room.status === 'playing' && room.mode !== 'token' && room.seats.some(s => s.kind === 'bot')
      && room.seats.filter(s => s.kind === 'human').length === 1
    ) {
      const old = room.version++
      this.abort(room)
      await this.save(room, old, 'left')
      return { left: true }
    }
    requireThat(room.status === 'waiting', 'room_started', 409)
    const old = room.version++
    const removed = room.seats.splice(seat, 1)[0]
    delete room.observations[removed.id]
    delete room.scenes?.[removed.id]
    delete room.sceneErrors?.[removed.id]
    if (!room.seats.some(s => s.accountId === account.id)) {
      delete room.economyAccounts[account.id]
    }
    if (!room.seats.length || room.seats.every(s => s.kind === 'bot')) {
      room.seats = []
      room.status = 'aborted'
    } else if (room.creatorAccountId === account.id) {
      room.creatorAccountId = room.seats.find(s => s.kind !== 'bot')!.accountId
    }
    await this.save(room, old, 'left')
    return { left: true }
  }
  async ready(account: Account, id: string, ready: unknown, consent?: Consent, seatId?: string) {
    requireThat(typeof ready === 'boolean')
    const room = writableRoom(await this.load(id))
    const seat = this.seat(room, account.id, seatId)
    requireThat(room.status === 'waiting', 'room_started', 409)
    if (ready) {
      this.consent(room, consent)
    }
    if (room.seats[seat].ready === ready) {
      return await this.view(room, account.id, room.seats[seat].id)
    }
    const old = room.version++
    room.seats[seat].ready = ready
    return await this.view(await this.save(room, old, 'ready'), account.id, room.seats[seat].id)
  }
  async nextMatch(account: Account, id: string) {
    const room = writableRoom(await this.load(id))
    this.seat(room, account.id)
    requireThat(room.creatorAccountId === account.id, 'creator_required', 403)
    requireThat(['finished', 'aborted'].includes(room.status), 'match_not_finished', 409)
    requireThat(['none', 'settled', 'refunded'].includes(room.settlement), 'settlement_pending', 409)
    const old = room.version++
    room.matchId = this.store.id('match')
    room.handNo++
    room.status = 'waiting'
    room.cashouts = undefined
    room.seats = room.seats.filter(s => !room.departedSeatIds?.includes(s.id))
    room.departedSeatIds = []
    room.state = null
    room.result = null
    room.turn = null
    room.deadline = null
    room.seed = randomBytes(32).toString('hex')
    room.cursor = 0
    room.observations = {}
    room.scenes = {}
    room.sceneErrors = {}
    room.funding = null
    room.economyTerms = null
    room.economyOp = null
    room.settlement = 'none'
    room.fundingDeadline = null
    room.matchDeadline = null
    if (room.walletSpend) {
      room.walletSpend = { protocol: 'economy.pool/v1', termsHash: null, acceptBefore: null, phase: 'waiting' }
    }
    room.seats.forEach(s => {
      s.ready = s.kind === 'bot'
    })
    return await this.view(await this.save(room, old, 'next_match'), account.id)
  }
  private async run(
    room: Room,
    method: 'setup' | 'act' | 'timeout' | 'observe' | 'exit',
    args: Json[],
    seatIndex: number | null,
  ) {
    return await invoke({
      rules: (await this.packages.get(room.packageHash)).rules,
      method,
      args,
      ctx: {
        seats: room.seats.map(s => s.id),
        participants: room.seats.map(s => ({ name: s.name, kind: s.kind })),
        config: room.config,
        seatIndex,
        mode: room.mode === 'token' && room.walletSpend?.protocol !== 'economy.pool/v1' ? 'local-chips' : room.mode,
        stake: room.mode === 'token' && room.walletSpend?.protocol !== 'economy.pool/v1' ? 0 : room.stake,
        policy: room.policy,
      },
      seed: room.seed,
      cursor: room.cursor,
    })
  }
  private apply(room: Room, next: Transition, cursor: number) {
    if (next.cashouts) {
      requireThat(
        !room.cashouts || room.cashouts.every((paid, i) => paid === null || paid === next.cashouts![i]),
        'cashout_changed',
        422,
      )
      room.cashouts = next.cashouts
    }
    room.state = next.state
    room.turn = next.turn
    room.cursor = cursor
    room.result = next.done ?? null
    room.status = next.done ? 'finished' : 'playing'
    room.deadline = next.done ? null : this.now() + room.turnTimeoutMs
    if (next.done && room.mode === 'token') {
      room.settlement = 'pending'
      room.economyOp = null
    }
  }
  private abort(room: Room, sceneError: SceneError | null = null) {
    room.status = 'aborted'
    room.scenes = Object.fromEntries(room.seats.map(seat => [seat.id, null]))
    room.sceneErrors = Object.fromEntries(room.seats.map(seat => [seat.id, sceneError]))
    room.turn = null
    room.deadline = null
    room.result = null
    if (room.mode === 'token' && room.economyTerms) {
      room.settlement = 'pending'
      room.economyOp = null
    }
  }
  async start(account: Account, id: string) {
    const room = writableRoom(await this.load(id))
    this.seat(room, account.id)
    requireThat(room.creatorAccountId === account.id, 'creator_required', 403)
    if (room.status !== 'waiting') {
      return await this.view(room, account.id)
    }
    requireThat(room.seats.length >= room.manifest.minPlayers && room.seats.every(s => s.ready), 'not_ready', 409)
    const old = room.version++
    room.matchDeadline = this.now() + 23 * 3600000
    let spendRecord: GameSpendRecord | undefined
    if (room.mode === 'token') {
      requireThat(this.spend, 'wallet_spend_unavailable', 503)
      spendRecord = await this.spend.prepare(room)
      room.status = 'funding'
      room.walletSpend = {
        protocol: 'economy.pool/v1',
        termsHash: spendRecord.termsHash,
        acceptBefore: spendRecord.terms.payload.acceptBefore,
        phase: 'funding',
      }
      room.fundingDeadline = spendRecord.terms.payload.acceptBefore
    } else {
      try {
        const r = await this.run(room, 'setup', [], null)
        this.apply(room, transition(r.value, room.seats.length), r.cursor)
      } catch {
        this.abort(room)
      }
    }
    await this.save(room, old, 'started', undefined, undefined, spendRecord)
    await this.recoverRoom(room.id)
    return await this.view(await this.load(id), account.id)
  }
  private async command(roomId: string, accountId: string, key: string): Promise<Command | undefined> {
    return await this.store.db.prepare(
      'SELECT digest,response FROM commands WHERE room_id=? AND account_id=? AND key=?',
    ).get(roomId, accountId, key) as unknown as Command | undefined
  }
  async action(accountId: string, id: string, input: ActionRequest, extra?: () => Promise<void>, seatId?: string) {
    object(input)
    requireThat(typeof input.idempotencyKey === 'string' && /^[a-zA-Z0-9_:-]{1,128}$/.test(input.idempotencyKey))
    requireThat(integer(input.expectedVersion, 0, Number.MAX_SAFE_INTEGER) && Object.hasOwn(input, 'action'))
    requireThat(JSON.stringify(input.action).length <= 16384, 'action_too_large')
    const room = writableRoom(await this.load(id))
    const seat = this.seat(room, accountId, seatId)
    const actor = room.seats[seat].id
    requireThat(!room.departedSeatIds?.includes(actor), 'seat_departed', 409)
    const hash = digest(canonical(input))
    const prior = await this.command(id, actor, input.idempotencyKey)
    if (prior) {
      requireThat(prior.digest === hash, 'idempotency_conflict', 409)
      return JSON.parse(prior.response) as RoomView
    }
    requireThat(room.status === 'playing', 'not_playing', 409)
    requireThat(room.version === input.expectedVersion, 'version_conflict', 409)
    requireThat(room.turn === seat, 'not_your_turn', 403)
    requireThat(this.now() < (room.deadline ?? 0) && this.now() < (room.matchDeadline ?? 0), 'turn_expired', 409)
    const r = await this.run(room, 'act', [room.state, input.action], seat)
    try {
      this.apply(room, transition(r.value, room.seats.length), r.cursor)
    } catch {
      this.abort(room)
    }
    const old = room.version++
    const command = {
      accountId,
      seatId: actor,
      key: input.idempotencyKey,
      digest: hash,
      response: undefined as RoomView | undefined,
    }
    try {
      await this.save(room, old, 'action', command, extra)
    } catch (error) {
      const committed = await this.command(id, actor, input.idempotencyKey)
      if (!committed) throw error
      requireThat(committed.digest === hash, 'idempotency_conflict', 409)
      return JSON.parse(committed.response) as RoomView
    }
    // Economic completion is separately journaled. The idempotent action ACK
    // remains exactly the committed view, even when settlement completes later.
    requireThat(command.response, 'command_response_missing', 500)
    return command.response
  }
  async replay(accountId: string, id: string, seatId?: string) {
    const room = await this.load(id)
    const actor = room.seats[this.seat(room, accountId, seatId)].id
    const events = (await this.store.db.prepare('SELECT body FROM events WHERE room_id=? ORDER BY version').all(id) as {
      body: string
    }[])
      .map(r => JSON.parse(r.body)).filter(e => e.views[actor]).map(e => ({
        version: e.version,
        kind: e.kind,
        at: e.at,
        view: e.views[actor],
      }))
    return { roomId: id, events }
  }
  async tick() {
    if (this.disposed) {
      return
    }
    for (const room of await this.all()) {
      if (historicalTokenRoom(room)) continue
      await this.recoverRoom(room.id)
      await runRulesBot(this, await this.load(room.id))
    }
  }
  async catchUp(id: string) {
    for (let step = 0; step < 8; step++) {
      const snapshot = await this.load(id)
      if (historicalTokenRoom(snapshot)) return
      const before = snapshot.version
      await this.recoverRoom(id)
      await runRulesBot(this, await this.load(id))
      if ((await this.load(id)).version === before) break
    }
  }
  private async recoverRoom(id: string) {
    let room = await this.load(id)
    if (historicalTokenRoom(room)) return
    if (
      ['playing', 'funding'].includes(room.status)
      && !(room.status === 'playing' && room.walletSpend?.protocol === 'economy.pool/v1')
      && this.now() >= (room.status === 'funding' ? room.fundingDeadline! : room.matchDeadline!)
    ) {
      const old = room.version++
      this.abort(room)
      await this.save(room, old, 'expired')
    }
    room = await this.load(id)
    if (room.status === 'playing' && (this.now() >= room.deadline! || this.now() >= room.matchDeadline!)) {
      const old = room.version++
      try {
        const r = await this.run(room, 'timeout', [room.state], room.turn)
        this.apply(room, transition(r.value, room.seats.length), r.cursor)
      } catch {
        this.abort(room)
      }
      await this.save(room, old, 'timeout')
    }
  }
  async spendState(account: Account, id: string) {
    const room = await this.load(id)
    requireThat(!historicalTokenRoom(room), 'legacy_transaction_read_only', 410)
    this.seat(room, account.id)
    requireThat(this.spend && room.walletSpend?.termsHash, 'spend_transaction_not_found', 404)
    return this.spend.load(room.matchId)
  }
  async reservation(account: Account, id: string, input: unknown) {
    const room = writableRoom(await this.load(id))
    this.seat(room, account.id)
    requireThat(this.spend && room.walletSpend?.termsHash, 'spend_transaction_not_found', 404)
    const record = await this.spend.load(room.matchId)
    if (!await this.spend.accept(account, record, input)) {
      return { transaction: record, view: await this.view(room, account.id) }
    }
    const old = room.version++
    if (this.spend.complete(record)) {
      record.phase = 'active'
      try {
        const result = await this.run(room, 'setup', [], null)
        this.apply(room, transition(result.value, room.seats.length), result.cursor)
      } catch {
        this.abort(room)
      }
    }
    await this.save(room, old, room.status === 'playing' ? 'funded' : 'spend_reserved', undefined, undefined, record)
    return { transaction: record, view: await this.view(room, account.id) }
  }
  async cancelSpend(account: Account, id: string) {
    const room = writableRoom(await this.load(id))
    this.seat(room, account.id)
    requireThat(this.spend && room.walletSpend?.termsHash, 'spend_transaction_not_found', 404)
    const record = await this.spend.load(room.matchId)
    if (record.decision) return { transaction: record, view: await this.view(room, account.id) }
    requireThat(room.status === 'funding', 'spend_already_started', 409)
    const old = room.version++
    this.abort(room)
    await this.save(room, old, 'spend_cancelled', undefined, undefined, record)
    return { transaction: record, view: await this.view(room, account.id) }
  }
  async linkEconomy(_account: Account, _code: unknown) {
    throw new ApiError(410, 'legacy_economy_protocol_retired')
  }
}
