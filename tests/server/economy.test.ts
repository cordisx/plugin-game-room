import { LegacyGameSpend } from '../../server/game-spend-legacy.js'
import { createGameServer } from '../../server/http.js'
import type { GamePackage } from '../../sdk/index.js'
import { build } from '../../games/tools/package.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Economy, LocalPoolEngine, LocalSpendEngine } from '@cordisx/economy/server'
import {
  canonical,
  digest,
  type Signed,
  signingBytes,
  verifySigned,
  type WalletChallenge,
} from '@cordisx/economy/spend'
import type { PoolReservation } from '@cordisx/economy/pool'
import { sign } from 'node:crypto'
import { game, harness, rules } from './helpers.js'

async function fixture(
  t: test.TestContext,
  source: string | GamePackage = rules,
  options: { players?: number; rounds?: number } = {},
) {
  const service = generateKeyPairSync('ed25519'), dir = mkdtempSync(join(tmpdir(), 'game-spend-'))
  const walletKeys = [0, 1, 2].map(() => generateKeyPairSync('ed25519'))
  let now = Date.now()
  const h = await harness({
    database: join(dir, 'game.sqlite'),
    now: () => now,
    walletSpend: {
      origin: 'https://game.example',
      trustedWalletPublicKeys: walletKeys.map(k =>
        k.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
      ),
      privateKey: service.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    },
  })
  const e = new Economy(join(dir, 'wallet.sqlite'), () => now)
  e.auth.createInstance('original', 1000)
  const wallets = [h.alice, h.bob, h.stranger].slice(0, options.players ?? 2).map((account, i) => {
    const id = 'wallet-' + i, key = walletKeys[i]
    e.auth.createAccount('original', id)
    // Test-only funding in a fresh temporary DB; this fixture never operates the actual usage wallet.
    e.store.transaction(() => e.store.transfer('original', '$issuer', id, 100, 'test-funding', 'fixture', now))
    const engine = new LocalSpendEngine(e.store, 'original', id, key.privateKey, () => now)
    const pool = new LocalPoolEngine(engine, key.privateKey)
    return { account, engine: pool, key, binding: engine.openSession(() => {}), session: pool.openSession(() => {}) }
  })
  t.after(async () => {
    await h.app.close()
    e.close()
    rmSync(dir, { recursive: true, force: true })
  })
  for (const w of wallets) {
    const c = await h.request('/v1/wallet-bindings/challenge', w.account.token, {})
    assert.equal(c.status, 200)
    const proof = w.binding.bindGameAccount(w.binding.quoteBinding(c.body))
    assert.equal((await h.request('/v1/wallet-bindings', w.account.token, proof)).status, 200)
  }
  const pkg = typeof source === 'string' ? game(source) : source
  const published = await h.request('/v1/packages', h.alice.token, pkg)
  assert.equal(published.status, 200)
  const consent = {
    packageHash: published.body.hash,
    stake: 10,
    policy: pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1',
    reviewState: 'unreviewed',
  }
  const created = await h.request('/v1/rooms', h.alice.token, {
    packageHash: published.body.hash,
    mode: 'token',
    stake: 10,
    policy: consent.policy,
    consent,
    turnTimeoutMs: 600000,
    config: pkg.manifest.configSchema?.properties?.rounds ? { rounds: options.rounds ?? 1 } : {},
  })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const path = '/v1/rooms/' + created.body.id
  for (const w of wallets.slice(1)) {
    assert.equal((await h.request(path + '/join', w.account.token, { consent })).status, 200)
  }
  for (const w of wallets) {
    assert.equal((await h.request(path + '/ready', w.account.token, { ready: true, consent })).status, 200)
  }
  assert.equal((await h.request(path + '/start', h.alice.token, {})).status, 200)
  const record = (await h.request(path + '/spend', h.alice.token)).body
  const reserve = (i: number) =>
    wallets[i].session.reserve(wallets[i].session.quote(record.terms, record.requestIds[wallets[i].account.account.id]))
  const submit = (i: number, receipt: Signed<PoolReservation>) =>
    h.request(path + '/spend-receipts', wallets[i].account.token, receipt)
  const balance = (i: number) =>
    e.store.one('SELECT available,reserved FROM accounts WHERE instance=? AND id=?', 'original', 'wallet-' + i)
  return {
    h,
    e,
    wallets,
    path,
    record,
    reserve,
    submit,
    balance,
    database: join(dir, 'game.sqlite'),
    serviceKey: service.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    advance: (n: number) => {
      now += n
    },
  }
}

