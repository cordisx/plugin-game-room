import { GameWalletPool } from './game-wallet-pool.js'
import type {
  WalletSpendRecordV1,
  WalletSpendResultV1,
  WalletSpendSourceV1,
  WalletSpendV1,
} from '@cordisx/protocol/wallet-spend/v1'
import {
  canonical,
  digest,
  parseDecision,
  parseReservation,
  parseSettlement,
  parseSigned,
  parseTerms,
  parseWalletBinding,
  parseWalletChallenge,
  type Signed,
  type SpendDecision,
  type SpendReservation,
  type SpendTerms,
  verifySigned,
} from '@cordisx/economy/spend'
import { array, object, string } from './http.js'
import type { Seat, Source } from './model.js'
import type { FundingQuote } from './economy.js'
interface Transaction {
  terms: Signed<SpendTerms>
  termsHash: string
  requestIds: Record<string, string>
  receipts: Record<string, Signed<SpendReservation>>
  phase: string
  decision: Signed<SpendDecision> | null
}
type Request = (sourceId: string, path: string, signal: AbortSignal, body?: unknown) => Promise<unknown>
/** Public Host capability only. Game HTTP transports public declarations, never wallet credentials. */
export class GameWalletSpend {
  private readonly pool = new GameWalletPool({
    request: (...args) => this.request(...args),
    account: id => this.account(id),
    pin: id => this.pin(id),
    identity: signal => this.identity(signal),
    lease: signal => this.lease(signal),
    accepted: result => this.accepted(result),
  })
  private capability?: WalletSpendV1
  private generation = 0
  private pins = new Map<string, WalletSpendSourceV1>()
  private delivered = new Set<string>()
  private originalWallet?: { walletId: string; walletPublicKey: string }
  constructor(
    private request: Request,
    private account: (id: string) => string | undefined,
    private source: (id: string) => Source,
    private binding: (id: string) => WalletSpendSourceV1,
  ) {}
  setCapability(capability?: WalletSpendV1, expected?: WalletSpendV1) {
    if (expected && this.capability !== expected) return
    this.generation++
    this.capability = capability
    this.pins.clear()
    this.delivered.clear()
  }
  supported() {
    return !!this.capability?.pool && this.capability.pool.contract === 'cordisx.wallet-pool/v1'
  }
  available(id: string) {
    return !!this.capability && this.pins.has(id)
  }
  private lease(signal: AbortSignal) {
    signal.throwIfAborted()
    const capability = this.capability, generation = this.generation
    if (!capability || capability.contract !== 'cordisx.wallet-spend/v1') throw new Error('本地钱包暂时不可用')
    return {
      capability,
      fence: () => {
        signal.throwIfAborted()
        if (generation !== this.generation || capability !== this.capability) {
          throw new Error(
            '本地钱包连接已变化，请重试',
          )
        }
      },
    }
  }
  private accepted<T>(result: WalletSpendResultV1<T>): T {
    if (result.status !== 'accepted') {
      throw new Error(
        result.code === 'denied'
          ? '已取消钱包确认'
          : result.code === 'outcome-unknown'
          ? '钱包确认结果待恢复，请重试'
          : '本地钱包暂时不可用',
      )
    }
    return result.value
  }
  async authorize(id: string, signal: AbortSignal) {
    const { capability, fence } = this.lease(signal), source = this.source(id)
    const pin = this.accepted(
      await capability.authorizeSource({
        serviceOrigin: new URL(source.url).origin,
        deadline: Date.now() + 120000,
        signal,
      }),
    )
    fence()
    if (
      pin.serverId !== id || pin.serviceOrigin !== new URL(source.url).origin
      || canonical(pin) !== canonical(this.binding(id))
    ) throw new Error('游戏来源身份不一致，请刷新来源')
    this.pins.set(id, pin)
  }
  private pin(id: string) {
    const pin = this.pins.get(id)
    if (!pin || canonical(pin) !== canonical(this.binding(id))) throw new Error('请先确认此游戏来源的钱包连接')
    return pin
  }
  private async identity(signal: AbortSignal) {
    const { capability, fence } = this.lease(signal), wallet = this.accepted(await capability.identity())
    fence()
    if (this.originalWallet && canonical(wallet) !== canonical(this.originalWallet)) throw new Error('请恢复原本地钱包')
    this.originalWallet = wallet
    return wallet
  }
  async linked(id: string, signal: AbortSignal) {
    const accountId = this.account(id)
    if (!accountId || !this.available(id)) return false
    const value = object(await this.request(id, '/v1/wallet-bindings', signal))
    if (!value.binding) return false
    const proof = parseSigned(value.binding, parseWalletBinding),
      wallet = await this.identity(signal),
      pin = this.pin(id)
    if (
      proof.payload.gameAccountId !== accountId || proof.payload.walletId !== wallet.walletId
      || proof.payload.walletPublicKey !== wallet.walletPublicKey || !this.sameSource(proof.payload, pin)
      || !await verifySigned(proof, wallet.walletPublicKey)
    ) throw new Error('钱包关联校验失败')
    return true
  }
  async bind(id: string, signal: AbortSignal) {
    if (await this.linked(id, signal)) return
    const accountId = this.account(id)
    if (!accountId) throw new Error('请先登录游戏账户')
    const { capability, fence } = this.lease(signal), pin = this.pin(id), wallet = await this.identity(signal)
    const challenge = parseSigned(
      await this.request(id, '/v1/wallet-bindings/challenge', signal, {}),
      parseWalletChallenge,
    )
    if (
      challenge.payload.gameAccountId !== accountId || !this.sameSource(challenge.payload, pin)
      || !await verifySigned(challenge, pin.servicePublicKey)
    ) throw new Error('钱包关联校验失败')
    const proof = parseSigned(
      JSON.parse(
        this.accepted(
          await capability.bindGameAccount({
            source: pin,
            challenge: canonical(challenge),
            deadline: Date.now() + 120000,
            signal,
          }),
        ),
      ),
      parseWalletBinding,
    )
    fence()
    const { walletId, walletPublicKey, contract: _contract, ...boundChallenge } = proof.payload
    if (
      walletId !== wallet.walletId || walletPublicKey !== wallet.walletPublicKey
      || canonical({ ...boundChallenge, contract: challenge.payload.contract }) !== canonical(challenge.payload)
      || !await verifySigned(proof, wallet.walletPublicKey)
    ) throw new Error('钱包关联校验失败')
    if (this.account(id) !== accountId) throw new Error('游戏账户连接已变化，请重试')
    fence()
    await this.request(id, '/v1/wallet-bindings', signal, proof)
  }
  private sameSource(value: WalletSpendSourceV1, pin: WalletSpendSourceV1) {
    return value.serviceOrigin === pin.serviceOrigin && value.servicePublicKey === pin.servicePublicKey
      && value.serverId === pin.serverId
  }
  private async transaction(id: string, input: unknown, signal: AbortSignal): Promise<Transaction> {
    const record = object(input), terms = parseSigned(record.terms, parseTerms), pin = this.pin(id)
    if (
      !this.sameSource(terms.payload, pin) || !await verifySigned(terms, pin.servicePublicKey)
      || record.termsHash !== await digest(terms.payload)
    ) throw new Error('投入条款校验失败')
    const receipts = object(record.receipts) as Record<string, Signed<SpendReservation>>,
      requestIds = object(record.requestIds) as Record<string, string>
    for (const [accountId, receipt] of Object.entries(receipts)) {
      const parsed = await this.checkReceipt(receipt, terms, String(record.termsHash))
      if (parsed.payload.gameAccountId !== accountId) throw new Error('钱包回执校验失败')
    }
    let decision: Signed<SpendDecision> | null = null
    if (record.decision) {
      decision = parseSigned(record.decision, parseDecision)
      const identity = { ...pin, matchId: terms.payload.matchId, termsHash: record.termsHash }
      if (
        !this.sameSource(decision.payload, pin) || decision.payload.matchId !== terms.payload.matchId
        || decision.payload.termsHash !== record.termsHash
        || decision.payload.decisionId !== 'decision:' + await digest(identity)
        || !await verifySigned(decision, pin.servicePublicKey)
      ) throw new Error('结算决定校验失败')
      for (const entry of decision.payload.entries) {
        await this.checkReceipt(entry.reservation, terms, String(record.termsHash))
      }
      if (
        decision.payload.action === 'capture'
        && (decision.payload.entries.length !== terms.payload.participants.length
          || terms.payload.participants.some(p =>
            !decision!.payload.entries.some(e => e.reservation.payload.gameAccountId === p.gameAccountId)
          ))
      ) throw new Error('结算决定校验失败')
    }
    signal.throwIfAborted()
    return { terms, termsHash: string(record.termsHash), receipts, requestIds, phase: string(record.phase), decision }
  }
  private async checkReceipt(input: unknown, terms: Signed<SpendTerms>, termsHash: string) {
    const receipt = parseSigned(input, parseReservation),
      p = receipt.payload,
      participant = terms.payload.participants.find(row => row.gameAccountId === p.gameAccountId)
    if (
      !participant
      || canonical(participant)
        !== canonical({
          gameAccountId: p.gameAccountId,
          walletId: p.walletId,
          walletPublicKey: p.walletPublicKey,
          amount: p.amount,
        })
      || !this.sameSource(p, terms.payload) || p.matchId !== terms.payload.matchId || p.termsHash !== termsHash
      || !await verifySigned(receipt, p.walletPublicKey)
    ) throw new Error('钱包回执校验失败')
    return receipt
  }
  async quote(seat: Seat, signal: AbortSignal): Promise<FundingQuote> {
    if (seat.walletSpend?.protocol === 'economy.pool/v1') {
      return this.pool.quote(
        seat,
        await this.request(seat.room.sourceId, `/v1/rooms/${encodeURIComponent(seat.room.id)}/spend`, signal),
        signal,
      )
    }
    const id = seat.room.sourceId,
      record = await this.transaction(
        id,
        await this.request(id, `/v1/rooms/${encodeURIComponent(seat.room.id)}/spend`, signal),
        signal,
      ),
      wallet = await this.identity(signal),
      accountId = this.account(id)
    const terms = record.terms.payload,
      own = terms.participants.find(p => p.gameAccountId === accountId),
      seatIds = (seat.ownedSeats ?? []).map(s => s.id).sort()
    if (
      terms.matchId !== seat.matchId || terms.game.id !== seat.room.game.id
      || terms.game.version !== seat.room.game.version || terms.game.digest !== seat.room.game.packageHash || !own
      || own.walletId !== wallet.walletId || own.walletPublicKey !== wallet.walletPublicKey || !seatIds.length
      || own.amount !== seat.room.stake * seatIds.length
    ) throw new Error('投入条款与当前席位不一致')
    const requestId = record.requestIds[own.gameAccountId]
    if (
      requestId
        !== 'spend:' + await digest({ ...this.pin(id), matchId: terms.matchId, termsHash: record.termsHash, ...own })
    ) throw new Error('投入重试标识校验失败')
    return {
      agreementId: terms.matchId,
      termsHash: record.termsHash,
      instanceId: wallet.walletId,
      serviceId: terms.serverId,
      accountId: own.gameAccountId,
      amount: own.amount,
      seatIds,
      expiresAt: terms.acceptBefore,
      reserved: !!record.receipts[own.gameAccountId],
      policy: terms.policy,
      participants: terms.participants.map(p => ({
        accountId: p.gameAccountId,
        amount: p.amount,
        seatIds: p.gameAccountId === own.gameAccountId ? seatIds : [],
      })),
      signedTerms: record.terms,
      requestId,
    }
  }
  async reserve(seat: Seat, quote: FundingQuote, signal: AbortSignal) {
    if (quote.poolTerms) return this.pool.reserve(seat, quote, signal)
    const current = await this.quote(seat, signal)
    if (canonical(current) !== canonical(quote) || !current.signedTerms || !current.requestId) {
      throw new Error('投入条款已变化，请重新确认')
    }
    const id = seat.room.sourceId,
      accountId = this.account(id),
      { capability, fence } = this.lease(signal),
      source = this.pin(id),
      operation = { source, deadline: Date.now() + 120000, signal }
    let hold = this.accepted(await capability.lookup({ ...operation, requestId: current.requestId }))
    fence()
    if (!hold) {
      hold = this.accepted(
        await capability.reserve({ ...operation, terms: canonical(current.signedTerms), requestId: current.requestId }),
      )
    }
    fence()
    const receipt = await this.checkReceipt(JSON.parse(hold.reservation), current.signedTerms, current.termsHash)
    fence()
    if (receipt.payload.gameAccountId !== accountId || this.account(id) !== accountId) {
      throw new Error('游戏账户连接已变化，请重试')
    }
    const response = object(
      await this.request(id, `/v1/rooms/${encodeURIComponent(seat.room.id)}/spend-receipts`, signal, receipt),
    )
    await this.apply(id, await this.transaction(id, response.transaction, signal), signal)
  }
  private async apply(id: string, record: Transaction, signal: AbortSignal) {
    if (!record.decision || this.delivered.has(canonical(record.decision))) return
    const { capability, fence } = this.lease(signal)
    const wallet = await this.identity(signal)
    const result = this.accepted(
      await capability.applyDecision({
        source: this.pin(id),
        decision: canonical(record.decision),
        deadline: Date.now() + 120000,
        signal,
      }),
    )
    fence()
    for (const row of result) {
      const receipt = await this.checkReceipt(JSON.parse(row.reservation), record.terms, record.termsHash)
      if (
        receipt.payload.walletId !== wallet.walletId || receipt.payload.walletPublicKey !== wallet.walletPublicKey
        || row.state === 'pending' || !row.settlement
      ) throw new Error('结算回执校验失败')
      if (row.settlement) {
        const settlement = parseSigned(JSON.parse(row.settlement), parseSettlement)
        if (
          settlement.payload.reservationId !== receipt.payload.reservationId
          || settlement.payload.walletId !== receipt.payload.walletId
          || settlement.payload.amount !== receipt.payload.amount
          || settlement.payload.decisionId !== record.decision.payload.decisionId
          || settlement.payload.decisionHash !== await digest(record.decision.payload)
          || settlement.payload.captured + settlement.payload.released !== receipt.payload.amount
          || settlement.payload.captured !== (record.decision.payload.action === 'capture'
              ? record.decision.payload.entries.find(e =>
                e.reservation.payload.reservationId === receipt.payload.reservationId
              )?.captureAmount
              : 0)
          || row.state !== (record.decision.payload.action === 'capture' ? 'captured' : 'refunded')
          || !await verifySigned(settlement, receipt.payload.walletPublicKey)
        ) throw new Error('结算回执校验失败')
      }
    }
    this.delivered.add(canonical(record.decision))
  }

