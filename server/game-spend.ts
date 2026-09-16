import { canonical, digest, parseSigned, type Signed, verifySigned } from '@cordisx/economy/spend'
import {
  parsePoolDecision,
  parsePoolReservation,
  parsePoolTerms,
  type PoolDecision,
  type PoolReservation,
  type PoolTerms,
} from '@cordisx/economy/pool'
import { allocateTokenPool } from '../sdk/pool-allocation.js'
import type { Account } from './accounts.js'
import type { Room } from './engine.js'
import { requireThat } from './errors.js'
import { LegacyGameSpend, type LegacyGameSpendRecord } from './game-spend-legacy.js'
import type { GameServiceKey } from './game-service-key.js'
import type { GameStore } from './store-contract.js'
export interface GamePoolRecord {
  terms: Signed<PoolTerms>
  termsHash: string
  requestIds: Record<string, string>
  receipts: Record<string, Signed<PoolReservation>>
  phase: 'funding' | 'active' | 'capture' | 'refund'
  decision: Signed<PoolDecision> | null
  decisions: Signed<PoolDecision>[]
}
export type GameSpendRecord = LegacyGameSpendRecord | GamePoolRecord
export const isPool = (r: GameSpendRecord): r is GamePoolRecord => 'decisions' in r
/** Old transactions can recover; all newly prepared games use separately versioned pool terms. */
export class GameSpend {
  private readonly legacy: LegacyGameSpend
  constructor(readonly store: GameStore, readonly service: GameServiceKey, readonly now = Date.now) {
    this.legacy = new LegacyGameSpend(store, service, now)
  }
  challenge(account: Account) {
    return this.legacy.challenge(account)
  }
  wallet(accountId: string) {
    return this.legacy.wallet(accountId)
  }
  async requirePoolWallet(accountId: string) {
    const binding = await this.wallet(accountId)
    requireThat(binding, 'wallet_binding_required', 409)
    requireThat(
      this.service.trustedWalletPublicKeys.has(binding.payload.walletPublicKey),
      'wallet_authority_not_enrolled',
      403,
    )
  }
  bind(account: Account, input: unknown) {
    return this.legacy.bind(account, input)
  }
  async prepare(room: Room): Promise<GamePoolRecord> {
    requireThat(room.seats.every(s => s.kind !== 'bot'), 'token_bot_unfunded', 409)
    const old = await this.legacy.prepare(room)
    requireThat(
      old.terms.payload.participants.every(p => this.service.trustedWalletPublicKeys.has(p.walletPublicKey)),
      'wallet_authority_not_enrolled',
      403,
    )
    const terms = parsePoolTerms({
      ...old.terms.payload,
      contract: 'economy.pool-terms/v1',
      policy: room.policy === 'conserved-payouts-v1' ? 'remaining-chips' : 'winner-weights',
      rounds: Number((room.config as Record<string, unknown>).rounds ?? 1),
    })
    const termsHash = await digest(terms)
    const requestIds = Object.fromEntries(
      await Promise.all(
        terms.participants.map(
          async p => [
            p.gameAccountId,
            'pool:' + await digest({ ...this.service.binding(), matchId: room.matchId, termsHash, ...p }),
          ],
        ),
      ),
    )
    return {
      terms: this.service.sign(terms),
      termsHash,
      requestIds,
      receipts: {},
      phase: 'funding',
      decision: null,
      decisions: [],
    }
  }
  async load(matchId: string): Promise<GameSpendRecord> {
    return await this.legacy.load(matchId) as GameSpendRecord
  }
  async transactions(accountId: string) {
    return await this.legacy.transactions(accountId) as { roomId: string; transaction: GameSpendRecord }[]
  }
  async ownedTransaction(accountId: string, matchId: string) {
    const record = await this.load(matchId)
    requireThat(record.terms.payload.participants.some(p => p.gameAccountId === accountId), 'not_participant', 403)
    return record
  }
  complete(record: GameSpendRecord) {
    return record.terms.payload.participants.every(p => record.receipts[p.gameAccountId])
  }
  async accept(account: Account, record: GameSpendRecord, input: unknown) {
    if (!isPool(record)) return this.legacy.accept(account, record, input)
    const receipt = parseSigned(input, parsePoolReservation), p = receipt.payload, t = record.terms.payload
    const own = t.participants.find(p => p.gameAccountId === account.id)
    requireThat(
      own
        && canonical(own)
          === canonical({
            gameAccountId: p.gameAccountId,
            walletId: p.walletId,
            walletPublicKey: p.walletPublicKey,
            amount: p.amount,
          })
        && p.termsHash === record.termsHash && p.matchId === t.matchId
        && p.serviceOrigin === t.serviceOrigin && p.servicePublicKey === t.servicePublicKey
        && p.serverId === t.serverId,
      'reservation_binding_mismatch',
      403,
    )
    requireThat(await verifySigned(receipt, own.walletPublicKey), 'invalid_reservation_signature', 403)
    const prior = record.receipts[account.id]
    requireThat(!prior || canonical(prior) === canonical(receipt), 'reservation_conflict', 409)
    if (record.decision || prior) return false
    requireThat(record.phase === 'funding' && this.now() < t.acceptBefore, 'spend_admission_closed', 409)
    record.receipts[account.id] = receipt
    return true
  }
  private async decision(
    record: GamePoolRecord,
    allocations: PoolDecision['allocations'],
    phase: PoolDecision['phase'],
    result: unknown,
  ) {
    const previous = record.decisions.at(-1)
    requireThat(!previous || previous.payload.phase === 'active', 'spend_already_final', 409)
    requireThat(
      !previous
        || previous.payload.allocations.every((a, i) => !a.exited || canonical(a) === canonical(allocations[i])),
      'cashout_changed',
      409,
    )
    const total = record.terms.payload.participants.reduce((n, p) => n + p.amount, 0)
    const payload = parsePoolDecision({
      contract: 'economy.pool-decision/v1',
      terms: record.terms,
      sequence: record.decisions.length + 1,
      previousHash: previous ? await digest(previous.payload) : null,
      phase,
      reservations: record.terms.payload.participants.flatMap(p =>
        record.receipts[p.gameAccountId] ? [record.receipts[p.gameAccountId]] : []
      ),
      allocations,
      remaining: total - allocations.reduce((n, a) => n + a.paid, 0),
      resultHash: await digest(result),
    })
    const signed = this.service.sign(payload)
    record.decisions.push(signed)
    return signed
  }
  async checkpoint(record: GameSpendRecord, room: Room) {
    if (!isPool(record) || record.phase !== 'active' || !room.cashouts) return
    requireThat(
      record.terms.payload.policy === 'remaining-chips' && this.complete(record),
      'invalid_cashout_policy',
      409,
    )
    const allocations = record.terms.payload.participants.map(p => {
      const indices = room.seats.flatMap((s, i) => s.accountId === p.gameAccountId ? [i] : [])
      const exited = indices.length > 0 && indices.every(i => room.cashouts![i] !== null)
      return { walletId: p.walletId, paid: exited ? indices.reduce((n, i) => n + room.cashouts![i]!, 0) : 0, exited }
    })
    if (
      !allocations.some(a => a.exited)
      || canonical(record.decisions.at(-1)?.payload.allocations ?? []) === canonical(allocations)
    ) return
    await this.decision(record, allocations, 'active', { version: room.version, cashouts: room.cashouts })
  }
  async final(record: GameSpendRecord, action: 'capture' | 'refund', room?: Room) {
    if (!isPool(record)) return this.legacy.final(record, action)
    if (record.decision) {
      requireThat(record.phase === action, 'spend_already_final', 409)
      return
    }
    requireThat(
      action === 'refund' || record.phase === 'active' && this.complete(record) && room?.result,
      'spend_not_active',
      409,
    )
    // Once any player has cashed out, principal refunds would undo realized game results.
    requireThat(action !== 'refund' || record.decisions.length === 0, 'pool_requires_final_result', 409)
    const t = record.terms.payload
    let payouts = t.participants.map(p => p.amount)
    if (action === 'capture') {
      const result = room!.result!
      const seatWeights = t.policy === 'remaining-chips'
        ? result.payouts
        : room!.seats.map((_, i) => result.winners.includes(i) ? 1 : 0)
      requireThat(
        seatWeights && seatWeights.length === room!.seats.length
          && seatWeights.every(n => Number.isSafeInteger(n) && n >= 0),
        'invalid_pool_result',
        409,
      )
      const weights = t.participants.map(p =>
        room!.seats.reduce((n, s, i) => n + (s.accountId === p.gameAccountId ? seatWeights[i] : 0), 0)
      )
      if (t.policy === 'remaining-chips') {
        requireThat(
          weights.reduce((a, b) => a + b, 0) === payouts.reduce((a, b) => a + b, 0),
          'pool_not_conserved',
          409,
        )
        payouts = weights
      } else {payouts = allocateTokenPool(
          payouts,
          weights.some(Boolean) ? { kind: 'weighted', weights } : { kind: 'refund' },
        )}
    }
    record.decision = await this.decision(
      record,
      t.participants.map((p, i) => ({ walletId: p.walletId, paid: payouts[i], exited: true })),
      action === 'refund' ? 'refunded' : 'finished',
      room?.result ?? { reason: 'cancelled' },
    )
    record.phase = action
  }
  async write(roomId: string, record: GameSpendRecord) {
    if (!isPool(record)) return this.legacy.write(roomId, record)
    const row = await this.store.db.prepare('SELECT body FROM game_spend_transactions WHERE match_id=?').get(
      record.terms.payload.matchId,
    )
    if (row) {
      const old = JSON.parse(String(row.body)) as GameSpendRecord
      requireThat(isPool(old) && canonical(old.terms) === canonical(record.terms), 'immutable_spend_terms', 409)
      requireThat(
        Object.entries(old.receipts).every(([id, r]) => canonical(record.receipts[id]) === canonical(r)),
        'reservation_conflict',
        409,
      )
      requireThat(
        old.decisions.every((d, i) => canonical(d) === canonical(record.decisions[i])),
        'spend_already_final',
        409,
      )
      requireThat(!old.decision || canonical(old.decision) === canonical(record.decision), 'spend_already_final', 409)
    } else {for (const p of record.terms.payload.participants) {
        await this.store.db.prepare('INSERT INTO game_spend_participants VALUES (?,?)').run(
          p.gameAccountId,
          record.terms.payload.matchId,
        )
      }}
    await this.store.db.prepare(
      'INSERT INTO game_spend_transactions VALUES (?,?,?) ON CONFLICT(match_id) DO UPDATE SET body=excluded.body',
    )
      .run(record.terms.payload.matchId, roomId, canonical(record))
  }
}