test('terms and receipts open play only after all original wallet confirmations; winner receives the funded pool in the original economy wallet', async t => {
  const f = await fixture(t)
  assert(await verifySigned(f.record.terms, f.record.terms.payload.servicePublicKey))
  assert.equal(f.record.termsHash, await digest(f.record.terms.payload))
  assert.equal(f.record.terms.payload.policy, 'winner-weights')
  const first = f.reserve(0)
  assert.equal((await f.submit(0, first.reservation)).body.view.status, 'funding')
  assert.deepEqual(f.reserve(0), first)
  assert.deepEqual(f.balance(0), { available: 90, reserved: 10 })
  const second = f.reserve(1)
  assert.equal((await f.submit(1, second.reservation)).body.view.status, 'playing')
  assert.equal((await f.submit(0, first.reservation)).status, 200)
  for (const [i, w] of f.wallets.entries()) {
    const view = (await f.h.request(f.path, w.account.token)).body
    const acted = await f.h.request(f.path + '/actions', w.account.token, {
      action: { type: 'move' },
      expectedVersion: view.version,
      matchId: view.matchId,
      seatId: view.selfSeatId,
      idempotencyKey: 'action-' + i,
    })
    assert.equal(acted.status, 200, JSON.stringify(acted.body))
  }
  const done = (await f.h.request(f.path + '/spend', f.h.alice.token)).body
  assert.equal(done.phase, 'capture')
  assert(await verifySigned(done.decision, done.terms.payload.servicePublicKey))
  assert.deepEqual(done.decision.payload.allocations.map((a: { paid: number }) => a.paid), [0, 20])
  for (const [i, w] of f.wallets.entries()) {
    const result = w.engine.applyDecision(done.decision, () => {})
    assert.equal(result.paid, i === 1 ? 20 : 0)
    assert.deepEqual(w.engine.applyDecision(done.decision, () => {}), result)
    assert.deepEqual(f.balance(i), { available: 90 + done.decision.payload.allocations[i].paid, reserved: 0 })
  }
  assert.equal(eTotal(f.e), 1000)
  assert.equal(f.e.store.one<{ n: number }>('SELECT COUNT(*) AS n FROM workIncomeReceipts')?.n, 0)
  assert.equal(
    canonical((await f.h.request(f.path + '/spend', f.h.alice.token)).body.decision),
    canonical(done.decision),
  )
})
function eTotal(e: Economy) {
  return e.store.one<{ supply: number }>('SELECT supply FROM instances')!.supply
}

test('cancel is globally final even before a local receipt arrives; same signed refund releases unseen holds', async t => {
  const f = await fixture(t), late = f.reserve(0)
  const cancelled = await f.h.request(f.path + '/spend-cancel', f.h.bob.token, {})
  assert.equal(cancelled.status, 200)
  const final = cancelled.body.transaction
  assert.equal(final.decision.payload.phase, 'refunded')
  assert.equal(final.decision.payload.reservations.length, 0)
  assert.equal((await f.submit(0, late.reservation)).status, 200)
  assert.equal(
    canonical((await f.h.request(f.path + '/spend', f.h.alice.token)).body.decision),
    canonical(final.decision),
  )
  assert.equal(f.wallets[0].engine.applyDecision(final.decision, () => {}).exited, true)
  assert.deepEqual(f.balance(0), { available: 100, reserved: 0 })
  assert.equal((await f.h.request(f.path + '/start', f.h.alice.token, {})).body.status, 'aborted')
})

