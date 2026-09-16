import { randomBytes } from 'node:crypto'
import { type Account, digest } from './accounts.js'
import type { Engine } from './engine.js'
import { writableRoom } from './legacy-transactions.js'
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
  }
  async create(account: Account, id: string, input: unknown) {
    return this.engine.store.atomic(async () => {
      object(input)
      const room = writableRoom(await this.engine.load(id))
      requireThat(typeof input.seatId === 'string')
      const index = this.engine.seat(room, account.id, input.seatId)
      requireThat(room.allowAgents, 'agents_not_allowed', 403)
      requireThat(input.seatId === room.seats[index].id, 'seat_scope_mismatch', 403)
      requireThat(['waiting', 'funding', 'playing'].includes(room.status), 'match_not_active', 409)
      requireThat(integer(input.expiresAt, this.engine.now() + 1000, this.engine.now() + 24 * 3600000))
      requireThat(integer(input.maxActions, 1, 10000))
      const token = randomBytes(32).toString('base64url')
      const grantId = this.engine.store.id('grant')
      await this.engine.store.db.prepare(
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
    })
  }
  async authenticate(token: string | undefined, allowRevoked = false): Promise<Grant> {
    requireThat(token, 'authentication_required', 401)
    const grant = await this.engine.store.db.prepare('SELECT * FROM grants WHERE hash=?').get(
      digest(token),
    ) as unknown as Grant | undefined
    requireThat(grant, 'invalid_grant', 401)
    if (!allowRevoked) {
      requireThat(!grant.revoked, 'grant_revoked', 403)
      requireThat(grant.expires > this.engine.now(), 'grant_expired', 403)
      const room = await this.engine.load(grant.room_id)
      requireThat(
        room.matchId === grant.match_id
          && room.seats.some(s => s.id === grant.seat_id && s.accountId === grant.account_id),
        'grant_scope_changed',
        403,
      )
    }
    return grant
  }
  async consume(grant: Grant) {
    await this.engine.store.requireChanges(
      "UPDATE grants SET used=used+1 WHERE id=? AND used<max_actions AND revoked=0 AND expires>? AND EXISTS(SELECT 1 FROM rooms WHERE rooms.id=grants.room_id AND json_extract(rooms.body,'$.matchId')=grants.match_id)",
      [grant.id, this.engine.now()],
      1,
      'grant_budget_exhausted',
    )
  }
  async revoke(account: Account, roomId: string, grantId: string) {
    const grant = await this.engine.store.db.prepare('SELECT * FROM grants WHERE id=? AND room_id=?').get(
      grantId,
      roomId,
    ) as unknown as Grant | undefined
    requireThat(grant && grant.account_id === account.id, 'grant_not_found', 404)
    await this.engine.store.db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run(grant.id)
    return { revoked: true }
  }
  async selfRevoke(token: string | undefined) {
    const grant = await this.authenticate(token, true)
    await this.engine.store.db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run(grant.id)
    return { revoked: true }
  }
}
