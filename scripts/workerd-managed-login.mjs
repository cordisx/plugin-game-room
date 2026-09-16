import { Miniflare } from 'miniflare'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import assert from 'node:assert/strict'
import * as codec from '@cordisx/protocol/managed-source/v1'
import { applyWorkersMigrations } from './apply-workers-migrations.mjs'
const origin = 'https://game.example'
const options = {
  modules: true,
  scriptPath: 'dist/server/index.js',
  modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
}
const mf = new Miniflare({ ...options, bindings: { AUTH_POLICY: 'login-required' } })
try {
  const db = await mf.getD1Database('DB')
  await applyWorkersMigrations(db)
  const discovery = await (await mf.dispatchFetch(origin + '/v1/handshake')).json()
  const host = generateKeyPairSync('ed25519'), server = generateKeyPairSync('ed25519')
  const binding = { origin, sourceId: discovery.serverId, instanceId: discovery.serverId, audience: 'source-account' }
  const trust = {
    binding,
    hostPublicKey: host.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    serverPrivateKey: server.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
  await mf.setOptions({
    ...options,
    bindings: { AUTH_POLICY: 'login-required', MANAGED_SOURCE_TRUST: JSON.stringify(trust) },
  })
  const call = (path, body, token) =>
    mf.dispatchFetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  assert.deepEqual((await (await call('/v1/handshake')).json()).managedAccount.binding, binding)
  const login = async () => {
    const c = await (await call(
      '/v1/auth/host/challenge?'
        + new URLSearchParams({
          sourceId: binding.sourceId,
          instanceId: binding.instanceId,
          audience: binding.audience,
        }),
    )).json()
    assert(verify(null, codec.managedSourceBytes(c.payload), server.publicKey, Buffer.from(c.signature, 'base64url')))
    const payload = {
      ...c.payload,
      contract: 'cordisx.managed-source-assertion/v1',
      subject: 'codex:' + Buffer.alloc(32, 1).toString('base64url'),
    }
    const assertion = {
      payload,
      signature: sign(null, codec.managedSourceBytes(payload), host.privateKey).toString('base64url'),
    }
    const forged = {
      ...assertion,
      signature: sign(null, codec.managedSourceBytes(payload), generateKeyPairSync('ed25519').privateKey).toString(
        'base64url',
      ),
    }
    assert.equal((await call('/v1/auth/host/session', forged)).status, 401)
    const response = await call('/v1/auth/host/session', assertion)
    assert.equal(response.status, 200)
    const envelope = await response.json()
    assert(
      verify(
        null,
        codec.managedSourceBytes(envelope.payload),
        server.publicKey,
        Buffer.from(envelope.signature, 'base64url'),
      ),
    )
    assert.equal((await call('/v1/auth/host/session', assertion)).status, 401)
    return envelope.payload.result
  }
  const first = await login(), second = await login()
  assert.equal(first.account.id, second.account.id)
  assert.equal(first.account.guest, false)
  assert.equal((await call('/v1/me', undefined, second.sessionToken)).status, 200)
  assert.equal((await call('/v1/rooms', {})).status, 401)
  assert.equal((await mf.dispatchFetch('https://wrong.example/v1/handshake')).status, 503)
  console.log(
    'PASS HTTPS managed login: pinned signatures, rejected forgery/replay/origin, stable registered account, authenticated session',
  )
} finally {
  await mf.dispose()
}
