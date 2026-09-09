import type { Balance, Seat, Source } from './model.js'
import { normalizeSourceUrl } from './model.js'
import { array, type HttpTransport, number, object, string } from './http.js'
export type EconomyBinding = { source: Source; gameServiceId: string; instanceId: string | null }
export type FundingQuote = {
  agreementId: string
  termsHash: string
  instanceId: string
  serviceId: string
  accountId: string
  amount: number
  seatIds: string[]
  expiresAt: number
  reserved: boolean
  policy: string
  participants: { accountId: string; amount: number; seatIds: string[] }[]
}
export class EconomyAccounts {
  private bindings = new Map<string, EconomyBinding>()
  private wallets = new Map<string, { accountId: string; balance: Balance }>()
  private reserveKeys = new Map<string, string>()
  constructor(private transport: () => HttpTransport) {}
  discover(gameSource: Source, value: unknown) {
    if (!value) {
      this.bindings.delete(gameSource.id)
      return
    }
    const economy = object(value)
    const source = {
      id: `economy:${gameSource.id}`,
      name: `${gameSource.name} · 经济实例`,
      url: normalizeSourceUrl(string(economy.url)),
      accountId: '',
      enabled: true,
    }
    const next = {
      source,
      gameServiceId: string(economy.gameServiceId),
      instanceId: typeof economy.instanceId === 'string' ? economy.instanceId : null,
    }
    const old = this.bindings.get(gameSource.id)
    if (
      old
      && (old.source.url !== source.url || old.gameServiceId !== next.gameServiceId
        || (old.instanceId && next.instanceId && old.instanceId !== next.instanceId))
    ) this.wallets.delete(gameSource.id)
    this.bindings.set(gameSource.id, next)
  }
  binding(sourceId: string) {
    const binding = this.bindings.get(sourceId)
    if (!binding) throw new Error('此来源未连接经济服务')
    return binding
  }
  async connect(sourceId: string, signal: AbortSignal) {
    const binding = this.binding(sourceId)
    if (!this.transport().connect) throw new Error('此 Host 尚不支持安全钱包连接')
    await this.transport().connect!(binding.source, 'bearer')
    await this.refresh(sourceId, signal)
  }
  private async request(sourceId: string, path: string, signal: AbortSignal, body?: unknown, idempotencyKey?: string) {
    return this.transport().request({
      source: this.binding(sourceId).source,
      path,
      authenticated: true,
      signal,
      ...(body === undefined ? {} : { method: 'POST', body }),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    })
  }
  async refresh(sourceId: string, signal: AbortSignal) {
    const me = object(await this.request(sourceId, '/v1/me', signal))
    const binding = this.binding(sourceId)
    const instanceId = string(me.instanceId)
    if (binding.instanceId && binding.instanceId !== instanceId) throw new Error('经济实例身份与游戏来源不一致')
    this.wallets.set(sourceId, {
      accountId: string(me.accountId),
      balance: {
        economyId: instanceId,
        label: binding.source.name,
        available: number(me.available),
        reserved: number(me.reserved),
      },
    })
  }
  async proof(sourceId: string, gameAccountId: string, signal: AbortSignal) {
    const binding = this.binding(sourceId)
    const result = object(
      await this.request(
        sourceId,
        '/v1/link-proofs',
        signal,
        { gameServiceId: binding.gameServiceId, gameAccountId },
        crypto.randomUUID(),
      ),
    )
    return string(result.code)
  }
  async quote(seat: Seat, signal: AbortSignal): Promise<FundingQuote> {
    if (!seat.funding || !seat.matchId) throw new Error('房间尚未生成投入条款')
    const sourceId = seat.room.sourceId
    const binding = this.binding(sourceId)
    if (normalizeSourceUrl(seat.funding.economyUrl) !== binding.source.url) {
      throw new Error('房间经济地址与已连接实例不一致')
    }
    const wallet = this.wallets.get(sourceId)
    if (!wallet) throw new Error('请先在设置中连接经济账户')
    const agreement = object(
      await this.request(sourceId, `/v1/agreements/${encodeURIComponent(seat.funding.agreementId)}`, signal),
    )
    const game = object(agreement.game)
    if (
      agreement.id !== seat.funding.agreementId || agreement.termsHash !== seat.funding.termsHash
      || agreement.matchId !== seat.matchId || agreement.instanceId !== wallet.balance.economyId
      || agreement.serviceId !== binding.gameServiceId || game.digest !== seat.room.game.packageHash
      || game.id !== seat.room.game.id || game.version !== seat.room.game.version || game.reviewStatus !== 'unreviewed'
    ) throw new Error('经济条款身份校验失败')
    const policy = string(object(agreement.settlementPolicy).kind)
    if (policy !== 'conserved-payouts') throw new Error('经济协议必须为守恒分配')
    const participants = array(agreement.participants).map(value => {
      const row = object(value)
      return {
        accountId: string(row.accountId),
        amount: number(row.amount),
        seatIds: array(row.participantIds ?? []).map(string),
      }
    })
    const own = participants.find(row => row.accountId === wallet.accountId)
    const ownedIds = (seat.ownedSeats ?? []).map(seat => seat.id).sort()
    if (
      !ownedIds.length || !own || own.amount !== seat.room.stake * ownedIds.length
      || JSON.stringify([...own.seatIds].sort()) !== JSON.stringify(ownedIds)
    ) throw new Error('条款覆盖席位或累计投入与当前房间不一致')
    if (agreement.state !== 'open' || number(agreement.expiresAt) <= Date.now()) throw new Error('投入条款已关闭或过期')
    return {
      agreementId: string(agreement.id),
      termsHash: string(agreement.termsHash),
      instanceId: string(agreement.instanceId),
      serviceId: string(agreement.serviceId),
      accountId: wallet.accountId,
      amount: own.amount,
      seatIds: own.seatIds,
      expiresAt: number(agreement.expiresAt),
      reserved: array(agreement.reservations).includes(wallet.accountId),
      policy: string(object(agreement.settlementPolicy).kind),
      participants,
    }
  }
  async reserve(seat: Seat, reviewed: FundingQuote, signal: AbortSignal) {
    const current = await this.quote(seat, signal)
    if (
      current.termsHash !== reviewed.termsHash || current.amount !== reviewed.amount
      || current.accountId !== reviewed.accountId
    ) throw new Error('投入条款发生变化，请重新确认')
    const key = `${current.instanceId}/${current.accountId}/${current.agreementId}/${current.termsHash}`
    const operationId = this.reserveKeys.get(key) ?? `game-reserve-${current.termsHash}`
    this.reserveKeys.set(key, operationId)
    await this.request(seat.room.sourceId, '/v1/reserve', signal, {
      agreementId: current.agreementId,
      termsHash: current.termsHash,
    }, operationId)
    await this.refresh(seat.room.sourceId, signal)
  }
  async balances(signal: AbortSignal) {
    await Promise.allSettled([...this.wallets.keys()].map(id => this.refresh(id, signal)))
    return [
      ...new Map(
        [...this.wallets.values()].map(wallet => [`${wallet.balance.economyId}/${wallet.accountId}`, wallet.balance]),
      ).values(),
    ]
  }
  dispose() {
    this.wallets.clear()
    this.bindings.clear()
    this.reserveKeys.clear()
  }
}
