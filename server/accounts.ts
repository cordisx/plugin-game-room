import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { GameStore as Store } from './store-contract.js'
import { ApiError, requireThat } from './errors.js'
export interface Account {
  id: string
  name: string
  guest?: boolean
  economyId?: string
}
interface AccountRow {
  id: string
  name: string
  salt: string
  password: string
  economy_id: string | null
  managed?: number
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export class Accounts {
  constructor(private store: Store, private now: () => number) {}
  async guest() {
    return this.store.atomic(async () => {
      const id = this.store.id('guest')
      const name = `guest_${randomBytes(12).toString('hex')}`
      await this.store.db.prepare('INSERT INTO accounts(id,name,salt,password) VALUES (?,?,?,?)').run(
        id,
        name,
        randomBytes(16).toString('hex'),
        randomBytes(64).toString('hex'),
      )
      return await this.session({ id, name, guest: true })
    })
  }
  credentials(name: unknown, password: unknown) {
    requireThat(typeof name === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(name))
    requireThat(typeof password === 'string' && password.length >= 12 && password.length <= 256)
    return { name: name.toLowerCase(), password }
  }
  async register(name: unknown, password: unknown) {
    return this.store.atomic(async () => {
      const c = this.credentials(name, password)
      requireThat(
        !await this.store.db.prepare('SELECT id FROM accounts WHERE name=?').get(c.name),
        'account_exists',
        409,
      )
      const salt = randomBytes(16).toString('hex')
      const id = this.store.id('account')
      await this.store.db.prepare('INSERT INTO accounts(id,name,salt,password) VALUES (?,?,?,?)').run(
        id,
        c.name,
        salt,
        scryptSync(c.password, salt, 64).toString('hex'),
      )
      return await this.session({ id, name: c.name })
    })
  }
  async login(name: unknown, password: unknown) {
    const c = this.credentials(name, password)
    const row = await this.store.db.prepare('SELECT * FROM accounts WHERE name=?').get(c.name) as unknown as
      | AccountRow
      | undefined
    const calculated = scryptSync(c.password, row?.salt ?? 'dummy-salt', 64)
    requireThat(row && timingSafeEqual(calculated, Buffer.from(row.password, 'hex')), 'invalid_credentials', 401)
    return await this.session({ id: row.id, name: row.name })
  }
  /** Called only after a provisioned Host assertion was verified and its nonce consumed. */
  async managedLogin(issuer: string, subject: string, previousToken?: string, consume?: () => Promise<void>) {
    requireThat(
      /^[a-f0-9]{64}$/u.test(issuer) && /^codex:[A-Za-z0-9_-]{43}$/u.test(subject),
      'invalid_managed_identity',
    )
    return await this.store.atomic(async () => {
      await consume?.()
      const prior = await this.store.db.prepare(
        'SELECT account_id FROM managed_identities WHERE issuer=? AND subject=?',
      ).get(issuer, subject) as {
        account_id: string
      } | undefined
      let previous: Account | undefined
      if (previousToken !== undefined) {
        try {
          previous = await this.authenticate(previousToken)
        } catch (error) {
          // A verified existing subject can recover a lost upgrade reply using a fresh nonce.
          // An invalid credential never permits adopting an unmapped guest or another account.
          if (!prior || !(error instanceof ApiError) || error.code !== 'invalid_session') {
            throw error
          }
        }
      }
      if (prior) {
        requireThat(!previous || previous.id === prior.account_id, 'managed_account_conflict', 409)
        const account = await this.store.db.prepare('SELECT * FROM accounts WHERE id=?').get(
          prior.account_id,
        ) as unknown as AccountRow
        return await this.session({
          id: account.id,
          name: account.name,
          guest: false,
          ...(account.economy_id ? { economyId: account.economy_id } : {}),
        })
      }
      requireThat(!previous || previous.guest === true, 'managed_account_conflict', 409)
      const account = previous ?? { id: this.store.id('account'), name: 'codex_' + randomBytes(16).toString('hex') }
      if (!previous) {
        await this.store.db.prepare('INSERT INTO accounts(id,name,salt,password) VALUES (?,?,?,?)').run(
          account.id,
          account.name,
          randomBytes(16).toString('hex'),
          randomBytes(64).toString('hex'),
        )
      }
      await this.store.db.prepare('INSERT INTO managed_identities VALUES (?,?,?)').run(issuer, subject, account.id)
      // Existing guest history keeps the same immutable owner ID. No account or history merge occurs.
      if (previousToken !== undefined) {
        await this.store.db.prepare('DELETE FROM sessions WHERE account_id=?').run(account.id)
      }
      return await this.session({ ...account, guest: false })
    })
  }
  private async session(account: Account) {
    const token = randomBytes(32).toString('base64url')
    await this.store.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      digest(token),
      account.id,
      this.now() + 30 * 86400000,
    )
    return { account, token }
  }
  async authenticate(token: string | undefined): Promise<Account> {
    if (!token) {
      throw new ApiError(401, 'authentication_required')
    }
    const row = await this.store.db.prepare(
      'SELECT a.*, EXISTS(SELECT 1 FROM managed_identities m WHERE m.account_id=a.id) AS managed FROM accounts a JOIN sessions s ON a.id=s.account_id WHERE s.hash=? AND s.expires>?',
    ).get(digest(token), this.now()) as unknown as AccountRow | undefined
    requireThat(row, 'invalid_session', 401)
    return {
      id: row.id,
      name: row.name,
      guest: !row.managed && row.id.startsWith(`${this.store.serverId}:guest:`),
      ...(row.economy_id ? { economyId: row.economy_id } : {}),
    }
  }
  async isGuest(accountId: string) {
    return accountId.startsWith(`${this.store.serverId}:guest:`)
      && !await this.store.db.prepare('SELECT 1 FROM managed_identities WHERE account_id=?').get(accountId)
  }
  async revoke(token: string) {
    await this.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token))
  }
}
