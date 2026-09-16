import {
  type AgentLoopProviderOptions,
  type AgentProfile,
  createAgentLoopProvider,
  createDispatchService,
  createSeatHttpTransport,
  type DispatchService,
} from '@cordisx/game-room-agents'
import type { Agent, Consent, Dispatch, Invitation, Room, Source } from './model.js'
import { type HttpTransport, number, object, string } from './http.js'
export class ClientAgents {
  private starting = new Set<string>()
  private budgets = new Map<string, number>()
  private service?: DispatchService
  private options?: AgentLoopProviderOptions
  constructor(
    private profiles: AgentProfile[],
    private source: (id: string) => Source,
    private http: () => HttpTransport,
  ) {}
  configure(options: AgentLoopProviderOptions) {
    this.options = options
  }
  availability() {
    if (!this.options || !this.http().exchange || !this.http().requestCredential) {
      return { available: false, reason: 'Host 安全席位授权或隔离 Agent 能力尚未就绪' }
    }
    return createAgentLoopProvider(this.options).availability()
  }
  private runtime() {
    if (this.service) return this.service
    if (!this.options || !this.http().exchange || !this.http().requestCredential) {
      throw new Error('当前 Host 未提供可取消 Agent 回合与安全席位凭证交换')
    }
    const provider = createAgentLoopProvider(this.options)
    const available = provider.availability()
    if (!available.available) throw new Error(available.reason ?? 'Agent 执行不可用')
    this.service = createDispatchService({
      provider,
      transport: createSeatHttpTransport({
        request: async input =>
          this.http().requestCredential!({
            source: this.source(input.serverId),
            credentialRef: input.credentialRef,
            method: input.method,
            path: input.path,
            body: input.body,
            signal: input.signal,
          }),
      }),
    })
    return this.service
  }
  agents(): Agent[] {
    const active = new Set(
      this.service?.list().filter(run => !['withdrawn', 'failed', 'completed'].includes(run.status)).map(run =>
        run.profile.id
      ),
    )
    return this.profiles.map(profile => ({
      id: profile.id,
      name: profile.name,
      avatar: '🤖',
      description: profile.personality,
      games: profile.gameIds,
      status: active.has(profile.id) ? 'playing' : 'idle',
    }))
  }
  runs(): Dispatch[] {
    return (this.service?.list() ?? []).map(run => ({
      id: run.id,
      sourceId: run.binding.serverId,
      roomId: run.binding.roomId,
      agentId: run.profile.id,
      state: run.status === 'withdrawn'
        ? 'withdrawn'
        : run.status === 'completed'
        ? 'completed'
        : run.status === 'failed'
        ? 'failed'
        : 'running',
      detail: run.reason ?? run.status,
      budget: this.budgets.get(run.id) ?? 0,
      turns: run.actionsUsed,
      modelCalls: run.modelCallsUsed,
    }))
  }
  async dispatch(
    agentId: string,
    invitation: Invitation,
    room: Room,
    budget: number,
    consent: Consent | undefined,
    signal: AbortSignal,
  ): Promise<Dispatch> {
    if (this.starting.has(agentId)) throw new Error('该 Agent 正在派遣中')
    this.starting.add(agentId)
    try {
      return await this.dispatchSeat(agentId, invitation, room, budget, consent, signal)
    } finally {
      this.starting.delete(agentId)
    }
  }
  private async dispatchSeat(
    agentId: string,
    invitation: Invitation,
    room: Room,
    budget: number,
    consent: Consent | undefined,
    signal: AbortSignal,
  ): Promise<Dispatch> {
    const service = this.runtime()
    const profile = this.profiles.find(profile => profile.id === agentId)
    if (!profile || !profile.gameIds.includes(room.game.id)) throw new Error('Agent 与玩法不兼容')
    if (this.agents().find(agent => agent.id === agentId)?.status !== 'idle') {
      throw new Error('此 Agent 已有运行中的派遣')
    }
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10000) throw new Error('动作预算须为 1–10000')
    if (
      room.mode === 'token'
      && (!consent || consent.packageHash !== room.game.packageHash || consent.stake !== room.stake
        || consent.settlement !== room.settlement)
    ) throw new Error('请确认新增 Agent 席位的完整 Token 条款')
    const source = this.source(invitation.sourceId)
    const prefix = `/v1/rooms/${encodeURIComponent(invitation.roomId)}`
    const terms = room.mode === 'token'
      ? { packageHash: room.game.packageHash, stake: room.stake, policy: room.settlement, reviewState: 'unreviewed' }
      : undefined
    const seatResult = object(
      await this.http().request({
        source,
        path: `${prefix}/agent-seats`,
        method: 'POST',
        body: { participantId: profile.id, name: profile.name, ...(terms ? { consent: terms } : {}) },
        authenticated: true,
        signal,
      }),
    )
    const seat = object(seatResult.seat)
    const seatId = string(seat.id)
    let cleanupRef: string | undefined
    try {
      await this.http().request({
        source,
        path: `${prefix}/ready`,
        method: 'POST',
        body: { ready: true, seatId, ...(terms ? { consent: terms } : {}) },
        authenticated: true,
        signal,
      })
      const grantResult = await this.http().exchange!({
        source,
        path: `${prefix}/agent-grants`,
        body: { seatId, expiresAt: Date.now() + 60 * 60 * 1000, maxActions: budget },
        signal,
        authenticated: true,
      }, 'token')
      cleanupRef = grantResult.credentialRef
      const grant = object(grantResult.value)
      if (
        Object.hasOwn(grant, 'token') || grant.serverId !== source.id || grant.roomId !== room.id
        || grant.seatId !== seatId || grant.accountId !== seat.accountId
        || grant.matchId !== object(seatResult.view).matchId
        || number(grant.maxActions) > budget || number(grant.expiresAt) > Date.now() + 3600000
      ) throw new Error('席位授权响应身份不一致')
      const id = crypto.randomUUID()
      this.budgets.set(id, budget)
      await service.dispatch({
        id,
        profile,
        binding: { serverId: source.id, roomId: room.id, seatId, accountId: string(grant.accountId) },
        grant: {
          serverId: source.id,
          roomId: room.id,
          seatId,
          accountId: string(grant.accountId),
          matchId: string(grant.matchId),
          grantId: string(grant.grantId),
          credentialRef: grantResult.credentialRef,
          expiresAt: number(grant.expiresAt),
          maxActions: number(grant.maxActions),
        },
        budget: {
          maxActions: budget,
          maxModelCalls: budget + 5,
          maxDurationMs: 3600000,
          turnTimeoutMs: 60000,
          maxRetries: 2,
          maxOutputBytes: 16384,
        },
      })
      return this.runs().find(run => run.id === id)!
    } catch (error) {
      if (cleanupRef) {
        await this.http().requestCredential!({
          source,
          credentialRef: cleanupRef,
          path: '/v1/agent/revoke',
          method: 'POST',
          body: {},
          signal: AbortSignal.timeout(10000),
        }).catch(() => undefined)
      }
      await this.http().request({
        source,
        path: `${prefix}/leave`,
        method: 'POST',
        body: { seatId },
        authenticated: true,
        signal: AbortSignal.timeout(10000),
      }).catch(() => undefined)
      throw error
    }
  }
  async withdraw(dispatch: Dispatch) {
    if (!this.service) throw new Error('派遣服务已关闭')
    await this.service.withdraw(dispatch.id, 'immediate')
  }
  async dispose() {
    const service = this.service
    this.service = undefined
    if (!service) return
    await Promise.allSettled(service.list().map(run => service.withdraw(run.id, 'immediate')))
    await service.close()
  }
}
