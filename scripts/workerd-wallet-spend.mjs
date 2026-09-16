import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Miniflare } from 'miniflare'
import { Economy, LocalPoolEngine, LocalSpendEngine } from '@cordisx/economy/server'
import { canonical, verifySigned } from '@cordisx/economy/spend'
import { applyWorkersMigrations } from './apply-workers-migrations.mjs'
import { game } from '../dist/tests/server/helpers.js'
const directory = mkdtempSync(join(tmpdir(), 'workerd-wallet-'))
const service = generateKeyPairSync('ed25519'), walletKeys = [0, 1].map(() => generateKeyPairSync('ed25519'))
const mf = new Miniflare({
  modules: true,
  scriptPath: 'dist/server/index.js',
  modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  bindings: {
    AUTH_POLICY: 'guest-allowed',
    SPEND_TRUSTED_WALLET_KEYS: JSON.stringify(
      walletKeys.map(k => k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')),
    ),
    SPEND_SERVICE_ORIGIN: 'https://workerd-game.example',
    SPEND_SERVICE_PRIVATE_KEY: service.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  },
})
const economy = new Economy(join(directory, 'wallet.sqlite'))
try {
  const db = await mf.getD1Database('DB')
  await applyWorkersMigrations(db)
  economy.auth.createInstance('original', 1000)
  async function request(path, token, body, expected = 200) {
    const res = await mf.dispatchFetch('http://localhost' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const value = await res.json()
    if (expected !== null) assert.equal(res.status, expected, JSON.stringify(value))
    return { status: res.status, value }
  }
  const identity = (await request('/v1/spend/identity')).value
  const accounts = [], wallets = []
  for (const [i, name] of ['alice', 'bobby'].entries()) {
    const account = (await request('/v1/accounts', undefined, { name, password: 'correct-horse-battery' })).value
    accounts.push(account)
    const id = 'wallet-' + i, key = walletKeys[i]
    economy.auth.createAccount('original', id)
    // Temporary trusted server fixture; never the Native authority or original usage ledger.
    economy.store.transaction(() =>
      economy.store.transfer('original', '$issuer', id, 100, 'test-funding', 'fixture', Date.now())
    )
    const engine = new LocalSpendEngine(economy.store, 'original', id, key.privateKey),
      session = engine.openSession(() => {})
    const pool = new LocalPoolEngine(engine, key.privateKey)
    wallets.push({ engine: pool, session: pool.openSession(() => {}) })
    const challenge = (await request('/v1/wallet-bindings/challenge', account.token, {})).value
    await request('/v1/wallet-bindings', account.token, session.bindGameAccount(session.quoteBinding(challenge)))
  }
  const metadata = (await request('/v1/packages', accounts[0].token, game())).value
  const consent = { packageHash: metadata.hash, stake: 10, policy: 'equal-winners-v1', reviewState: 'unreviewed' }
  const room =
      (await request('/v1/rooms', accounts[0].token, { packageHash: metadata.hash, mode: 'token', stake: 10, consent }))
        .value,
    path = '/v1/rooms/' + room.id
  await request(path + '/join', accounts[1].token, { consent })
  for (const a of accounts) await request(path + '/ready', a.token, { ready: true, consent })
  await request(path + '/start', accounts[0].token, {})
  const terms = (await request(path + '/spend', accounts[0].token)).value
  assert(await verifySigned(terms.terms, identity.servicePublicKey))
  const holds = wallets.map((w, i) =>
    w.session.reserve(w.session.quote(terms.terms, terms.requestIds[accounts[i].account.id]))
  )
  await request(path + '/spend-receipts', accounts[0].token, holds[0].reservation)
  const race = await Promise.all([
    request(path + '/spend-cancel', accounts[0].token, {}, null),
    request(path + '/spend-receipts', accounts[1].token, holds[1].reservation, null),
  ])
  let final = (await request(path + '/spend', accounts[0].token)).value
  assert(['active', 'refund'].includes(final.phase), JSON.stringify(final))
  assert(race.every(r => r.status === 200 || r.status === 409), JSON.stringify(race))
  if (final.phase === 'active') {
    for (const [i, a] of accounts.entries()) {
      const view = (await request(path, a.token)).value
      await request(path + '/actions', a.token, {
        expectedVersion: view.version,
        idempotencyKey: 'finish-' + i,
        action: { type: 'move' },
      })
    }
    final = (await request(path + '/spend', accounts[0].token)).value
    assert.equal(final.phase, 'capture')
  }
  assert(await verifySigned(final.decision, identity.servicePublicKey))
  const bytes = canonical(final.decision)
  for (const [i, w] of wallets.entries()) {
    const settled = w.engine.applyDecision(final.decision, () => {})
    assert.equal(settled.paid, final.decision.payload.allocations[i].paid)
    assert.deepEqual(w.engine.applyDecision(final.decision, () => {}), settled)
    const owned = (await request('/v1/me/spend-transactions', accounts[i].token)).value
    assert.equal(owned.transactions.length, 1)
    assert.equal(canonical(owned.transactions[0].transaction.decision), bytes)
  }
  assert.equal(canonical((await request(path + '/spend', accounts[0].token)).value.decision), bytes)
  const publicRooms = (await request('/v1/rooms')).value
  for (const w of wallets) {
    assert(!JSON.stringify(publicRooms).includes(w.engine.wallet.walletId))
    assert(!JSON.stringify(publicRooms).includes(w.engine.wallet.walletPublicKey))
  }
  assert(!JSON.stringify(publicRooms).includes('requestIds'))
  assert(!JSON.stringify(publicRooms).includes('signature'))
  // Both funding and active room closure must create a recoverable refund,
  // while closing a completed room must preserve its existing final decision.
  await request(path + '/close', accounts[0].token, {})
  assert.equal(canonical((await request(path + '/spend', accounts[0].token)).value.decision), bytes)
  for (const active of [false, true]) {
    const opened = (await request('/v1/rooms', accounts[0].token, {
      packageHash: metadata.hash,
      mode: 'token',
      stake: 10,
      consent,
    })).value
    const closePath = '/v1/rooms/' + opened.id
    await request(closePath + '/join', accounts[1].token, { consent })
    for (const a of accounts) await request(closePath + '/ready', a.token, { ready: true, consent })
    await request(closePath + '/start', accounts[0].token, {})
    const quote = (await request(closePath + '/spend', accounts[0].token)).value
    const reservations = wallets.map((w, i) =>
      w.session.reserve(w.session.quote(quote.terms, quote.requestIds[accounts[i].account.id]))
    )
    await request(closePath + '/spend-receipts', accounts[0].token, reservations[0].reservation)
    if (active) await request(closePath + '/spend-receipts', accounts[1].token, reservations[1].reservation)
    await request(closePath + '/close', accounts[1].token, {}, 403)
    if (active) {
      await request(closePath + '/close', accounts[0].token, {}, 409)
      for (const [i, a] of accounts.entries()) {
        const view = (await request(closePath, a.token)).value
        await request(closePath + '/actions', a.token, {
          expectedVersion: view.version,
          idempotencyKey: 'close-finish-' + i,
          action: { type: 'move' },
        })
      }
    }
    await request(closePath + '/close', accounts[0].token, {})
    const refund = (await request(closePath + '/spend', accounts[1].token)).value
    assert.equal(refund.phase, active ? 'capture' : 'refund')
    assert(await verifySigned(refund.decision, identity.servicePublicKey))
    for (const w of wallets) {
      const settled = w.engine.applyDecision(refund.decision, () => {})
      assert.equal(settled.exited, true)
      assert.deepEqual(w.engine.applyDecision(refund.decision, () => {}), settled)
    }
    await request(closePath + '/close', accounts[0].token, {})
    assert.equal(
      canonical((await request(closePath + '/spend', accounts[0].token)).value.decision),
      canonical(refund.decision),
    )
    await request(closePath + '/next-match', accounts[0].token, {}, 409)
  }
  assert.equal((await request('/v1/spend/identity')).value.serverId, identity.serverId)
  console.log(
    'PASS actual workerd/D1 signed Game identity, wallet proof, terms/receipts, cancel/start CAS, immutable finality, indexed recovery and public privacy; temporary Node wallet authority only',
  )
} finally {
  economy.close()
  await mf.dispose()
  rmSync(directory, { recursive: true, force: true })
}
