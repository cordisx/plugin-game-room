import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { Store } from './store.js'
import { ApiError, requireThat } from './errors.js'
export interface Account {
  id: string
  name: string
  economyId?: string
}
interface AccountRow {
  id: string
  name: string
  salt: string
  password: string
  economy_id: string | null
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export class Accounts {
  constructor(private store: Store, private now: () => number) {}
  credentials(name: unknown, password: unknown) {
    requireThat(typeof name === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(name))
    requireThat(typeof password === 'string' && password.length >= 12 && password.length <= 256)
    return { name: name.toLowerCase(), password }
  }
  register(name: unknown, password: unknown) {
    const c = this.credentials(name, password)
    requireThat(!this.store.db.prepare('SELECT id FROM accounts WHERE name=?').get(c.name), 'account_exists', 409)
    const salt = randomBytes(16).toString('hex')
    const id = this.store.id('account')
    this.store.db.prepare('INSERT INTO accounts(id,name,salt,password) VALUES (?,?,?,?)').run(
      id,
      c.name,
      salt,
      scryptSync(c.password, salt, 64).toString('hex'),
    )
    return this.session({ id, name: c.name })
  }
  login(name: unknown, password: unknown) {
    const c = this.credentials(name, password)
    const row = this.store.db.prepare('SELECT * FROM accounts WHERE name=?').get(c.name) as unknown as
      | AccountRow
      | undefined
    const calculated = scryptSync(c.password, row?.salt ?? 'dummy-salt', 64)
    requireThat(row && timingSafeEqual(calculated, Buffer.from(row.password, 'hex')), 'invalid_credentials', 401)
    return this.session({ id: row.id, name: row.name })
  }
  private session(account: Account) {
    const token = randomBytes(32).toString('base64url')
    this.store.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      digest(token),
      account.id,
      this.now() + 30 * 86400000,
    )
    return { account, token }
  }
  authenticate(token: string | undefined): Account {
    if (!token) throw new ApiError(401, 'authentication_required')
    const row = this.store.db.prepare(
      'SELECT a.* FROM accounts a JOIN sessions s ON a.id=s.account_id WHERE s.hash=? AND s.expires>?',
    ).get(digest(token), this.now()) as unknown as AccountRow | undefined
    requireThat(row, 'invalid_session', 401)
    return { id: row.id, name: row.name, ...(row.economy_id ? { economyId: row.economy_id } : {}) }
  }
  revoke(token: string) {
    this.store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token))
  }
}
