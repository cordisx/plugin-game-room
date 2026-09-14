import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto'
import { Accounts, digest } from './accounts.js'
import { ApiError, object, requireThat } from './errors.js'
import type { GameStore as Store } from './store-contract.js'
/** Adapter to the public managed-source/v1 codec; production must inject that exact public implementation. */
export interface ManagedAccountCodec {
  managedSourceBytes(value: unknown): Uint8Array
  managedSourceBinding(value: unknown): AccountBinding
  managedSourceChallenge(value: unknown, binding: AccountBinding, now: number): AccountChallenge
}
export interface AccountBinding {
  origin: string
  sourceId: string
  instanceId: string
  audience: 'source-account' | 'work-income'
}
interface AccountChallenge extends AccountBinding {
  contract: 'cordisx.managed-source-challenge/v1'
  nonce: string
  expiresAt: number
}
export interface ManagedAccountTrust {
  binding: AccountBinding
  hostPublicKey: string
  serverPrivateKey: string
}
/** Authority is explicitly provisioned keys, never an address or caller-supplied display identity. */
export class ManagedAccountAuth {
  readonly binding: AccountBinding
  private readonly hostKey
  private readonly serverKey
  private readonly issuer: string

  constructor(
    private readonly accounts: Accounts,
    private readonly store: Store,
    trust: ManagedAccountTrust,
    private readonly codec: ManagedAccountCodec,
    private readonly now: () => number = Date.now,
  ) {
    this.binding = Object.freeze(codec.managedSourceBinding(trust.binding))
    requireThat(
      this.binding.audience === 'source-account' && this.binding.sourceId === store.serverId
        && this.binding.instanceId === store.serverId,
      'managed_binding_mismatch',
    )
    requireThat(/^-----BEGIN PUBLIC KEY-----\r?\n/u.test(trust.hostPublicKey), 'invalid_managed_key')
    this.hostKey = createPublicKey(trust.hostPublicKey)
    this.serverKey = createPrivateKey(trust.serverPrivateKey)
    requireThat(
      this.hostKey.asymmetricKeyType === 'ed25519' && this.serverKey.asymmetricKeyType === 'ed25519',
      'invalid_managed_key',
    )
    this.issuer = digest(this.hostKey.export({ type: 'spki', format: 'der' }).toString('base64'))
  }
  async challenge(query: Record<string, string>) {
    requireThat(
      Object.keys(query).every(key => ['sourceId', 'instanceId', 'audience'].includes(key))
        && query.sourceId === this.binding.sourceId && query.instanceId === this.binding.instanceId
        && query.audience === this.binding.audience,
      'managed_binding_mismatch',
      403,
    )
    const now = this.now()
    await this.store.db.prepare('DELETE FROM managed_nonces WHERE expires<=?').run(now)
    const payload: AccountChallenge = {
      contract: 'cordisx.managed-source-challenge/v1',
      ...this.binding,
      nonce: randomBytes(32).toString('base64url'),
      expiresAt: now + 30000,
    }
    await this.store.atomic(async () => {
      const count = await this.store.db.prepare('SELECT COUNT(*) AS count FROM managed_nonces').get()
      requireThat(Number(count?.count) < 500, 'rate_limited', 429)
      await this.store.db.prepare('INSERT INTO managed_nonces VALUES (?,?,?)').run(
        payload.nonce,
        payload.expiresAt,
        JSON.stringify(payload),
      )
    })
    return this.envelope(payload)
  }
  async session(input: unknown, previousToken?: string) {
    object(input)
    requireThat(
      Object.keys(input).length === 2 && 'payload' in input && 'signature' in input,
      'invalid_managed_assertion',
      401,
    )
    const payload = input.payload
    object(payload)
    requireThat(
      Object.keys(payload).every(key =>
        ['contract', 'origin', 'sourceId', 'instanceId', 'audience', 'nonce', 'expiresAt', 'subject', 'displayName']
          .includes(key)
      )
        && payload.contract === 'cordisx.managed-source-assertion/v1'
        && typeof payload.subject === 'string' && /^codex:[A-Za-z0-9_-]{43}$/u.test(payload.subject),
      'invalid_managed_assertion',
      401,
    )
    if (payload.displayName !== undefined) {
      requireThat(
        typeof payload.displayName === 'string' && payload.displayName.trim().length > 0
          && payload.displayName.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(payload.displayName),
        'invalid_managed_assertion',
        401,
      )
    }
    let challenge: AccountChallenge
    try {
      challenge = this.codec.managedSourceChallenge(
        {
          contract: 'cordisx.managed-source-challenge/v1',
          origin: payload.origin,
          sourceId: payload.sourceId,
          instanceId: payload.instanceId,
          audience: payload.audience,
          nonce: payload.nonce,
          expiresAt: payload.expiresAt,
        },
        this.binding,
        this.now(),
      )
    } catch {
      throw new ApiError(401, 'invalid_managed_assertion')
    }
    const known = await this.store.db.prepare('SELECT expires FROM managed_nonces WHERE nonce=?').get(challenge.nonce)
    requireThat(known && known.expires === challenge.expiresAt, 'invalid_managed_nonce', 401)
    const signature = typeof input.signature === 'string' ? Buffer.from(input.signature, 'base64url') : Buffer.alloc(0)
    requireThat(
      signature.length === 64 && signature.toString('base64url') === input.signature
        && await verify(null, this.codec.managedSourceBytes(payload), this.hostKey, signature),
      'invalid_managed_signature',
      401,
    )
    const session = await this.accounts.managedLogin(
      this.issuer,
      payload.subject as string,
      previousToken,
      async () => {
        await this.store.requireChanges(
          'DELETE FROM managed_nonces WHERE nonce=? AND expires=? AND expires>?',
          [challenge.nonce, challenge.expiresAt, this.now()],
          1,
          'invalid_managed_nonce',
        )
      },
    )
    return this.envelope({
      contract: 'cordisx.managed-source-result/v1',
      ...this.binding,
      nonce: challenge.nonce,
      subject: payload.subject,
      result: { sessionToken: session.token, instanceId: this.binding.instanceId, account: session.account },
    })
  }
  private envelope(payload: unknown) {
    return {
      payload,
      signature: sign(null, this.codec.managedSourceBytes(payload), this.serverKey).toString('base64url'),
    }
  }
}