  async recover(id: string, signal: AbortSignal) {
    if (!this.available(id) || !this.account(id)) return
    const response = object(await this.request(id, '/v1/me/spend-transactions', signal))
    for (const entry of array(response.transactions)) {
      const value = object(entry)
      if (
        object(object(value.transaction).terms).payload
        && object(object(object(value.transaction).terms).payload).contract === 'economy.pool-terms/v1'
      ) {
        await this.pool.recover(id, string(value.roomId), value.transaction, signal)
        continue
      }
      let record = await this.transaction(id, value.transaction, signal)
      if (!record.decision) {
        const latest = await this.transaction(
          id,
          await this.request(id, `/v1/rooms/${encodeURIComponent(string(value.roomId))}/spend`, signal),
          signal,
        )
        if (latest.terms.payload.matchId !== record.terms.payload.matchId) throw new Error('对局已变化，请重新读取记录')
        record = latest
      }
      await this.apply(id, record, signal)
      if (record.decision) continue
      const accountId = this.account(id)!, requestId = record.requestIds[accountId]
      if (!requestId) continue
      const { capability, fence } = this.lease(signal)
      const hold = this.accepted(
        await capability.lookup({ source: this.pin(id), requestId, deadline: Date.now() + 120000, signal }),
      )
      fence()
      if (hold && !record.receipts[accountId]) {
        const receipt = await this.checkReceipt(JSON.parse(hold.reservation), record.terms, record.termsHash)
        fence()
        if (receipt.payload.gameAccountId !== accountId || this.account(id) !== accountId) {
          throw new Error('游戏账户连接已变化，请重试')
        }
        const latest = object(
          await this.request(
            id,
            `/v1/rooms/${encodeURIComponent(string(value.roomId))}/spend-receipts`,
            signal,
            receipt,
          ),
        )
        await this.apply(id, await this.transaction(id, latest.transaction, signal), signal)
      }
    }
  }
}
