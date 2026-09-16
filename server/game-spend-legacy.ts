import { randomBytes } from 'node:crypto'
import {
  canonical,
  digest,
  parseDecision,
  parseReservation,
  parseSigned,
  parseTerms,
  parseWalletBinding,
  type Signed,
  type SpendDecision,
  type SpendReservation,
  type SpendTerms,
  verifySigned,
  type WalletBinding,
  type WalletChallenge,
} from '@cordisx/economy/spend'
import type { GameStore } from './store-contract.js'
import type { Room } from './engine.js'
import type { Account } from './accounts.js'
import { ApiError, requireThat } from './errors.js'
import { GameServiceKey } from './game-service-key.js'
export interface LegacyGameSpendRecord {
  terms: Signed<SpendTerms>
  termsHash: string
  requestIds: Record<string, string>
  receipts: Record<string, Signed<SpendReservation>>
  phase: 'funding' | 'active' | 'capture' | 'refund'
  decision: Signed<SpendDecision> | null
}
/** Game owns declarations and durable finality, never wallet custody or a wallet HTTP client. */
function signedInput<T>(input: unknown, parser: (input: unknown) => T): Signed<T> {
  try {
    return parseSigned(input, parser)
  } catch {
    throw new ApiError(400, 'invalid_spend_payload')
  }
}
export class LegacyGameSpend {
  constructor(readonly store: GameStore, readonly service: GameServiceKey, readonly now = Date.now) {}
  async challenge(account: Account) {
    await this.service.pin(this.store)
    const payload: WalletChallenge = {
      contract: 'economy.spend-wallet-challenge/v1',
      ...this.service.binding(),
      gameAccountId: account.id,
      nonce: randomBytes(32).toString('hex'),
      expiresAt: this.now() + 180000,
    }
    const signed = this.service.sign(payload)
    await this.store.db.prepare('INSERT INTO game_wallet_challenges VALUES (?,?,?,?)').run(
      payload.nonce,
      account.id,
      payload.expiresAt,
      canonical(signed),
    )
    return signed
  }
  async wallet(accountId: string): Promise<Signed<WalletBinding> | undefined> {
    const row = await this.store.db.prepare('SELECT body FROM game_wallet_bindings WHERE account_id=?').get(accountId)
    return row ? parseSigned(JSON.parse(String(row.body)), parseWalletBinding) : undefined
  }
  async bind(account: Account, input: unknown) {
    const signed = signedInput(input, parseWalletBinding), binding = signed.payload
    const { walletId: _walletId, walletPublicKey: _walletKey, contract: _contract, ...challenge } = binding
    requireThat(
      binding.gameAccountId === account.id
        && canonical({
            serviceOrigin: binding.serviceOrigin,
            servicePublicKey: binding.servicePublicKey,
            serverId: binding.serverId,
          }) === canonical(this.service.binding()),
      'wallet_binding_mismatch',
      403,
    )
    requireThat(await verifySigned(signed, binding.walletPublicKey), 'invalid_wallet_signature', 403)
    return this.store.atomic(async () => {
      const prior = await this.wallet(account.id)
      if (prior && canonical(prior) === canonical(signed)) return prior
      requireThat(binding.expiresAt > this.now(), 'invalid_wallet_challenge', 403)
      const known = await this.store.db.prepare(
        'SELECT body FROM game_wallet_challenges WHERE nonce=? AND account_id=?',
      ).get(binding.nonce, account.id)
      requireThat(
        known
          && canonical(JSON.parse(String(known.body)).payload)
            === canonical({ ...challenge, contract: 'economy.spend-wallet-challenge/v1' }),
        'invalid_wallet_challenge',
        403,
      )
      requireThat(
        !prior
          || prior.payload.walletId === binding.walletId && prior.payload.walletPublicKey === binding.walletPublicKey,
        'wallet_key_changed',
        409,
      )
      await this.store.requireChanges(
        'DELETE FROM game_wallet_challenges WHERE nonce=? AND account_id=? AND expires>?',
        [binding.nonce, account.id, this.now()],
        1,
        'invalid_wallet_challenge',
      )
      if (!prior) {
        await this.store.db.prepare('INSERT INTO game_wallet_bindings VALUES (?,?)').run(account.id, canonical(signed))
      }
      return prior ?? signed
    })
  }
  async prepare(room: Room): Promise<LegacyGameSpendRecord> {
    await this.service.pin(this.store)
    const accounts = [...new Set(room.seats.map(seat => seat.accountId))]
    const participants = await Promise.all(accounts.map(async gameAccountId => {
      const binding = await this.wallet(gameAccountId)
      requireThat(binding, 'wallet_binding_required', 409)
      return {
        gameAccountId,
        walletId: binding.payload.walletId,
        walletPublicKey: binding.payload.walletPublicKey,
        amount: room.stake * room.seats.filter(seat => seat.accountId === gameAccountId).length,
      }
    }))
    requireThat(
      new Set(participants.map(p => p.walletId)).size === participants.length,
      'wallet_already_participating',
      409,
    )
    const payload = parseTerms({
      contract: 'economy.spend-terms/v1',
      ...this.service.binding(),
      matchId: room.matchId,
      game: {
        id: room.manifest.id,
        version: room.manifest.version,
        digest: room.packageHash,
        reviewStatus: room.reviewState,
      },
      participants,
      policy: 'capture-and-release',
      acceptBefore: this.now() + 600000,
    })
    const termsHash = await digest(payload)
    const requestIds = Object.fromEntries(
      await Promise.all(
        participants.map(
          async participant => [
            participant.gameAccountId,
            'spend:' + await digest({ ...this.service.binding(), matchId: room.matchId, termsHash, ...participant }),
          ],
        ),
      ),
    )
    return { terms: this.service.sign(payload), termsHash, requestIds, receipts: {}, phase: 'funding', decision: null }
  }
  async load(matchId: string): Promise<LegacyGameSpendRecord> {
    const row = await this.store.db.prepare('SELECT body FROM game_spend_transactions WHERE match_id=?').get(matchId)
    requireThat(row, 'spend_transaction_not_found', 404)
    return JSON.parse(String(row.body))
  }
  async transactions(accountId: string) {
    const rows = await this.store.db.prepare(
      'SELECT t.room_id,t.body FROM game_spend_transactions t JOIN game_spend_participants p ON t.match_id=p.match_id WHERE p.account_id=?',
    ).all(accountId)
    return rows.flatMap(row => {
      const transaction = JSON.parse(String(row.body)) as LegacyGameSpendRecord
      return transaction.terms.payload.participants.some(p => p.gameAccountId === accountId)
        ? [{ roomId: String(row.room_id), transaction }]
        : []
    })
  }
  async ownedTransaction(accountId: string, matchId: string) {
    const transaction = await this.load(matchId)
    requireThat(transaction.terms.payload.participants.some(p => p.gameAccountId === accountId), 'not_participant', 403)
    return transaction
  }
  async accept(account: Account, record: LegacyGameSpendRecord, input: unknown) {
    const receipt = signedInput(input, parseReservation), p = receipt.payload
    const participant = record.terms.payload.participants.find(participant => participant.gameAccountId === account.id)
    requireThat(
      participant
        && canonical({
            gameAccountId: p.gameAccountId,
            walletId: p.walletId,
            walletPublicKey: p.walletPublicKey,
            amount: p.amount,
          }) === canonical(participant)
        && p.matchId === record.terms.payload.matchId && p.termsHash === record.termsHash
        && p.serviceOrigin === this.service.origin && p.servicePublicKey === this.service.publicKey
        && p.serverId === this.service.serverId,
      'reservation_binding_mismatch',
      403,
    )
    requireThat(await verifySigned(receipt, participant.walletPublicKey), 'invalid_reservation_signature', 403)
    const prior = record.receipts[account.id]
    requireThat(!prior || canonical(prior) === canonical(receipt), 'reservation_conflict', 409)
    if (record.decision || prior) return false
    requireThat(
      record.phase === 'funding' && this.now() < record.terms.payload.acceptBefore,
      'spend_admission_closed',
      409,
    )
    requireThat(
      !Object.values(record.receipts).some(other =>
        other.payload.reservationId === p.reservationId || other.payload.nonce === p.nonce
      ),
      'reservation_conflict',
      409,
    )
    record.receipts[account.id] = receipt
    return true
  }
  complete(record: LegacyGameSpendRecord) {
    return record.terms.payload.participants.every(p => record.receipts[p.gameAccountId])
  }
  async final(record: LegacyGameSpendRecord, action: 'capture' | 'refund') {
    if (record.decision) {
      requireThat(record.decision.payload.action === action, 'spend_already_final', 409)
      return
    }
    requireThat(action !== 'capture' || record.phase === 'active' && this.complete(record), 'spend_not_active', 409)
    const identity = { ...this.service.binding(), matchId: record.terms.payload.matchId, termsHash: record.termsHash }
    const entries = record.terms.payload.participants.flatMap(participant => {
      const reservation = record.receipts[participant.gameAccountId]
      return reservation ? [{ reservation, captureAmount: action === 'capture' ? participant.amount : 0 }] : []
    })
    const payload = parseDecision({
      contract: 'economy.spend-decision/v1',
      ...identity,
      decisionId: 'decision:' + await digest(identity),
      action,
      entries,
    })
    record.phase = action
    record.decision = this.service.sign(payload)
  }
  /** Called exclusively inside the same transaction as the corresponding room/event/command write. */
  async write(roomId: string, record: LegacyGameSpendRecord) {
    const prior = await this.store.db.prepare('SELECT body FROM game_spend_transactions WHERE match_id=?').get(
      record.terms.payload.matchId,
    )
    if (prior) {
      const previous = JSON.parse(String(prior.body)) as LegacyGameSpendRecord
      requireThat(
        previous.termsHash === record.termsHash && canonical(previous.terms) === canonical(record.terms),
        'immutable_spend_terms',
        409,
      )
      requireThat(previous.phase !== 'active' || record.phase !== 'funding', 'spend_phase_conflict', 409)
      requireThat(
        Object.entries(previous.receipts).every(([account, receipt]) =>
          canonical(record.receipts[account]) === canonical(receipt)
        ),
        'reservation_conflict',
        409,
      )
      requireThat(
        !previous.decision || canonical(previous.decision) === canonical(record.decision),
        'spend_already_final',
        409,
      )
    }
    if (!prior) {
      for (const p of record.terms.payload.participants) {
        await this.store.db.prepare('INSERT INTO game_spend_participants VALUES (?,?)').run(
          p.gameAccountId,
          record.terms.payload.matchId,
        )
      }
    }
    await this.store.db.prepare(
      'INSERT INTO game_spend_transactions VALUES (?,?,?) ON CONFLICT(match_id) DO UPDATE SET body=excluded.body',
    ).run(record.terms.payload.matchId, roomId, canonical(record))
  }
}
