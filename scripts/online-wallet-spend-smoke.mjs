import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Economy, LocalSpendEngine } from '@cordisx/economy/server'
import {
  canonical,
  digest,
  parseDecision,
  parseSigned,
  parseTerms,
  publicKey,
  verifySigned,
} from '@cordisx/economy/spend'

// Run only by the integrating operator. Uses fresh test wallets; no Host/Native authority or original usage DB.
const arguments_ = process.argv.slice(2), loopback = arguments_[0] === '--allow-loopback'
if (loopback) arguments_.shift()
assert.equal(
  arguments_.length,
  3,
  'Usage: node scripts/online-wallet-spend-smoke.mjs [--allow-loopback] ORIGIN GOMOKU_JSON HOLDEM_JSON',
)
const [origin, ...packagePaths] = arguments_, url = new URL(origin)
assert.equal(url.origin, origin, 'Use a canonical origin without path/query/credentials')
assert(!url.username && !url.password)
assert(
  url.protocol === 'https:'
    || loopback && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
  'Actual HTTPS origin required; explicit loopback flag is test-only',
)
const packages = await Promise.all(packagePaths.map(async path => JSON.parse(await readFile(resolve(path), 'utf8'))))
assert.deepEqual(packages.map(pkg => [pkg.manifest.id, pkg.manifest.version]), [['gomoku', '1.5.12'], [
  'texas-holdem',
  '1.4.10',
]], 'Supply the frozen latest shipped packages in Gomoku/Holdem order')
const runId = 'fees-' + Date.now() + '-' + randomBytes(6).toString('hex'),
  directory = mkdtempSync(join(tmpdir(), 'game-online-fees-'))
const economy = new Economy(join(directory, 'wallet.sqlite')),
  accounts = [],
  wallets = [],
  report = { runId, origin, authority: 'temporary SQLite test fixture; not Native or actual usage income', games: [] }
