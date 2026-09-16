import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { Store } from '../../server/store.js'
import { GameServiceKey } from '../../server/game-service-key.js'
import { canonical } from '../../server/errors.js'
test('configured Game key pins real origin/serverId/public key; restarts retain pin and reject automatic key/origin replacement', async t => {
  const store = new Store(':memory:')
  t.after(() => store.close())
  const key = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const config = { origin: 'https://game.example', privateKey: key }
  const service = new GameServiceKey(config, store.serverId)
  await service.pin(store)
  await new GameServiceKey(config, store.serverId).pin(store)
  const payload = { contract: 'economy.spend-terms/v1', disclosure: 'fixed payload' }
  const signed = service.sign(payload)
  const pub = createPublicKey({ key: Buffer.from(service.publicKey, 'base64url'), format: 'der', type: 'spki' })
  assert(
    verify(
      null,
      Buffer.from(`${payload.contract}\0${canonical(payload)}`),
      pub,
      Buffer.from(signed.signature, 'base64url'),
    ),
  )
  assert.equal(service.sign(payload).signature, signed.signature)
  await assert.rejects(
    new GameServiceKey({ ...config, origin: 'https://forged.example' }, store.serverId).pin(store),
    /spend_service_changed/,
  )
  const replacement = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  await assert.rejects(
    new GameServiceKey({ ...config, privateKey: replacement }, store.serverId).pin(store),
    /spend_service_changed/,
  )
  assert.throws(() => new GameServiceKey({ ...config, origin: 'https://game.example/path' }, store.serverId))
})