test('reservation metadata, signatures, account, terms and nonce cannot be declared or substituted by clients', async t => {
  const f = await fixture(t), hold = f.reserve(0), original = canonical(f.record)
  for (
    const field of [
      'gameAccountId',
      'walletId',
      'walletPublicKey',
      'amount',
      'serviceOrigin',
      'servicePublicKey',
      'serverId',
      'matchId',
      'termsHash',
      'nonce',
    ] as const
  ) {
    const payload = { ...hold.reservation.payload, [field]: field === 'amount' ? 11 : 'foreign' }
    const bad = {
      payload,
      signature: sign(null, signingBytes(payload), f.wallets[0].key.privateKey).toString('base64url'),
    }
    assert.notEqual((await f.submit(0, bad)).status, 200, field)
  }
  assert.equal((await f.submit(1, hold.reservation)).status, 403)
  assert.notEqual((await f.submit(0, { ...hold.reservation, signature: 'A'.repeat(86) })).status, 200)
  assert.equal(canonical((await f.h.request(f.path + '/spend', f.h.alice.token)).body), original)
  assert.equal((await f.h.request(f.path + '/spend', f.h.stranger.token)).status, 403)
})

test('deadline admits no new receipt and durably refunds known and unsubmitted original holds', async t => {
  const f = await fixture(t), a = f.reserve(0), b = f.reserve(1)
  await f.submit(0, a.reservation)
  f.advance(600001)
  await f.h.app.engine.serial(() => f.h.app.engine.tick())
  const final = (await f.h.request(f.path + '/spend', f.h.alice.token)).body
  assert.equal(final.phase, 'refund')
  assert.equal(final.decision.payload.reservations.length, 1)
  await f.submit(1, b.reservation)
  for (const [i, w] of f.wallets.entries()) {
    assert.equal(w.engine.applyDecision(final.decision, () => {}).exited, true)
    assert.deepEqual(f.balance(i), { available: 100, reserved: 0 })
  }
})

test('cancel versus final receipt serializes one finality; no capture can replace refund', async t => {
  const f = await fixture(t), a = f.reserve(0), b = f.reserve(1)
  await f.submit(0, a.reservation)
  const race = await Promise.all([f.h.request(f.path + '/spend-cancel', f.h.bob.token, {}), f.submit(1, b.reservation)])
  const final = (await f.h.request(f.path + '/spend', f.h.alice.token)).body
  assert(['active', 'refund'].includes(final.phase))
  if (final.phase === 'refund') {
    assert.equal(final.decision.payload.phase, 'refunded')
    assert.equal(canonical((await f.submit(1, b.reservation)).body.transaction.decision), canonical(final.decision))
  } else assert.equal(race[0].status, 409)
})

for (const name of ['gomoku', 'holdem']) {
  test(`latest ${name} settles signed winner payouts without issuing new Token`, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'game-package-'))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const pkg = (await build(name, dir)).pkg as unknown as GamePackage
    const f = await fixture(t, pkg)
    for (const i of [0, 1]) await f.submit(i, f.reserve(i).reservation)
    let room = (await f.h.request(f.path, f.h.alice.token)).body, count = 0
    while (room.status === 'playing') {
      assert(count < 120)
      const actor = f.wallets[room.turn].account
      room = (await f.h.request(f.path, actor.token)).body
      const action = name === 'gomoku'
        ? { type: 'place', x: Math.floor(count / 2), y: count % 2 }
        : { type: room.observation.legalActions.some((a: { type: string }) => a.type === 'call') ? 'call' : 'check' }
      const command = { expectedVersion: room.version, idempotencyKey: name + ':' + count, action }
      const result = await f.h.request(f.path + '/actions', actor.token, command)
      assert.equal(result.status, 200, JSON.stringify(result.body))
      room = result.body
      assert.deepEqual((await f.h.request(f.path + '/actions', actor.token, command)).body, room)
      count++
    }
    assert.equal(room.status, 'finished')
    assert.equal(room.settlement, 'settled')
    const final = (await f.h.request(f.path + '/spend', f.h.alice.token)).body
    for (const [i, w] of f.wallets.entries()) {
      w.engine.applyDecision(final.decision, () => {})
      assert.deepEqual(f.balance(i), { available: 90 + final.decision.payload.allocations[i].paid, reserved: 0 })
    }
    assert.equal(final.terms.payload.game.version, pkg.manifest.version)
    assert.equal(eTotal(f.e), 1000)
    assert((await f.h.request(f.path + '/replay', f.h.alice.token)).body.events.length > count)
  })
}

