import { randomBytes } from 'node:crypto'
import { type Account, digest } from './accounts.js'
import type { Engine } from './engine.js'
import { integer, object, requireThat } from './errors.js'
interface Grant {
  id: string
  hash: string
  room_id: string
  match_id: string
  seat_id: string
  account_id: string
  expires: number
  max_actions: number
  used: number
  revoked: number
}
export class Grants {
  constructor(private engine: Engine) {
    engine.store.db.exec(
      'CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, room_id TEXT NOT NULL, match_id TEXT NOT NULL, seat_id TEXT NOT NULL, account_id TEXT NOT NULL, expires INTEGER NOT NULL, max_actions INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0)',
    )
  }
  create(account: Account, id: string, input: unknown) {
    object(input)
    const room = this.engine.load(id)
    requireThat(typeof input.seatId === 'string')
    const index = this.engine.seat(room, account.id, input.seatId)
    requireThat(room.allowAgents, 'agents_not_allowed', 403)
    requireThat(input.seatId === room.seats[index].id, 'seat_scope_mismatch', 403)
    requireThat(['waiting', 'funding', 'playing'].includes(room.status), 'match_not_active', 409)
    requireThat(integer(input.expiresAt, this.engine.now() + 1000, this.engine.now() + 24 * 3600000))
    requireThat(integer(input.maxActions, 1, 10000))
    const token = randomBytes(32).toString('base64url')
    const grantId = this.engine.store.id('grant')
    this.engine.store.db.prepare(
      'INSERT INTO grants(id,hash,room_id,match_id,seat_id,account_id,expires,max_actions) VALUES (?,?,?,?,?,?,?,?)',
    ).run(grantId, digest(token), id, room.matchId, input.seatId, account.id, input.expiresAt, input.maxActions)
    return {
      grantId,
      token,
      serverId: room.serverId,
      roomId: id,
      matchId: room.matchId,
      seatId: input.seatId,
      accountId: account.id,
      expiresAt: input.expiresAt,
      maxActions: input.maxActions,
    }
  }
  authenticate(token: string | undefined, allowRevoked = false): Grant {
    requireThat(token, 'authentication_required', 401)
    const grant = this.engine.store.db.prepare('SELECT * FROM grants WHERE hash=?').get(digest(token)) as unknown as
      | Grant
      | undefined
    requireThat(grant, 'invalid_grant', 401)
    if (!allowRevoked) {
      requireThat(!grant.revoked, 'grant_revoked', 403)
      requireThat(grant.expires > this.engine.now(), 'grant_expired', 403)
      const room = this.engine.load(grant.room_id)
      requireThat(
        room.matchId === grant.match_id
          && room.seats.some(s => s.id === grant.seat_id && s.accountId === grant.account_id),
        'grant_scope_changed',
        403,
      )
    }
    return grant
  }
  consume(grant: Grant) {
    const result = this.engine.store.db.prepare(
      'UPDATE grants SET used=used+1 WHERE id=? AND used<max_actions AND revoked=0 AND expires>?',
    ).run(grant.id, this.engine.now())
    requireThat(result.changes === 1, 'grant_budget_exhausted', 403)
  }
  revoke(account: Account, roomId: string, grantId: string) {
    const grant = this.engine.store.db.prepare('SELECT * FROM grants WHERE id=? AND room_id=?').get(
      grantId,
      roomId,
    ) as unknown as Grant | undefined
    requireThat(grant && grant.account_id === account.id, 'grant_not_found', 404)
    this.engine.store.db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run(grant.id)
    return { revoked: true }
  }
  selfRevoke(token: string | undefined) {
    const grant = this.authenticate(token, true)
    this.engine.store.db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run(grant.id)
    return { revoked: true }
  }
}
