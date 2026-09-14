import { applyWorkersMigrations } from './apply-workers-migrations.mjs'
import { Miniflare } from 'miniflare'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { D1Store } from '../dist/server/workers/d1-store.js'
import { game } from '../dist/tests/server/helpers.js'
import { generateKeyPairSync, sign } from 'node:crypto'
import { Accounts } from '../dist/server/accounts.js'
import { ManagedAccountAuth } from '../dist/server/managed-auth.js'
import * as codec from '@cordisx/protocol/managed-source/v1'
const mf = new Miniflare({
  modules: true,
  scriptPath: 'dist/server/index.js',
  modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  bindings: { AUTH_POLICY: 'guest-allowed' },
})
try {
  const db = await mf.getD1Database('DB')
  await applyWorkersMigrations(db)
  const a = await D1Store.open(db), b = await D1Store.open(db)
  assert.equal(a.serverId, b.serverId)
  await db.prepare('INSERT INTO rooms VALUES (?,?)').bind('cas', JSON.stringify({ version: 1, matchId: 'm' })).run()
  let count = 0, release
  const barrier = new Promise(resolve => {
    release = resolve
  })
  const mutation = store =>
    store.atomic(async () => {
      const row = await store.db.prepare('SELECT body FROM rooms WHERE id=?').get('cas')
      if (++count === 2) release()
      await barrier
      const room = JSON.parse(row.body)
      room.version++
      await store.db.prepare('UPDATE rooms SET body=? WHERE id=?').run(JSON.stringify(room), 'cas')
      await store.db.prepare('INSERT INTO events VALUES (?,?,?)').run('cas', room.version, '{}')
    })
  const races = await Promise.allSettled([mutation(a), mutation(b)])
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 1)
  assert.match(String(races.find(r => r.status === 'rejected').reason), /version_conflict/)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM events WHERE room_id=?').bind('cas').first()).n, 1)
  console.log('PASS independent D1 sessions CAS: one room/event commit')
  await db.prepare(
    'INSERT INTO grants(id,hash,room_id,match_id,seat_id,account_id,expires,max_actions) VALUES (?,?,?,?,?,?,?,?)',
  ).bind('g', 'gh', 'cas', 'm', 'seat', 'account', Date.now() + 60000, 1).run()
  const grantMutation = store =>
    store.atomic(async () => {
      const row = await store.db.prepare('SELECT body FROM rooms WHERE id=?').get('cas')
      const room = JSON.parse(row.body)
      room.version++
      await store.db.prepare('UPDATE rooms SET body=? WHERE id=?').run(JSON.stringify(room), 'cas')
      await store.db.prepare('INSERT INTO events VALUES (?,?,?)').run('cas', room.version, '{}')
      await store.db.prepare('INSERT INTO commands VALUES (?,?,?,?,?)').run(
        'cas',
        'seat',
        'grant-' + room.version,
        'd',
        '{}',
      )
      await store.requireChanges(
        'UPDATE grants SET used=used+1 WHERE id=? AND used<max_actions AND revoked=0 AND expires>?',
        ['g', Date.now()],
        1,
        'grant_budget_exhausted',
      )
    })
  await grantMutation(a)
  const before = await db.prepare('SELECT body FROM rooms WHERE id=?').bind('cas').first()
  await assert.rejects(grantMutation(b), /grant_budget_exhausted/)
  assert.deepEqual(await db.prepare('SELECT body FROM rooms WHERE id=?').bind('cas').first(), before)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM commands').first()).n, 1)
  assert.equal((await db.prepare('SELECT used FROM grants WHERE id=?').bind('g').first()).used, 1)
  await assert.rejects(a.atomic(async () => {
    await a.db.prepare('UPDATE rooms SET body=? WHERE id=?').run('{}', 'cas')
    await a.db.prepare('INSERT INTO transaction_reads(id,valid) VALUES (?,0)').run('forced-later-failure')
  }))
  assert.deepEqual(await db.prepare('SELECT body FROM rooms WHERE id=?').bind('cas').first(), before)
  console.log('PASS grant max1 SQL guard and later batch failure roll back room/events/commands')

  await db.prepare('UPDATE grants SET used=0,revoked=0 WHERE id=?').bind('g').run()
  let arrived, resume
  const readReached = new Promise(resolve => {
    arrived = resolve
  })
  const continueCommit = new Promise(resolve => {
    resume = resolve
  })
  const inFlight = a.atomic(async () => {
    await a.db.prepare('SELECT body FROM rooms WHERE id=?').get('cas')
    await a.db.prepare('UPDATE rooms SET body=? WHERE id=?').run('{}', 'cas')
    arrived()
    await continueCommit
    await a.requireChanges(
      'UPDATE grants SET used=used+1 WHERE id=? AND used<max_actions AND revoked=0',
      ['g'],
      1,
      'grant_budget_exhausted',
    )
  })
  await readReached
  await b.db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run('g')
  resume()
  await assert.rejects(inFlight, /grant_budget_exhausted/)
  assert.deepEqual(await db.prepare('SELECT body FROM rooms WHERE id=?').bind('cas').first(), before)
  assert.equal((await db.prepare('SELECT used FROM grants WHERE id=?').bind('g').first()).used, 0)
  console.log('PASS revoke interleaves before commit; grant and room change rejected together')
  const host = generateKeyPairSync('ed25519'), server = generateKeyPairSync('ed25519')
  const binding = {
    origin: 'http://127.0.0.1:58973',
    sourceId: a.serverId,
    instanceId: a.serverId,
    audience: 'source-account',
  }
  const trust = {
    binding,
    hostPublicKey: host.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    serverPrivateKey: server.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
  const authA = new ManagedAccountAuth(new Accounts(a, Date.now), a, trust, codec)
  const authB = new ManagedAccountAuth(new Accounts(b, Date.now), b, trust, codec)
  const challenge = await authA.challenge({ sourceId: a.serverId, instanceId: a.serverId, audience: 'source-account' })
  const payload = {
    ...challenge.payload,
    contract: 'cordisx.managed-source-assertion/v1',
    subject: 'codex:' + Buffer.alloc(32, 1).toString('base64url'),
  }
  const assertion = {
    payload,
    signature: sign(null, codec.managedSourceBytes(payload), host.privateKey).toString('base64url'),
  }
  const authRaces = await Promise.allSettled([authA.session(assertion), authB.session(assertion)])
  assert.equal(authRaces.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM managed_identities').first()).n, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n, 1)
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM managed_nonces').first()).n, 0)
  console.log('PASS durable nonce across independent auth instances; one account/session commit')
  async function request(path, token, body, ip = '127.0.0.1') {
    const response = await mf.dispatchFetch('http://localhost' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'CF-Connecting-IP': ip,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  const alice = (await request('/v1/accounts', undefined, { name: 'alice', password: 'correct-horse-battery' })).body
  const bob = (await request('/v1/accounts', undefined, { name: 'bobby', password: 'correct-horse-battery' })).body
  async function start(pkg) {
    const published = await request('/v1/packages', alice.token, pkg)
    assert.equal(published.status, 200, JSON.stringify(published.body))
    const room =
      (await request('/v1/rooms', alice.token, { packageHash: published.body.hash, mode: 'score', allowAgents: true }))
        .body
    await request(`/v1/rooms/${room.id}/join`, bob.token, {})
    await request(`/v1/rooms/${room.id}/ready`, alice.token, { ready: true })
    await request(`/v1/rooms/${room.id}/ready`, bob.token, { ready: true })
    const result = await request(`/v1/rooms/${room.id}/start`, alice.token, {})
    assert.equal(result.body.status, 'playing', JSON.stringify(result.body))
    return result.body
  }
  const room = await start(game())
  const input = { expectedVersion: room.version, action: { type: 'move' } }
  const httpRace = await Promise.all(
    ['different-1', 'different-2'].map(idempotencyKey =>
      request(`/v1/rooms/${room.id}/actions`, alice.token, { ...input, idempotencyKey })
    ),
  )
  assert.deepEqual(httpRace.map(r => r.status).sort(), [200, 409])
  console.log('PASS actual HTTP different-key same-version CAS')
  for (
    const [name, act] of Object.entries({
      loop: 'while(true){}',
      alloc: "const allocation=[];while(true)allocation.push(new Array(100000).fill('x'));",
      throw: "throw Error('bad');",
      toJSON: 's.n++;return {state:s,turn:1,toJSON(){while(true){}}};',
    })
  ) {
    const pkg = game()
    pkg.manifest.id = 'malicious-' + name.toLowerCase()
    pkg.rules = pkg.rules.replace(
      "if(a.type!=='move')throw Error('invalid_action');s.n++;return s.n>=2?{state:s,turn:null,done:{winners:[1],scores:[0,1]}}:{state:s,turn:1}",
      act,
    )
    const active = await start(pkg)
    const state = await db.prepare('SELECT body FROM rooms WHERE id=?').bind(active.id).first()
    const result = await request(`/v1/rooms/${active.id}/actions`, alice.token, {
      expectedVersion: active.version,
      idempotencyKey: 'bad',
      action: { type: 'move' },
    })
    assert.equal(result.status, 422, JSON.stringify(result.body))
    assert.deepEqual(await db.prepare('SELECT body FROM rooms WHERE id=?').bind(active.id).first(), state)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM commands WHERE room_id=?').bind(active.id).first()).n, 0)
    assert.equal((await request('/health')).status, 200)
    console.log('PASS malicious ' + name + ' bounded, no room/command write, health recovers')
  }

  const players = [alice, bob]
  for (let index = 2; index < 8; index++) {
    const registered = await request('/v1/accounts', undefined, {
      name: 'player_' + index,
      password: 'correct-horse-battery',
    })
    assert.equal(registered.status, 200)
    players.push(registered.body)
  }
  const large = game()
  large.manifest.id = 'large-projections'
  large.manifest.maxPlayers = 8
  large.rules =
    "globalThis.game={setup(){return {state:{n:0},turn:0}},act(s){return {state:s,turn:1}},timeout(s){return {state:s,turn:null,done:{winners:[0]}}},observe(){return 'x'.repeat(250000)}}"
  large.ui.render = "globalThis.render=()=>({version:1,root:{type:'text',text:'small'}})"
  const published = await request('/v1/packages', alice.token, large)
  assert.equal(published.status, 200)
  const created = await request('/v1/rooms', alice.token, {
    packageHash: published.body.hash,
    mode: 'score',
    allowAgents: true,
  })
  assert.equal(created.status, 200)
  const largePath = '/v1/rooms/' + created.body.id
  for (const player of players.slice(1)) {
    assert.equal((await request(largePath + '/join', player.token, {})).status, 200)
  }
  for (const player of players) {
    assert.equal((await request(largePath + '/ready', player.token, { ready: true })).status, 200)
  }
  const durable = await db.prepare('SELECT body FROM rooms WHERE id=?').bind(created.body.id).first()
  const eventsBefore =
    (await db.prepare('SELECT COUNT(*) AS n FROM events WHERE room_id=?').bind(created.body.id).first()).n
  const rejected = await request(largePath + '/start', alice.token, {})
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body))
  assert.equal(rejected.body.error.code, 'persistence_limit')
  assert.deepEqual(await db.prepare('SELECT body FROM rooms WHERE id=?').bind(created.body.id).first(), durable)
  assert.equal(JSON.parse(durable.body).status, 'waiting')
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM events WHERE room_id=?').bind(created.body.id).first()).n,
    eventsBefore,
  )
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM commands WHERE room_id=?').bind(created.body.id).first()).n,
    0,
  )
  console.log('PASS eight real seats oversized projections return422; waiting room/events unchanged')
  // Each request constructs another runtime; the bucket persists in D1 across instances.
  const rates = await Promise.all(
    Array.from({ length: 16 }, () => request('/v1/guests', undefined, {}, '198.51.100.24')),
  )
  assert(rates.some(r => r.status === 429))
  assert.equal(
    (await db.prepare('SELECT count FROM rate_buckets WHERE key=?').bind('198.51.100.24:auth').first()).count,
    16,
  )
  console.log('PASS durable auth rate bucket across requests')
} finally {
  await mf.dispose()
}