test('two independent remote sources/accounts consume the same original local wallet without alias wallets', async t => {
  const f = await fixture(t), key = generateKeyPairSync('ed25519')
  const second = await harness({
    walletSpend: {
      origin: 'https://second-game.example',
      trustedWalletPublicKeys: f.wallets.map(w => w.engine.wallet.walletPublicKey),
      privateKey: key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    },
  })
  t.after(() => second.app.close())
  const accounts = [second.alice, second.bob]
  assert.notEqual(accounts[0].account.id, f.h.alice.account.id)
  for (const [i, a] of accounts.entries()) {
    const challenge = (await second.request('/v1/wallet-bindings/challenge', a.token, {})).body
    const proof = f.wallets[i].binding.bindGameAccount(f.wallets[i].binding.quoteBinding(challenge))
    assert.equal((await second.request('/v1/wallet-bindings', a.token, proof)).status, 200)
  }
  const meta = (await second.request('/v1/packages', accounts[0].token, game())).body
  const consent = { packageHash: meta.hash, stake: 10, policy: 'equal-winners-v1', reviewState: 'unreviewed' }
  const created = await second.request('/v1/rooms', accounts[0].token, {
    packageHash: meta.hash,
    mode: 'token',
    stake: 10,
    consent,
  })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const path = '/v1/rooms/' + created.body.id
  await second.request(path + '/join', accounts[1].token, { consent })
  for (const a of accounts) await second.request(path + '/ready', a.token, { ready: true, consent })
  await second.request(path + '/start', accounts[0].token, {})
  const record = (await second.request(path + '/spend', accounts[0].token)).body
  for (const i of [0, 1]) {
    const a = f.reserve(i),
      b = f.wallets[i].session.reserve(
        f.wallets[i].session.quote(record.terms, record.requestIds[accounts[i].account.id]),
      )
    assert.equal(a.reservation.payload.walletId, b.reservation.payload.walletId)
    assert.notEqual(a.reservation.payload.gameAccountId, b.reservation.payload.gameAccountId)
    assert.notEqual(a.reservation.payload.serverId, b.reservation.payload.serverId)
    assert.deepEqual(f.balance(i), { available: 80, reserved: 20 })
  }
  const one = (await f.h.request(f.path + '/spend-cancel', f.h.alice.token, {})).body.transaction
  const two = (await second.request(path + '/spend-cancel', accounts[0].token, {})).body.transaction
  for (const [i, w] of f.wallets.entries()) {
    w.engine.applyDecision(one.decision, () => {})
    w.engine.applyDecision(two.decision, () => {})
    assert.deepEqual(f.balance(i), { available: 100, reserved: 0 })
  }
  assert.equal(f.e.store.one<{ n: number }>('SELECT COUNT(*) AS n FROM accounts WHERE kind=?', 'user')!.n, 2)
})

