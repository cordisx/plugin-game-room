import { createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto'
import { requireThat } from './errors.js'
import { canonical, signingBytes } from '@cordisx/economy/spend'
import type { GameStore } from './store-contract.js'
export interface GameServiceKeyConfig {
  origin: string
  privateKey: string
  /** Operator-enrolled economy receipt authorities; an account self-binding is not funding attestation. */
  trustedWalletPublicKeys?: readonly string[]
}
/** Operator-provisioned key only: never inferred from a request header or regenerated during fetch. */
export class GameServiceKey {
  readonly origin: string
  readonly publicKey: string
  readonly trustedWalletPublicKeys: ReadonlySet<string>
  private readonly privateKey: KeyObject
  constructor(config: GameServiceKeyConfig, readonly serverId: string) {
    const origin = new URL(config.origin)
    requireThat(
      origin.origin === config.origin && !origin.username && !origin.password
        && (origin.protocol === 'https:'
          || origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)),
      'invalid_spend_origin',
    )
    requireThat(
      config.trustedWalletPublicKeys === undefined
        || Array.isArray(config.trustedWalletPublicKeys)
          && config.trustedWalletPublicKeys.every(key => typeof key === 'string' && /^[A-Za-z0-9_-]{59}$/.test(key)),
      'invalid_wallet_authorities',
    )
    this.trustedWalletPublicKeys = new Set(config.trustedWalletPublicKeys ?? [])
    this.origin = config.origin
    this.privateKey = createPrivateKey(config.privateKey)
    requireThat(this.privateKey.asymmetricKeyType === 'ed25519', 'invalid_spend_key')
    this.publicKey = createPublicKey(this.privateKey).export({ type: 'spki', format: 'der' }).toString('base64url')
  }
  async pin(store: GameStore) {
    requireThat(store.serverId === this.serverId, 'spend_service_changed', 409)
    const binding = canonical({ serviceOrigin: this.origin, servicePublicKey: this.publicKey, serverId: this.serverId })
    await store.atomic(async () => {
      const prior = await store.db.prepare('SELECT value FROM meta WHERE key=?').get('walletSpendService')
      requireThat(!prior || prior.value === binding, 'spend_service_changed', 409)
      if (!prior) await store.db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('walletSpendService', binding)
    })
  }
  sign<T extends { contract: string }>(payload: T) {
    const bytes = signingBytes(payload)
    return { payload: structuredClone(payload), signature: sign(null, bytes, this.privateKey).toString('base64url') }
  }
  binding() {
    return { serviceOrigin: this.origin, servicePublicKey: this.publicKey, serverId: this.serverId }
  }
}
