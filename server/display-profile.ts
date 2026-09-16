import { createHash } from 'node:crypto'
import type { GameStore as Store } from './store-contract.js'
import { object, requireThat } from './errors.js'
export interface DisplayProfile {
  displayName?: string
  avatar?: string
}
/** Display data only. The subject binds one local profile; it is never an authentication proof. */
export class DisplayProfiles {
  constructor(private store: Store) {}
  async read(accountId: string): Promise<DisplayProfile> {
    const row = await this.store.db.prepare('SELECT body FROM display_profiles WHERE account_id=?').get(accountId) as {
      body: string
    } | undefined
    return row ? JSON.parse(row.body) : {}
  }
  async update(accountId: string, input: unknown): Promise<DisplayProfile> {
    object(input)
    requireThat(Object.keys(input).every(key => ['subject', 'displayName', 'avatar'].includes(key)), 'invalid_profile')
    requireThat(
      typeof input.subject === 'string' && input.subject.length > 0 && input.subject.length <= 256,
      'invalid_profile',
    )
    const profile: DisplayProfile = {}
    if (input.displayName !== undefined) {
      requireThat(
        typeof input.displayName === 'string' && input.displayName.trim().length > 0
          && input.displayName.length <= 128 && !/[\u0000-\u001f\u007f]/.test(input.displayName),
        'invalid_profile',
      )
      profile.displayName = input.displayName.trim()
    }
    if (input.avatar !== undefined) {
      requireThat(
        typeof input.avatar === 'string' && input.avatar.length <= 65536
          && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.avatar),
        'invalid_profile',
      )
      const encoded = input.avatar.slice('data:image/png;base64,'.length)
      const bytes = Buffer.from(encoded, 'base64')
      requireThat(
        bytes.toString('base64') === encoded && bytes.length >= 33
          && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) === 96
          && bytes.readUInt32BE(20) === 96,
        'invalid_profile',
      )
      profile.avatar = input.avatar
    }
    const subjectHash = createHash('sha256').update(input.subject).digest('hex')
    return await this.store.atomic(async () => {
      const prior = await this.store.db.prepare('SELECT subject_hash FROM display_profiles WHERE account_id=?').get(
        accountId,
      ) as {
        subject_hash: string
      } | undefined
      const managed = await this.store.db.prepare('SELECT 1 FROM managed_identities WHERE account_id=?').get(accountId)
      // Display subject scopes may change; verified managed account identity remains immutable elsewhere.
      requireThat(!prior || prior.subject_hash === subjectHash || managed, 'profile_identity_conflict', 409)
      await this.store.db.prepare(
        'INSERT INTO display_profiles VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET subject_hash=excluded.subject_hash,body=excluded.body',
      )
        .run(accountId, subjectHash, JSON.stringify(profile))
      return profile
    })
  }
}