test('spend persistence failure rolls back room/event/receipts together; retry keeps original local hold', async t => {
  const f = await fixture(t), a = f.reserve(0), b = f.reserve(1)
  await f.submit(0, a.reservation)
  const room = await f.h.app.engine.load(f.path.slice('/v1/rooms/'.length))
  const body = String((await f.h.app.store.db.prepare('SELECT body FROM rooms WHERE id=?').get(room.id))!.body)
  const before = canonical((await f.h.request(f.path + '/spend', f.h.alice.token)).body)
  const count = async () =>
    (await f.h.app.store.db.prepare('SELECT COUNT(*) AS n FROM events WHERE room_id=?').get(room.id))!.n
  const events = await count()
  f.h.app.store.db.exec(
    "CREATE TRIGGER deny_spend BEFORE UPDATE ON game_spend_transactions BEGIN SELECT RAISE(ABORT,'spend_fixture_failure'); END",
  )
  assert.equal((await f.submit(1, b.reservation)).status, 500)
  assert.equal(String((await f.h.app.store.db.prepare('SELECT body FROM rooms WHERE id=?').get(room.id))!.body), body)
  assert.equal(await count(), events)
  assert.equal(canonical((await f.h.request(f.path + '/spend', f.h.alice.token)).body), before)
  assert.deepEqual(f.balance(1), { available: 90, reserved: 10 })
  f.h.app.store.db.exec('DROP TRIGGER deny_spend')
  assert.equal((await f.submit(1, b.reservation)).body.view.status, 'playing')
  assert.equal(await count(), Number(events) + 1)
})

