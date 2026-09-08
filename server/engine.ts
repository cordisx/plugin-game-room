import { randomBytes } from 'node:crypto'
import type { ActionRequest, Consent, CreateRoomRequest, Json, RoomCard, RoomView, Transition } from '../sdk/index.js'
import type { Account } from './accounts.js'
import { digest } from './accounts.js'
import { ApiError, canonical, integer, object, requireThat } from './errors.js'
import { Store } from './store.js'
import { Packages } from './packages.js'
import { invoke, transition } from './runner.js'
import { type EconomyAdapter, type FundingTerms, payouts } from './economy.js'

export interface Room extends RoomCard {
  creatorId: string
  state: Json
  seed: string
  cursor: number
  observations: Record<string, Json>
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
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    readonly store: Store,
    readonly packages: Packages,
    readonly economy?: EconomyAdapter,
    readonly now = Date.now,
  ) {}
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn)
    this.queue = next.catch(() => {})
    return next
  }
  load(id: string): Room {
    const row = this.store.db.prepare('SELECT body FROM rooms WHERE id=?').get(id) as { body: string } | undefined
    requireThat(row, 'room_not_found', 404)
    return JSON.parse(row.body)
  }
  all(): Room[] {
    return (this.store.db.prepare('SELECT body FROM rooms').all() as { body: string }[]).map(r => JSON.parse(r.body))
  }
  card(room: Room): RoomCard {
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
    } = room
    return structuredClone({
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
    })
  }
  seat(room: Room, accountId: string, seatId?: string) {
    const i = room.seats.findIndex(s => s.accountId === accountId && (seatId ? s.id === seatId : s.kind === 'human'))
    const selected = i >= 0 ? i : seatId ? -1 : room.seats.findIndex(s => s.accountId === accountId)
    requireThat(selected >= 0, 'not_a_member', 403)
    return selected
  }
  view(room: Room, accountId: string, seatId?: string): RoomView {
    const i = this.seat(room, accountId, seatId)
    return {
      ...this.card(room),
      selfSeatId: room.seats[i].id,
      observation: structuredClone(room.observations[room.seats[i].id] ?? null),
    }
  }
  list(accountId?: string) {
    return this.all().filter(r => !accountId || r.seats.some(s => s.accountId === accountId)).map(r => this.card(r))
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
    for (let i = 0; i < room.seats.length; i++) {
      try {
        room.observations[room.seats[i].id] = (await this.run(room, 'observe', [room.state, i], i)).value
      } catch {
        room.observations[room.seats[i].id] = null
      }
    }
  }
  private async save(
    room: Room,
    expected: number | null,
    kind: string,
    command?: { accountId: string; seatId: string; key: string; digest: string },
    extra?: () => void,
  ): Promise<Room> {
    await this.observations(room)
    this.store.atomic(() => {
      if (expected !== null) requireThat(this.load(room.id).version === expected, 'version_conflict', 409)
      this.store.db.prepare('INSERT INTO rooms VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(
        room.id,
        JSON.stringify(room),
      )
      const views = Object.fromEntries(room.seats.map(s => [s.id, this.view(room, s.accountId, s.id)]))
      this.store.db.prepare('INSERT INTO events VALUES (?,?,?)').run(
        room.id,
        room.version,
        JSON.stringify({ version: room.version, kind, at: this.now(), views }),
      )
      if (command) {
        this.store.db.prepare('INSERT INTO commands VALUES (?,?,?,?,?)').run(
          room.id,
          command.seatId,
          command.key,
          command.digest,
          JSON.stringify(this.view(room, command.accountId, command.seatId)),
        )
      }
      extra?.()
    })
    return room
  }
  private addSeat(room: Room, account: Account) {
    if (room.mode === 'token') {
      requireThat(account.economyId, 'economy_link_required', 409)
      room.economyAccounts[account.id] = account.economyId
    }
    room.seats.push({
      id: this.store.id('seat'),
      kind: 'human',
      participantId: null,
      accountId: account.id,
      name: account.name,
      ready: false,
    })
  }
  async create(account: Account, input: CreateRoomRequest) {
    object(input)
    const pkg = this.packages.get(input.packageHash)
    requireThat(pkg.manifest.modes.includes(input.mode), 'unsupported_mode')
    const maxPlayers = input.maxPlayers ?? pkg.manifest.maxPlayers
    requireThat(integer(maxPlayers, pkg.manifest.minPlayers, pkg.manifest.maxPlayers))
    const timeout = input.turnTimeoutMs ?? 60000
    requireThat(integer(timeout, 1000, 3600000))
    const stake = input.stake ?? 0
    requireThat(integer(stake, input.mode === 'token' ? 1 : 0, 1000000))
    requireThat(input.mode === 'token' || stake === 0, 'stake_not_allowed')
    const policy = input.policy ?? pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1'
    requireThat((pkg.manifest.settlementPolicies ?? ['equal-winners-v1']).includes(policy), 'unsupported_policy')
    requireThat(input.allowAgents === undefined || typeof input.allowAgents === 'boolean')
    requireThat(input.mode !== 'token' || this.economy, 'economy_unavailable', 503)
    requireThat(JSON.stringify(input.config ?? {}).length <= 16384, 'config_too_large')
    const room: Room = {
      id: this.store.id('room'),
      matchId: this.store.id('match'),
      handNo: 1,
      serverId: this.store.serverId,
      packageHash: input.packageHash,
      manifest: pkg.manifest,
      mode: input.mode,
      config: input.config ?? {},
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
      funding: null,
      creatorId: account.id,
      state: null,
      seed: randomBytes(32).toString('hex'),
      cursor: 0,
      observations: {},
      economyAccounts: {},
      economyTerms: null,
      economyOp: null,
      fundingDeadline: null,
      matchDeadline: null,
    }
    this.consent(room, input.consent)
    this.addSeat(room, account)
    return this.view(await this.save(room, null, 'created'), account.id)
  }
  async join(account: Account, id: string, consent?: Consent) {
    const room = this.load(id)
    if (room.seats.some(s => s.accountId === account.id && s.kind === 'human')) return this.view(room, account.id)
    requireThat(room.status === 'waiting', 'room_started', 409)
    requireThat(room.seats.length < room.maxPlayers, 'room_full', 409)
    this.consent(room, consent)
    this.addSeat(room, account)
    const old = room.version++
    return this.view(await this.save(room, old, 'joined'), account.id)
  }
  async agentSeat(account: Account, id: string, input: Record<string, unknown>) {
    const room = this.load(id)
    requireThat(room.status === 'waiting', 'room_started', 409)
    requireThat(room.allowAgents, 'agents_not_allowed', 403)
    requireThat(typeof input.participantId === 'string' && /^[a-zA-Z0-9_:-]{1,128}$/.test(input.participantId))
    requireThat(typeof input.name === 'string' && input.name.length > 0 && input.name.length <= 80)
    const prior = room.seats.find(s =>
      s.accountId === account.id && s.participantId === input.participantId && s.kind === 'agent'
    )
    if (prior) return { seat: prior, view: this.view(room, account.id, prior.id) }
    requireThat(room.seats.length < room.maxPlayers, 'room_full', 409)
    this.consent(room, input.consent as Consent | undefined)
    this.addSeat(room, account)
    const seat = room.seats.at(-1)!
    seat.kind = 'agent'
    seat.participantId = input.participantId
    seat.name = input.name
    const old = room.version++
    await this.save(room, old, 'agent_joined')
    return { seat, view: this.view(room, account.id, seat.id) }
  }
  async leave(account: Account, id: string, seatId?: string) {
    const room = this.load(id)
    const seat = this.seat(room, account.id, seatId)
    requireThat(room.status === 'waiting', 'room_started', 409)
    const old = room.version++
    const removed = room.seats.splice(seat, 1)[0]
    delete room.observations[removed.id]
    if (!room.seats.some(s => s.accountId === account.id)) delete room.economyAccounts[account.id]
    if (!room.seats.length) room.status = 'aborted'
    else if (room.creatorId === account.id) room.creatorId = room.seats[0].accountId
    await this.save(room, old, 'left')
    return { left: true }
  }
  async ready(account: Account, id: string, ready: unknown, consent?: Consent, seatId?: string) {
    requireThat(typeof ready === 'boolean')
    const room = this.load(id)
    const seat = this.seat(room, account.id, seatId)
    requireThat(room.status === 'waiting', 'room_started', 409)
    if (ready) this.consent(room, consent)
    if (room.seats[seat].ready === ready) return this.view(room, account.id, room.seats[seat].id)
    const old = room.version++
    room.seats[seat].ready = ready
    return this.view(await this.save(room, old, 'ready'), account.id, room.seats[seat].id)
  }
  async nextMatch(account: Account, id: string) {
    const room = this.load(id)
    this.seat(room, account.id)
    requireThat(room.creatorId === account.id, 'creator_required', 403)
    requireThat(['finished', 'aborted'].includes(room.status), 'match_not_finished', 409)
    requireThat(['none', 'settled', 'refunded'].includes(room.settlement), 'settlement_pending', 409)
    const old = room.version++
    room.matchId = this.store.id('match')
    room.handNo++
    room.status = 'waiting'
    room.state = null
    room.result = null
    room.turn = null
    room.deadline = null
    room.seed = randomBytes(32).toString('hex')
    room.cursor = 0
    room.observations = {}
    room.funding = null
    room.economyTerms = null
    room.economyOp = null
    room.settlement = 'none'
    room.fundingDeadline = null
    room.matchDeadline = null
    room.seats.forEach(s => {
      s.ready = false
    })
    return this.view(await this.save(room, old, 'next_match'), account.id)
  }
  private run(room: Room, method: 'setup' | 'act' | 'timeout' | 'observe', args: Json[], seatIndex: number | null) {
    return invoke({
      rules: this.packages.get(room.packageHash).rules,
      method,
      args,
      ctx: {
        seats: room.seats.map(s => s.id),
        config: room.config,
        seatIndex,
        mode: room.mode,
        stake: room.stake,
        policy: room.policy,
      },
      seed: room.seed,
      cursor: room.cursor,
    })
  }
  private apply(room: Room, next: Transition, cursor: number) {
    room.state = next.state
    room.turn = next.turn
    room.cursor = cursor
    room.result = next.done ?? null
    room.status = next.done ? 'finished' : 'playing'
    room.deadline = next.done ? null : this.now() + room.turnTimeoutMs
    if (next.done && room.mode === 'token') {
      payouts(room)
      room.settlement = 'pending'
      room.economyOp = 'settle'
    }
  }
  private abort(room: Room) {
    room.status = 'aborted'
    room.turn = null
    room.deadline = null
    room.result = null
    if (room.mode === 'token' && room.economyTerms) {
      room.settlement = 'pending'
      room.economyOp = 'cancel'
    }
  }
  async start(account: Account, id: string) {
    const room = this.load(id)
    this.seat(room, account.id)
    requireThat(room.creatorId === account.id, 'creator_required', 403)
    if (room.status !== 'waiting') return this.view(room, account.id)
    requireThat(room.seats.length >= room.manifest.minPlayers && room.seats.every(s => s.ready), 'not_ready', 409)
    const old = room.version++
    room.matchDeadline = this.now() + 23 * 3600000
    if (room.mode === 'token') {
      room.status = 'funding'
      room.settlement = 'pending'
      room.economyOp = 'create'
      room.fundingDeadline = this.now() + 10 * 60000
      room.economyTerms = {
        matchId: room.matchId,
        game: {
          id: room.manifest.id,
          version: room.manifest.version,
          digest: room.packageHash,
          reviewStatus: 'unreviewed',
        },
        participants: this.allocations(room, room.seats.map(() => room.stake)),
        settlementPolicy: { kind: 'conserved-payouts' },
        expiresAt: this.now() + 24 * 3600000,
      }
    } else {
      try {
        const r = await this.run(room, 'setup', [], null)
        this.apply(room, transition(r.value, room.seats.length), r.cursor)
      } catch {
        this.abort(room)
      }
    }
    await this.save(room, old, 'started')
    await this.recoverRoom(room.id)
    return this.view(this.load(id), account.id)
  }
  private command(roomId: string, accountId: string, key: string): Command | undefined {
    return this.store.db.prepare('SELECT digest,response FROM commands WHERE room_id=? AND account_id=? AND key=?').get(
      roomId,
      accountId,
      key,
    ) as unknown as Command | undefined
  }
  async action(accountId: string, id: string, input: ActionRequest, extra?: () => void, seatId?: string) {
    object(input)
    requireThat(typeof input.idempotencyKey === 'string' && /^[a-zA-Z0-9_:-]{1,128}$/.test(input.idempotencyKey))
    requireThat(integer(input.expectedVersion, 0, Number.MAX_SAFE_INTEGER) && Object.hasOwn(input, 'action'))
    requireThat(JSON.stringify(input.action).length <= 16384, 'action_too_large')
    const room = this.load(id)
    const seat = this.seat(room, accountId, seatId)
    const actor = room.seats[seat].id
    const hash = digest(canonical(input))
    const prior = this.command(id, actor, input.idempotencyKey)
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
    await this.save(room, old, 'action', { accountId, seatId: actor, key: input.idempotencyKey, digest: hash }, extra)
    // Economic completion is separately journaled. The idempotent action ACK
    // remains exactly the committed view, even when settlement completes later.
    return this.view(room, accountId, actor)
  }
  replay(accountId: string, id: string, seatId?: string) {
    const room = this.load(id)
    const actor = room.seats[this.seat(room, accountId, seatId)].id
    const events =
      (this.store.db.prepare('SELECT body FROM events WHERE room_id=? ORDER BY version').all(id) as { body: string }[])
        .map(r => JSON.parse(r.body)).filter(e => e.views[actor]).map(e => ({
          version: e.version,
          kind: e.kind,
          at: e.at,
          view: e.views[actor],
        }))
    return { roomId: id, events }
  }
  async tick() {
    for (const room of this.all()) await this.recoverRoom(room.id)
  }
  private async recoverRoom(id: string) {
    let room = this.load(id)
    if (
      ['playing', 'funding'].includes(room.status)
      && this.now() >= (room.status === 'funding' ? room.fundingDeadline! : room.matchDeadline!)
    ) {
      const old = room.version++
      this.abort(room)
      await this.save(room, old, 'expired')
    }
    room = this.load(id)
    if (room.mode === 'token' && this.economy) {
      try {
        if (room.economyOp === 'create' || (room.economyOp === 'cancel' && !room.funding)) {
          const agreement = await this.economy.create(room.economyTerms!, `${room.matchId}:agreement`)
          const old = room.version++
          room.funding = { economyUrl: this.economy.url, agreementId: agreement.id, termsHash: agreement.termsHash }
          if (room.economyOp === 'create') room.economyOp = null
          await this.save(room, old, 'agreement')
        }
        if (room.funding && !['settled', 'refunded'].includes(room.settlement)) {
          const current = await this.economy.get(room.funding.agreementId)
          if (current.state === 'expired' || current.state === 'cancelled') {
            const old = room.version++
            if (['playing', 'funding'].includes(room.status)) this.abort(room)
            room.settlement = 'refunded'
            room.economyOp = null
            await this.save(room, old, 'economy_refunded')
          } else if (current.state === 'settled' && room.economyOp !== 'settle') {
            const old = room.version++
            if (['playing', 'funding'].includes(room.status)) this.abort(room)
            room.settlement = 'settled'
            room.economyOp = null
            await this.save(room, old, 'economy_settled')
          }
        }
        if (room.economyOp === 'cancel' && room.funding) {
          const agreement = await this.economy.cancel(room.funding.agreementId, `${room.matchId}:cancel`)
          requireThat(agreement.state === 'cancelled' || agreement.state === 'expired', 'economy_invalid_state', 503)
          const old = room.version++
          room.settlement = 'refunded'
          room.economyOp = null
          await this.save(room, old, 'refunded')
        } else if (room.economyOp === 'settle' && room.funding) {
          const amounts = payouts(room)
          const agreement = await this.economy.settle(
            room.funding.agreementId,
            room.funding.termsHash,
            this.allocations(room, amounts).map(({ accountId, amount }) => ({ accountId, amount })),
            `${room.matchId}:settle`,
          )
          requireThat(agreement.state === 'settled', 'economy_invalid_state', 503)
          const old = room.version++
          room.settlement = 'settled'
          room.economyOp = null
          await this.save(room, old, 'settled')
        } else if (room.status === 'funding' && room.funding) {
          const agreement = await this.economy.get(room.funding.agreementId)
          const old = room.version
          if (agreement.state !== 'open') {
            room.version++
            this.abort(room)
            await this.save(room, old, 'funding_cancelled')
          } else if (room.seats.every(s => agreement.reservations.includes(room.economyAccounts[s.accountId]))) {
            room.version++
            room.settlement = 'reserved'
            try {
              const r = await this.run(room, 'setup', [], null)
              this.apply(room, transition(r.value, room.seats.length), r.cursor)
            } catch {
              this.abort(room)
            }
            await this.save(room, old, 'funded')
          }
        }
      } catch { /* The durable operation remains pending; a later tick retries. */ }
    }
    room = this.load(id)
    if (room.status === 'playing' && this.now() >= room.deadline!) {
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
  private allocations(room: Room, amounts: number[]) {
    const allocations = new Map<string, { accountId: string; amount: number; participantIds: string[] }>()
    room.seats.forEach((s, i) => {
      const accountId = room.economyAccounts[s.accountId]
      const entry = allocations.get(accountId) ?? { accountId, amount: 0, participantIds: [] }
      entry.amount += amounts[i]
      entry.participantIds.push(s.id)
      allocations.set(accountId, entry)
    })
    return [...allocations.values()]
  }
  async linkEconomy(account: Account, code: unknown) {
    requireThat(this.economy, 'economy_unavailable', 503)
    requireThat(typeof code === 'string' && code.length <= 4096)
    requireThat(
      !this.all().some(r =>
        r.mode === 'token' && ['waiting', 'funding', 'playing'].includes(r.status)
        && r.seats.some(s => s.accountId === account.id)
      ),
      'economy_link_locked',
      409,
    )
    const identity = await this.economy.redeem(code, account.id, `${digest(account.id + ':' + code)}:link`)
    requireThat(
      identity.gameServiceId === this.economy.serviceId && identity.gameAccountId === account.id,
      'economy_identity_mismatch',
      403,
    )
    requireThat(
      typeof identity.accountId === 'string' && typeof identity.instanceId === 'string',
      'economy_invalid_identity',
      503,
    )
    requireThat(
      !this.store.db.prepare('SELECT id FROM accounts WHERE economy_id=? AND id<>?').get(
        identity.accountId,
        account.id,
      ),
      'economy_account_in_use',
      409,
    )
    this.store.db.prepare('UPDATE accounts SET economy_id=? WHERE id=?').run(identity.accountId, account.id)
    return identity
  }
}