async function request(path, token, body, method = body === undefined ? 'GET' : 'POST', expected = 200) {
  const target = new URL(path, origin)
  assert.equal(target.origin, origin)
  const response = await fetch(target, {
    method,
    redirect: 'manual',
    credentials: 'omit',
    signal: AbortSignal.timeout(45000),
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  assert(response.status < 300 || response.status >= 400, 'Redirect rejected')
  const reader = response.body?.getReader()
  assert(reader, 'Empty response')
  const decoder = new TextDecoder()
  let text = '', bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > 2500000) {
        await reader.cancel()
        throw new Error('Response exceeds smoke budget')
      }
      text += decoder.decode(part.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  assert(response.headers.get('content-type')?.includes('application/json'), `Non-JSON ${response.status} ${path}`)
  const value = JSON.parse(text)
  if (expected !== null) assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`)
  return { status: response.status, value }
}
try {
  const identity = (await request('/v1/spend/identity')).value
  assert.deepEqual(Object.keys(identity).sort(), ['contract', 'serverId', 'serviceOrigin', 'servicePublicKey'].sort())
  assert.equal(identity.contract, 'economy.spend-service/v1')
  assert.equal(identity.serviceOrigin, origin)
  publicKey(identity.servicePublicKey)
  const handshake = (await request('/v1/handshake')).value
  assert.equal(handshake.serverId, identity.serverId)
  assert.deepEqual(handshake.walletSpend, {
    contract: 'economy.spend/v1',
    serviceOrigin: origin,
    servicePublicKey: identity.servicePublicKey,
    serverId: identity.serverId,
  })
  assert.equal(handshake.economy, null)
  assert.equal(handshake.economyAvailable, false)
  economy.auth.createInstance('fixture-original', 10000)
  for (const i of [0, 1]) {
    const account =
      (await request('/v1/accounts', undefined, { name: runId + '-' + i, password: randomBytes(24).toString('hex') }))
        .value
    accounts.push(account)
    const id = 'original-' + i, key = generateKeyPairSync('ed25519')
    economy.auth.createAccount('fixture-original', id)
    // Test funding in a fresh isolated DB only; no grant/migration/income request reaches the online Game.
    economy.store.transaction(() =>
      economy.store.transfer('fixture-original', '$issuer', id, 1000, 'test-funding', runId, Date.now())
    )
    const engine = new LocalSpendEngine(economy.store, 'fixture-original', id, key.privateKey),
      session = engine.openSession(() => {})
    wallets.push({ engine, session, id })
    const challenge = (await request('/v1/wallet-bindings/challenge', account.token, {})).value
    assert(await verifySigned(challenge, identity.servicePublicKey))
    assert.equal(challenge.payload.gameAccountId, account.account.id)
    const proof = session.bindGameAccount(session.quoteBinding(challenge))
    const binding = (await request('/v1/wallet-bindings', account.token, proof)).value.binding
    assert.equal(canonical(binding), canonical(proof))
  }
  for (const pkg of packages) {
    const metadata = (await request('/v1/packages', accounts[0].token, pkg)).value
    assert.equal(metadata.hash, await digest(pkg))
    const stake = 10,
      policy = pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1',
      consent = { packageHash: metadata.hash, stake, policy, reviewState: 'unreviewed' }
    let room = (await request('/v1/rooms', accounts[0].token, {
      packageHash: metadata.hash,
      mode: 'token',
      stake,
      policy,
      consent,
      maxPlayers: 2,
      turnTimeoutMs: 600000,
      config: pkg.manifest.id === 'gomoku' ? { boardSize: 15 } : {},
    })).value
    const path = '/v1/rooms/' + encodeURIComponent(room.id)
    await request(path + '/join', accounts[1].token, { consent })
    for (const account of accounts) await request(path + '/ready', account.token, { ready: true, consent })
    await request(path + '/start', accounts[0].token, {})
    const record = (await request(path + '/spend', accounts[0].token)).value,
      terms = parseSigned(record.terms, parseTerms)
    assert(await verifySigned(terms, identity.servicePublicKey))
    assert.equal(record.termsHash, await digest(terms.payload))
    assert.equal(terms.payload.serviceOrigin, origin)
    assert.equal(terms.payload.serverId, identity.serverId)
    assert.equal(terms.payload.servicePublicKey, identity.servicePublicKey)
    assert.equal(terms.payload.matchId, room.matchId)
    assert.equal(terms.payload.game.digest, metadata.hash)
    assert.equal(terms.payload.game.version, pkg.manifest.version)
    assert.equal(terms.payload.policy, 'capture-and-release')
    for (const [i, w] of wallets.entries()) {
      const participant = terms.payload.participants.find(p => p.gameAccountId === accounts[i].account.id)
      assert(participant)
      assert.equal(participant.walletId, w.engine.walletId)
      assert.equal(participant.amount, stake)
      const requestId = record.requestIds[accounts[i].account.id]
      assert.equal(
        requestId,
        'spend:'
          + await digest({
            serviceOrigin: origin,
            servicePublicKey: identity.servicePublicKey,
            serverId: identity.serverId,
            matchId: room.matchId,
            termsHash: record.termsHash,
            ...participant,
          }),
      )
      const hold = w.session.reserve(w.session.quote(terms, requestId))
      assert.deepEqual(w.engine.lookupRequest(terms.payload, requestId), hold)
      const accepted = (await request(path + '/spend-receipts', accounts[i].token, hold.reservation)).value
      assert.equal(accepted.view.status, i === 0 ? 'funding' : 'playing')
      await request(path + '/spend-receipts', accounts[i].token, hold.reservation)
    }
    room = (await request(path, accounts[0].token)).value
    let actions = 0
    while (room.status === 'playing') {
      assert(actions < 120, 'Exceeded bounded match actions')
      const actor = accounts[room.turn]
      assert(actor)
      room = (await request(path, actor.token)).value
      if (pkg.manifest.id === 'texas-holdem') {
        assert.deepEqual(room.observation.players[1 - room.turn].hole, [null, null])
      }
      const action = pkg.manifest.id === 'gomoku'
        ? { type: 'place', x: Math.floor(actions / 2), y: actions % 2 }
        : { type: room.observation.legalActions.some(item => item.type === 'call') ? 'call' : 'check' }
      const command = {
        expectedVersion: room.version,
        idempotencyKey: runId + ':' + pkg.manifest.id + ':' + actions,
        action,
      }
      room = (await request(path + '/actions', actor.token, command)).value
      assert.deepEqual(
        (await request(path + '/actions', actor.token, command)).value,
        room,
        'Committed ACK must be stable',
      )
      actions++
    }
    assert.equal(room.status, 'finished')
    assert.equal(room.settlement, 'settled')
    const final = (await request(path + '/spend', accounts[0].token)).value,
      decision = parseSigned(final.decision, parseDecision)
    assert.equal(final.phase, 'capture')
    assert.equal(decision.payload.action, 'capture')
    assert(await verifySigned(decision, identity.servicePublicKey))
    assert.equal(decision.payload.termsHash, record.termsHash)
    assert.equal(decision.payload.entries.length, 2)
    assert(
      decision.payload.entries.every(entry =>
        entry.captureAmount === stake && entry.captureAmount <= entry.reservation.payload.amount
      ),
    )
    assert.equal(canonical((await request(path + '/spend', accounts[1].token)).value.decision), canonical(decision))
    for (const w of wallets) {
      const outcome = w.engine.applyDecision(decision, () => {})
      assert.equal(outcome.length, 1)
      assert.equal(outcome[0].settlement.payload.captured, stake)
      assert.equal(outcome[0].settlement.payload.released, 0)
      assert(await verifySigned(outcome[0].settlement, w.engine.walletPublicKey))
      assert.deepEqual(w.engine.applyDecision(decision, () => {}), outcome)
    }
    const events = (await request(path + '/replay', accounts[0].token)).value.events
    assert(events.length > actions)
    report.games.push({
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      roomId: room.id,
      actions,
      replayEvents: events.length,
      feePerWallet: stake,
      decisionHash: await digest(decision.payload),
    })
  }
  for (const w of wallets) {
    assert.deepEqual(
      economy.store.one('SELECT available,reserved FROM accounts WHERE instance=? AND id=?', 'fixture-original', w.id),
      { available: 980, reserved: 0 },
    )
  }
  assert.equal(economy.store.one('SELECT supply FROM instances').supply, 9960)
  assert.equal(economy.store.one('SELECT COUNT(*) AS n FROM workIncomeReceipts').n, 0)
  let cards = await request('/v1/rooms', undefined, undefined, 'GET', null)
  if ([401, 403].includes(cards.status)) cards = await request('/v1/rooms', accounts[0].token)
  assert.equal(cards.status, 200)
  const publicData = JSON.stringify(cards.value)
  for (const field of ['walletPublicKey', 'walletId', 'requestIds', 'receipts', 'signature']) {
    assert(!publicData.includes('"' + field + '"'), 'Public card leaked ' + field)
  }
  for (const w of wallets) assert(!publicData.includes(w.engine.walletId))
  for (const a of accounts) {
    assert.equal((await request('/v1/me/spend-transactions', a.token)).value.transactions.length, 2)
  }
  assert.deepEqual((await request('/v1/spend/identity')).value, identity, 'Service key/server ID changed during smoke')
  console.log(
    JSON.stringify(
      { ...report, serverId: identity.serverId, servicePublicKey: identity.servicePublicKey, status: 'passed' },
      null,
      2,
    ),
  )
} finally {
  const cleanup = []
  for (const a of accounts) {
    try {
      await request('/v1/session', a.token, undefined, 'DELETE')
      cleanup.push('revoked')
    } catch {
      cleanup.push('revocation-failed')
    }
  }
  console.log(JSON.stringify({ runId, testSessionCleanup: cleanup }))
  economy.close()
  rmSync(directory, { recursive: true, force: true })
}