test('Game server restart preserves source key/account binding/terms/request IDs and first receipts byte-for-byte', async t => {
  const f = await fixture(t), hold = f.reserve(0)
  await f.submit(0, hold.reservation)
  const before = canonical((await f.h.request(f.path + '/spend', f.h.alice.token)).body)
  const identity = (await f.h.request('/v1/spend/identity')).body
  await f.h.app.close()
  const restored = createGameServer({
    database: f.database,
    tickMs: 0,
    walletSpend: { origin: 'https://game.example', privateKey: f.serviceKey },
  })
  f.h.app = restored
  await new Promise<void>(resolve => restored.server.listen(0, '127.0.0.1', resolve))
  const address = restored.server.address() as { port: number }
  const request = async (path: string, token?: string, body?: unknown) => {
    const response = await fetch('http://127.0.0.1:' + address.port + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.deepEqual(await request('/v1/spend/identity'), identity)
  assert.equal(canonical(await request(f.path + '/spend', f.h.alice.token)), before)
  const wallet = await request('/v1/wallet-bindings', f.h.alice.token)
  assert.equal(wallet.binding.payload.walletId, hold.reservation.payload.walletId)
  const cancelled = await request(f.path + '/spend-cancel', f.h.bob.token, {})
  const decision = canonical(cancelled.transaction.decision)
  assert.equal(canonical((await request(f.path + '/spend-cancel', f.h.alice.token, {})).transaction.decision), decision)
  const transactions = await request('/v1/me/spend-transactions', f.h.alice.token)
  assert.equal(transactions.transactions.length, 1)
  assert.equal(canonical(transactions.transactions[0].transaction.decision), decision)
  assert.equal(
    canonical((await request(f.path + '/spend-receipts', f.h.alice.token, hold.reservation)).transaction.decision),
    decision,
  )
  f.wallets[0].engine.applyDecision(cancelled.transaction.decision, () => {})
  assert.deepEqual(f.balance(0), { available: 100, reserved: 0 })
})

test('Holdem cashout checkpoints survive disconnect and preserve other players holds through the final payout', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pool-exit-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const pkg = (await build('holdem', dir)).pkg as unknown as GamePackage
  const f = await fixture(t, pkg, { players: 3, rounds: 3 })
  for (const i of [0, 1, 2]) assert.equal((await f.submit(i, f.reserve(i).reservation)).status, 200)
  let room = (await f.h.request(f.path, f.h.alice.token)).body
  const ownerClose = await f.h.request(f.path + '/close', f.h.alice.token, {})
  assert.equal(ownerClose.status, 409, 'owner cannot refund a live pool to erase losses')
  let n = 0
  // Finish first hand without eliminating anyone; remaining chips become cashout rights.
  while (!room.observation.betweenHands && room.status === 'playing') {
    assert(n++ < 30)
    const actor = f.wallets[room.turn].account
    room = (await f.h.request(f.path, actor.token)).body
    const type = room.observation.legalActions.some((a: { type: string }) => a.type === 'call') ? 'call' : 'check'
    const r = await f.h.request(f.path + '/actions', actor.token, {
      expectedVersion: room.version,
      idempotencyKey: 'hand:' + n,
      action: { type },
    })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    room = r.body
  }
  assert.equal(room.status, 'playing')
  const amount = room.observation.players[0].stack
  assert.equal((await f.h.request(f.path + '/leave', f.h.alice.token, {})).status, 200)
  const checkpoint = (await f.h.request(f.path + '/spend', f.h.alice.token)).body
  assert.equal(checkpoint.decisions.length, 1)
  assert.equal(checkpoint.decisions[0].payload.phase, 'active')
  assert.equal(checkpoint.decisions[0].payload.allocations[0].paid, amount)
  f.wallets[0].engine.applyDecision(checkpoint.decisions[0], () => {})
  assert.deepEqual(f.balance(0), { available: 90 + amount, reserved: 0 })
  for (const i of [1, 2]) assert.deepEqual(f.balance(i), { available: 90, reserved: 10 })
  // A second leave finishes this table. The offline wallet replays both durable decisions.
  assert.equal((await f.h.request(f.path + '/leave', f.h.bob.token, {})).status, 200)
  const final = (await f.h.request(f.path + '/spend', f.h.alice.token)).body
  assert.equal(final.decisions.length, 2)
  assert.equal(final.phase, 'capture')
  assert.equal(final.decisions[1].payload.previousHash, await digest(final.decisions[0].payload))
  for (const [i, w] of f.wallets.entries()) {
    for (const d of final.decisions) w.engine.applyDecision(d, () => {})
    assert.deepEqual(f.balance(i), { available: 90 + final.decision.payload.allocations[i].paid, reserved: 0 })
  }
  assert.equal(eTotal(f.e), 1000)
})

test('historical fee receipts recover by original burn semantics and are never reinterpreted as pool payouts', async t => {
  const f = await fixture(t), facade = f.h.app.engine.spend!
  const original = await f.h.app.engine.load(f.path.slice('/v1/rooms/'.length))
  const room = { ...original, matchId: original.matchId + ':historical' }
  const legacy = new LegacyGameSpend(f.h.app.store, facade.service)
  const record = await legacy.prepare(room)
  for (const w of f.wallets) {
    const oldWallet = w.engine.wallet, session = oldWallet.openSession(() => {})
    const receipt = session.reserve(session.quote(record.terms, record.requestIds[w.account.account.id])).reservation
    await legacy.accept(w.account.account, record, receipt)
    session.close()
  }
  record.phase = 'active'
  await f.h.app.store.atomic(() => legacy.write(room.id, record))
  const loaded = await facade.load(room.matchId)
  await facade.final(loaded, 'capture', room)
  assert.equal(loaded.terms.payload.contract, 'economy.spend-terms/v1')
  assert.equal(loaded.terms.payload.policy, 'capture-and-release')
  for (const [i, w] of f.wallets.entries()) {
    w.engine.wallet.applyDecision(loaded.decision, () => {})
    assert.deepEqual(f.balance(i), { available: 90, reserved: 0 })
  }
  assert.equal(eTotal(f.e), 980)
})

test('a self-bound wallet cannot enter a Token pool until its authority is enrolled', async t => {
  const f = await fixture(t)
  const unknown = generateKeyPairSync('ed25519')
  f.e.auth.createAccount('original', 'untrusted-wallet')
  const local = new LocalSpendEngine(f.e.store, 'original', 'untrusted-wallet', unknown.privateKey)
  const session = local.openSession(() => {})
  const challenge = await f.h.request('/v1/wallet-bindings/challenge', f.h.stranger.token, {})
  const proof = session.bindGameAccount(session.quoteBinding(challenge.body))
  assert.equal((await f.h.request('/v1/wallet-bindings', f.h.stranger.token, proof)).status, 200)
  const created = await f.h.request('/v1/rooms', f.h.stranger.token, {
    packageHash: f.record.terms.payload.game.digest,
    mode: 'token',
    stake: 10,
  })
  assert.equal(created.status, 403)
  assert.equal(created.body.error.code, 'wallet_authority_not_enrolled')
})
