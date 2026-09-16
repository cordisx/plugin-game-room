import { canonical, digest, parseSigned, type Signed, verifySigned } from '@cordisx/economy/spend'
import {
  parsePoolDecision,
  parsePoolReservation,
  parsePoolTerms,
  type PoolDecision,
  type PoolReservation,
  type PoolTerms,
} from '@cordisx/economy/pool'
import type { WalletSpendResultV1, WalletSpendSourceV1, WalletSpendV1 } from '@cordisx/protocol/wallet-spend/v1'
import type { FundingQuote } from './economy.js'
import type { Seat } from './model.js'
import { object } from './http.js'
type Record = {
  terms: Signed<PoolTerms>
  termsHash: string
  requestIds: { [id: string]: string }
  receipts: { [id: string]: Signed<PoolReservation> }
  decisions: Signed<PoolDecision>[]
}
export class GameWalletPool {
  constructor(
    private readonly ctx: {
      request: (id: string, path: string, signal: AbortSignal, body?: unknown) => Promise<unknown>
      account: (id: string) => string | undefined
      pin: (id: string) => WalletSpendSourceV1
      identity: (signal: AbortSignal) => Promise<{ walletId: string; walletPublicKey: string }>
      lease: (signal: AbortSignal) => { capability: WalletSpendV1; fence: () => void }
      accepted: <T>(r: WalletSpendResultV1<T>) => T
    },
  ) {}
  private async record(id: string, input: unknown): Promise<Record> {
    const r = object(input), terms = parseSigned(r.terms, parsePoolTerms), source = this.ctx.pin(id)
    if (
      terms.payload.serviceOrigin !== source.serviceOrigin || terms.payload.servicePublicKey !== source.servicePublicKey
      || terms.payload.serverId !== source.serverId || !await verifySigned(terms, source.servicePublicKey)
      || r.termsHash !== await digest(terms.payload)
    ) throw Error('抵押条款校验失败')
    const receipts = object(r.receipts) as Record['receipts']
    for (const [account, receipt] of Object.entries(receipts)) {
      const p = await this.receipt(receipt, terms, String(r.termsHash))
      if (p.payload.gameAccountId !== account) throw Error('抵押回执账户不一致')
    }
    if (!Array.isArray(r.decisions)) throw Error('结算记录缺失')
    const decisions: Signed<PoolDecision>[] = []
    for (const input of r.decisions) {
      const d = parseSigned(input, parsePoolDecision), previous = decisions.at(-1)
      if (
        canonical(d.payload.terms) !== canonical(terms) || !await verifySigned(d, source.servicePublicKey)
        || d.payload.sequence !== decisions.length + 1
        || d.payload.previousHash !== (previous ? await digest(previous.payload) : null)
      ) throw Error('结算顺序校验失败')
      decisions.push(d)
    }
    return {
      terms,
      termsHash: String(r.termsHash),
      requestIds: object(r.requestIds) as Record['requestIds'],
      receipts,
      decisions,
    }
  }
  private async receipt(input: unknown, terms: Signed<PoolTerms>, termsHash: string) {
    const r = parseSigned(input, parsePoolReservation), p = r.payload
    const own = terms.payload.participants.find(v => v.gameAccountId === p.gameAccountId)
    if (
      !own
      || canonical(own)
        !== canonical({
          gameAccountId: p.gameAccountId,
          walletId: p.walletId,
          walletPublicKey: p.walletPublicKey,
          amount: p.amount,
        })
      || p.termsHash !== termsHash || p.matchId !== terms.payload.matchId
      || p.serviceOrigin !== terms.payload.serviceOrigin
      || p.servicePublicKey !== terms.payload.servicePublicKey || p.serverId !== terms.payload.serverId
      || !await verifySigned(r, p.walletPublicKey)
    ) throw Error('抵押回执校验失败')
    return r
  }
  async quote(seat: Seat, input: unknown, signal: AbortSignal): Promise<FundingQuote> {
    const r = await this.record(seat.room.sourceId, input),
      t = r.terms.payload,
      wallet = await this.ctx.identity(signal)
    const own = t.participants.find(p => p.gameAccountId === this.ctx.account(seat.room.sourceId))
    const seatIds = (seat.ownedSeats ?? []).map(s => s.id).sort()
    if (
      !own || own.walletId !== wallet.walletId || own.walletPublicKey !== wallet.walletPublicKey || seatIds.length < 1
      || own.amount !== seat.room.stake * seatIds.length || t.matchId !== seat.matchId
      || t.game.digest !== seat.room.game.packageHash
      || t.game.id !== seat.room.game.id || t.game.version !== seat.room.game.version
    ) throw Error('抵押条款与当前房间不一致')
    const requestId = r.requestIds[own.gameAccountId]
    if (
      requestId
        !== 'pool:'
          + await digest({ ...this.ctx.pin(seat.room.sourceId), matchId: t.matchId, termsHash: r.termsHash, ...own })
    ) throw Error('抵押请求标识不一致')
    return {
      agreementId: t.matchId,
      termsHash: r.termsHash,
      instanceId: wallet.walletId,
      serviceId: t.serverId,
      accountId: own.gameAccountId,
      amount: own.amount,
      seatIds,
      expiresAt: t.acceptBefore,
      reserved: !!r.receipts[own.gameAccountId],
      policy: t.policy,
      participants: t.participants.map(p => ({
        accountId: p.gameAccountId,
        amount: p.amount,
        seatIds: p === own ? seatIds : [],
      })),
      poolTerms: r.terms,
      requestId,
    }
  }
  async reserve(seat: Seat, quote: FundingQuote, signal: AbortSignal) {
    const id = seat.room.sourceId, path = `/v1/rooms/${encodeURIComponent(seat.room.id)}/spend`
    const current = await this.quote(seat, await this.ctx.request(id, path, signal), signal)
    if (canonical(current) !== canonical(quote) || !current.poolTerms || !current.requestId) {
      throw Error('抵押条款已变化')
    }
    const { capability, fence } = this.ctx.lease(signal), pool = capability.pool
    if (!pool) throw Error('当前版本尚不支持抵押对局')
    const operation = { source: this.ctx.pin(id), deadline: Date.now() + 120000, signal }
    let hold = this.ctx.accepted(await pool.lookup({ ...operation, requestId: current.requestId }))
    fence()
    if (!hold) {
      hold = this.ctx.accepted(
        await pool.reserve({ ...operation, terms: canonical(current.poolTerms), requestId: current.requestId }),
      )
    }
    fence()
    const receipt = await this.receipt(JSON.parse(hold.reservation), current.poolTerms, current.termsHash)
    if (receipt.payload.gameAccountId !== this.ctx.account(id)) throw Error('游戏账户已变化')
    fence()
    const response = object(await this.ctx.request(id, path + '-receipts', signal, receipt))
    await this.recover(id, seat.room.id, response.transaction, signal)
  }
  async recover(id: string, roomId: string, input: unknown, signal: AbortSignal) {
    const record = await this.record(id, input),
      account = this.ctx.account(id),
      requestId = account && record.requestIds[account]
    if (!requestId) return
    const { capability, fence } = this.ctx.lease(signal), pool = capability.pool
    if (!pool) return
    const operation = { source: this.ctx.pin(id), deadline: Date.now() + 120000, signal }
    const hold = this.ctx.accepted(await pool.lookup({ ...operation, requestId }))
    fence()
    if (!hold) return
    const wallet = await this.ctx.identity(signal)
    const receipt = await this.receipt(JSON.parse(hold.reservation), record.terms, record.termsHash)
    if (receipt.payload.walletId !== wallet.walletId || receipt.payload.gameAccountId !== account) {
      throw Error('请恢复原钱包')
    }
    for (const decision of record.decisions.slice(hold.sequence)) {
      const status = this.ctx.accepted(await pool.applyDecision({ ...operation, decision: canonical(decision) }))
      fence()
      const allocation = decision.payload.allocations.find(p => p.walletId === wallet.walletId)!
      if (
        status.sequence !== decision.payload.sequence || status.paid !== allocation.paid
        || status.exited !== allocation.exited
        || status.decisionHash !== await digest(decision.payload) || status.reservation !== hold.reservation
      ) throw Error('结算回执校验失败')
    }
    if (!record.decisions.length && !record.receipts[account!]) {
      if (this.ctx.account(id) !== account) throw Error('游戏账户已变化')
      fence()
      const response = object(
        await this.ctx.request(id, `/v1/rooms/${encodeURIComponent(roomId)}/spend-receipts`, signal, receipt),
      )
      // The returned transaction includes any finality committed while recovering the missing acknowledgement.
      if ((object(response.transaction).decisions as unknown[]).length) {
        await this.recover(id, roomId, response.transaction, signal)
      }
    }
  }
}
