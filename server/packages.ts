import type { GamePackage, PackageMetadata } from '../sdk/index.js'
import { canonical, integer, object, requireThat } from './errors.js'
import { digest } from './accounts.js'
import { invoke } from './runner.js'
import { Store } from './store.js'
export class Packages {
  constructor(private store: Store) {}
  async publish(publisherId: string, input: unknown): Promise<PackageMetadata> {
    object(input)
    object(input.manifest)
    object(input.ui)
    const m = input.manifest
    requireThat(input.packageVersion === 1 && typeof m.id === 'string' && /^[a-z0-9-]{1,64}$/.test(m.id))
    requireThat(typeof m.version === 'string' && /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(m.version))
    requireThat(typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 100)
    requireThat(integer(m.minPlayers, 2, 8) && integer(m.maxPlayers, m.minPlayers, 8))
    requireThat(
      Array.isArray(m.modes) && m.modes.length > 0 && m.modes.length <= 3
        && m.modes.every(x => ['score', 'local-chips', 'token'].includes(x as string)),
    )
    requireThat(
      m.settlementPolicies === undefined
        || (Array.isArray(m.settlementPolicies) && m.settlementPolicies.length > 0
          && m.settlementPolicies.every(x => ['equal-winners-v1', 'conserved-payouts-v1'].includes(x as string))),
    )
    requireThat(typeof input.rules === 'string' && input.rules.length <= 256 * 1024)
    requireThat(typeof input.ui.html === 'string' && input.ui.html.length <= 256 * 1024)
    const body = canonical(input)
    const hash = digest(body)
    const prior = this.store.db.prepare('SELECT hash FROM packages WHERE publisher_id=? AND game_id=? AND version=?')
      .get(publisherId, m.id, m.version) as { hash: string } | undefined
    requireThat(!prior || prior.hash === hash, 'immutable_version', 409)
    await invoke({
      rules: input.rules,
      method: 'validate',
      args: [],
      ctx: { seats: [], config: {}, seatIndex: null, mode: 'score', stake: 0, policy: 'equal-winners-v1' },
      seed: '',
      cursor: 0,
    })
    this.store.db.prepare('INSERT OR IGNORE INTO packages VALUES (?,?,?,?,?)').run(
      hash,
      publisherId,
      m.id,
      m.version,
      body,
    )
    return this.metadata(hash)
  }
  get(hash: string): GamePackage {
    const row = this.store.db.prepare('SELECT body FROM packages WHERE hash=?').get(hash) as
      | { body: string }
      | undefined
    requireThat(row, 'package_not_found', 404)
    return JSON.parse(row.body)
  }
  metadata(hash: string): PackageMetadata {
    const row = this.store.db.prepare('SELECT publisher_id FROM packages WHERE hash=?').get(hash) as {
      publisher_id: string
    } | undefined
    requireThat(row, 'package_not_found', 404)
    return {
      hash,
      manifest: this.get(hash).manifest,
      publisherId: row.publisher_id,
      reviewState: 'unreviewed',
      uiUrl: `/v1/packages/${hash}/ui`,
      uiSha256: digest(this.get(hash).ui.html),
    }
  }
  list() {
    return (this.store.db.prepare('SELECT hash FROM packages').all() as { hash: string }[]).map(row =>
      this.metadata(row.hash)
    )
  }
}
