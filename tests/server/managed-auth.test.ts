import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { Accounts } from '../../server/accounts.js'
import { ManagedAccountAuth } from '../../server/managed-auth.js'
import { Store } from '../../server/store.js'
import * as codec from '@cordisx/protocol/managed-source/v1'
function fixture() {
  const store = new Store(':memory:'), accounts = new Accounts(store, () => now)
  const host = generateKeyPairSync('ed25519'), server = generateKeyPairSync('ed25519')
  let now = 1000
  const binding = {
    origin: 'http://127.0.0.1:58973',
    sourceId: store.serverId,
    instanceId: store.serverId,
    audience: 'source-account' as const,
  }
  const auth = new ManagedAccountAuth(
    accounts,
    store,
    {
      binding,
      hostPublicKey: host.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      serverPrivateKey: server.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    },
    codec,
    () => now,
  )
  const challenge = () =>
    auth.challenge({ sourceId: store.serverId, instanceId: store.serverId, audience: 'source-account' })
  const assertion = async (subject = 'codex:' + Buffer.alloc(32, 1).toString('base64url'), displayName = '朋友') => {
    const c = await challenge()
    const payload: Record<string, unknown> = {
      ...(c.payload as Record<string, unknown>),
      contract: 'cordisx.managed-source-assertion/v1',
      subject,
      displayName,
    }
    return { payload, signature: sign(null, codec.managedSourceBytes(payload), host.privateKey).toString('base64url') }
  }
  return {
    store,
    accounts,
    auth,
    binding,
    host,
    server,
    challenge,
    assertion,
    expire: () => {
      now += 30000
    },
  }
}
await test('managed local authentication verifies real signatures and maps stable subject independently of name', async (t) => {
  const f = fixture()
  t.after(() => f.store.db.close())
  const challenge = await f.challenge()
  assert(
    verify(
      null,
      codec.managedSourceBytes(challenge.payload),
      f.server.publicKey,
      Buffer.from(challenge.signature, 'base64url'),
    ),
  )
  const first = await f.auth.session(await f.assertion()),
    second = await f.auth.session(await f.assertion(undefined, '改名'))
  const a = first.payload as {
    result: {
      sessionToken: string
      instanceId: string
      account: {
        id: string
        guest: boolean
      }
    }
  }
  const b = second.payload as typeof a
  assert.equal(a.result.account.id, b.result.account.id)
  assert.equal(a.result.account.guest, false)
  assert.equal(a.result.instanceId, f.store.serverId)
  assert.equal((await f.accounts.authenticate(a.result.sessionToken)).id, a.result.account.id)
  assert(
    verify(
      null,
      codec.managedSourceBytes(first.payload),
      f.server.publicKey,
      Buffer.from(first.signature, 'base64url'),
    ),
  )
})
await test('signature, binding, expiry, replay and unknown fields fail closed', async (t) => {
  const f = fixture()
  t.after(() => f.store.db.close())
  const badSignature = await f.assertion()
  badSignature.signature = Buffer.alloc(64).toString('base64url')
  await assert.rejects(async () => await f.auth.session(badSignature))
  const otherAudience = await f.assertion()
  otherAudience.payload.audience = 'work-income' as 'source-account'
  await assert.rejects(async () => await f.auth.session(otherAudience))
  const otherOrigin = await f.assertion()
  otherOrigin.payload.origin = 'http://127.0.0.1:58974'
  await assert.rejects(async () => await f.auth.session(otherOrigin))
  const extra = await f.assertion()
  Object.assign(extra.payload, { accountId: 'caller-selected' })
  await assert.rejects(async () => await f.auth.session(extra))
  const valid = await f.assertion()
  await f.auth.session(valid)
  await assert.rejects(async () => await f.auth.session(valid))
  const expired = await f.assertion()
  f.expire()
  await assert.rejects(async () => await f.auth.session(expired))
  assert.equal((await f.store.db.prepare('SELECT COUNT(*) AS count FROM managed_identities').get())?.count, 1)
})
await test('guest upgrade proves original session, preserves owner ID and retires original guest credentials', async (t) => {
  const f = fixture()
  t.after(() => f.store.db.close())
  const guest = await f.accounts.guest(), first = await f.auth.session(await f.assertion(), guest.token)
  const result = first.payload as {
    result: {
      sessionToken: string
      account: {
        id: string
        guest: boolean
      }
    }
  }
  assert.equal(result.result.account.id, guest.account.id)
  assert.equal(result.result.account.guest, false)
  assert.equal((await f.accounts.authenticate(result.result.sessionToken)).id, guest.account.id)
  await assert.rejects(async () => await f.accounts.authenticate(guest.token))
  const recovered = (await f.auth.session(await f.assertion(), guest.token)).payload as typeof first.payload
  assert.equal((recovered as typeof result).result.account.id, guest.account.id)
  const unrelated = await f.accounts.guest()
  await assert.rejects(
    async () => await f.auth.session(await f.assertion(), unrelated.token),
    /managed_account_conflict/,
  )
  assert.equal((await f.accounts.authenticate(unrelated.token)).guest, true)
})
await test('same display name does not merge subjects; wrong or absent session cannot claim a guest', async (t) => {
  const f = fixture()
  t.after(() => f.store.db.close())
  const guest = await f.accounts.guest()
  await assert.rejects(async () => await f.auth.session(await f.assertion(), 'invalid-source-session'))
  const first = await f.auth.session(await f.assertion()),
    second = await f.auth.session(await f.assertion('codex:' + Buffer.alloc(32, 2).toString('base64url')))
  const a = first.payload as {
      result: {
        account: {
          id: string
        }
      }
    },
    b = second.payload as typeof a
  assert.notEqual(a.result.account.id, b.result.account.id)
  assert.notEqual(a.result.account.id, guest.account.id)
  assert.equal((await f.accounts.authenticate(guest.token)).guest, true)
})
await test('actual HTTP guest ownership upgrades without losing the original room and rejects replay', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createServer } = await import('node:net')
  const { createGameServer } = await import('../../server/http.js')
  const { game } = await import('./helpers.js')
  const directory = mkdtempSync(join(tmpdir(), 'managed-auth-http-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const database = join(directory, 'game.sqlite'), seed = new Store(database), instanceId = seed.serverId
  seed.close()
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  assert(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  const origin = `http://127.0.0.1:${port}`,
    host = generateKeyPairSync('ed25519'),
    server = generateKeyPairSync('ed25519')
  const app = createGameServer({
    database,
    tickMs: 0,
    accessPolicy: 'guest-allowed',
    managedAccount: {
      codec,
      trust: {
        binding: { origin, sourceId: instanceId, instanceId, audience: 'source-account' },
        hostPublicKey: host.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        serverPrivateKey: server.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      },
    },
  })
  t.after(async () => await app.close())
  await new Promise<void>(resolve => app.server.listen(port, '127.0.0.1', resolve))
  async function request(path: string, token?: string, body?: unknown) {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }
  const guest = await request('/v1/guests', undefined, {})
  assert.equal(
    (await request('/v1/me/profile', guest.body.token, { subject: 'old-display-scope', displayName: '旧访客名' }))
      .status,
    200,
  )
  const published = await request('/v1/packages', guest.body.token, game())
  assert.equal(published.status, 200)
  const room = await request('/v1/rooms', guest.body.token, { packageHash: published.body.hash, mode: 'score' })
  assert.equal(room.status, 200)
  const challenge = await request(
    '/v1/auth/host/challenge?' + new URLSearchParams({ sourceId: instanceId, instanceId, audience: 'source-account' }),
  )
  assert.equal(challenge.status, 200)
  assert(
    verify(
      null,
      codec.managedSourceBytes(challenge.body.payload),
      server.publicKey,
      Buffer.from(challenge.body.signature, 'base64url'),
    ),
  )
  const payload = {
    ...challenge.body.payload,
    contract: 'cordisx.managed-source-assertion/v1',
    subject: 'codex:' + Buffer.alloc(32, 3).toString('base64url'),
  }
  const envelope = {
    payload,
    signature: sign(null, codec.managedSourceBytes(payload), host.privateKey).toString('base64url'),
  }
  const authenticated = await request('/v1/auth/host/session', guest.body.token, envelope)
  assert.equal(authenticated.status, 200)
  assert(
    verify(
      null,
      codec.managedSourceBytes(authenticated.body.payload),
      server.publicKey,
      Buffer.from(authenticated.body.signature, 'base64url'),
    ),
  )
  const result = authenticated.body.payload.result
  assert.equal(result.account.id, guest.body.account.id)
  assert.equal(result.account.guest, false)
  assert.equal((await request('/v1/me', guest.body.token)).status, 401)
  assert.equal(
    (await request('/v1/me/profile', result.sessionToken, { subject: 'new-display-scope', displayName: '朋友账号名' }))
      .status,
    200,
  )
  assert.equal((await request('/v1/me', result.sessionToken)).body.account.displayName, '朋友账号名')
  const history = await request('/v1/me/rooms', result.sessionToken)
  assert.equal(history.status, 200)
  assert(history.body.rooms.some((entry: {
    id: string
  }) => entry.id === room.body.id))
  assert.equal((await request('/v1/auth/host/session', undefined, envelope)).status, 401)
})
