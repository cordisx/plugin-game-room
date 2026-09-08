import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createGameServer } from '../dist/server/http.js'
import { HttpEconomy } from '../dist/server/economy.js'
import { build as buildGame } from '../games/tools/package.mjs'

// Explicit dependency checkout: build it first. Never substitute a fixture ledger.
assert.ok(process.env.ECONOMY_REPOSITORY, 'Set ECONOMY_REPOSITORY to the built economy checkout')
const { Economy, createEconomyServer } = await import(
  pathToFileURL(
    resolve(process.env.ECONOMY_REPOSITORY, 'dist/server/index.js'),
  ).href
)

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}

test('real game and economy HTTP: multiple owned seats, consent, settlement, purchase and next match', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'game-economy-integration-'))
  const economy = new Economy(join(directory, 'economy.sqlite'))
  const economicServer = createEconomyServer(economy)
  let game
  t.after(async () => {
    if (game) await game.close()
    await new Promise(resolve => economicServer.close(resolve))
    economy.close()
    await rm(directory, { recursive: true, force: true })
  })
  economy.auth.createInstance('integration', 10000)
  const reward = economy.auth.createService('integration', 'sponsor', 'welcome', 100).token
  const service = economy.auth.createService('integration', 'game-service', '*', 100).token
  economy.commerce.createSource('integration', 'welcome', 'sponsor', 'reward', 1000, 1000, 100)
  economy.commerce.createItem('integration', 'pet.integration-apple', 'Apple', 20, 'pet')
  const economicUrl = await listen(economicServer)
  game = createGameServer({
    database: join(directory, 'game.sqlite'),
    tickMs: 0,
    economy: new HttpEconomy(economicUrl, service, 'game-service'),
  })
  const gameUrl = await listen(game.server)
  let serial = 0
  async function request(base, path, token, body, expected = 200, key = `integration-${++serial}`) {
    const response = await fetch(base + '/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const value = await response.json()
    assert.equal(response.status, expected, `${path} ${body?.idempotencyKey ?? ''}: ${JSON.stringify(value)}`)
    return value
  }
  const players = []
  for (const name of ['alice', 'bobby']) {
    economy.auth.createAccount('integration', name)
    const wallet = await request(economicUrl, '/session', null, {
      code: economy.auth.enrollment('integration', name),
    })
    await request(economicUrl, '/rewards/grant', reward, {
      sourceId: 'welcome',
      accountId: name,
      eventId: `welcome:${name}`,
      amount: 100,
    })
    const player = await request(gameUrl, '/accounts', null, { name, password: 'integration-password-123' })
    const proof = await request(economicUrl, '/link-proofs', wallet.token, {
      gameServiceId: 'game-service',
      gameAccountId: player.account.id,
    })
    await request(gameUrl, '/economy/link', player.token, { code: proof.code })
    await request(economicUrl, '/me', proof.code, undefined, 401)
    players.push({ ...player, wallet: wallet.token, name })
  }
  const [alice, bob] = players
  const packageData = {
    packageVersion: 1,
    manifest: {
      id: 'integration-game',
      version: '1.0.0',
      name: 'Integration game',
      minPlayers: 4,
      maxPlayers: 4,
      modes: ['token'],
    },
    rules: `globalThis.game={
      setup(ctx){return {state:{move:0,hands:ctx.seats.map((_,i)=>'seat-secret-'+i)},turn:0}},
      observe(s,i){return {hand:s.hands[i],move:s.move,legalActions:[{type:'move'}]}},
      act(s,a){if(a.type!=='move')throw Error('invalid_action');s.move++;
        return s.move===4?{state:s,turn:null,done:{winners:[3]}}:{state:s,turn:s.move}},
      timeout(s){return {state:s,turn:null,done:{winners:[]}}}
    }`,
    ui: {
      format: 'scene-v1',
      render: `globalThis.render=function(observation,context){
        if(typeof process!=='undefined'||typeof fetch!=='undefined')throw Error('unexpected host');
        return {version:1,root:{type:'stack',children:[
          {type:'text',text:observation.hand},
          {type:'button',label:'Move',action:{type:'move'},disabled:!context.canAct}
        ]}};
      }`,
    },
  }
  const published = await request(gameUrl, '/packages', alice.token, packageData)
  assert.equal(published.reviewState, 'unreviewed')
  const consent = { packageHash: published.hash, stake: 10, policy: 'equal-winners-v1', reviewState: 'unreviewed' }
  let view = await request(gameUrl, '/rooms', alice.token, {
    packageHash: published.hash,
    mode: 'token',
    stake: 10,
    maxPlayers: 4,
    allowAgents: true,
    consent,
  })
  const roomPath = `/rooms/${view.id}`
  await request(gameUrl, roomPath + '/join', bob.token, { consent })
  const agentSeats = []
  for (const participantId of ['alice-agent-one', 'alice-agent-two']) {
    const result = await request(gameUrl, roomPath + '/agent-seats', alice.token, {
      participantId,
      name: participantId,
      consent,
    })
    agentSeats.push(result.seat)
  }
  view = await request(gameUrl, roomPath, alice.token)
  assert.equal(view.seats.length, 4)
  for (const seat of view.seats) {
    await request(gameUrl, roomPath + '/ready', seat.accountId === alice.account.id ? alice.token : bob.token, {
      ready: true,
      seatId: seat.id,
      consent,
    })
  }
  await request(gameUrl, roomPath + '/start', alice.token, {})
  await game.engine.tick()
  view = await request(gameUrl, roomPath, alice.token)
  assert.equal(view.status, 'funding')
  assert.ok(view.funding)
  const oldMatch = view.matchId
  const funding = { agreementId: view.funding.agreementId, termsHash: view.funding.termsHash }
  const agreement = await request(economicUrl, `/agreements/${funding.agreementId}`, alice.wallet)
  assert.deepEqual(agreement.participants.map(p => [p.accountId, p.amount]).sort(), [['alice', 30], ['bobby', 10]])
  assert.equal(agreement.participants.find(p => p.accountId === 'alice').participantIds.length, 3)
  await request(economicUrl, '/reserve', service, funding, 403)
  await request(economicUrl, '/reserve', alice.wallet, funding, 200, 'reserve-alice-first')
  await request(economicUrl, '/reserve', alice.wallet, funding, 200, 'reserve-alice-first')
  await game.engine.tick()
  assert.equal((await request(gameUrl, roomPath, alice.token)).status, 'funding')
  await request(economicUrl, '/reserve', bob.wallet, funding)
  await game.engine.tick()
  view = await request(gameUrl, roomPath, alice.token)
  assert.equal(view.status, 'playing')
  const grants = []
  for (const seat of agentSeats) {
    const grant = await request(gameUrl, roomPath + '/agent-grants', alice.token, {
      seatId: seat.id,
      expiresAt: Date.now() + 60000,
      maxActions: 4,
    })
    const observation = await request(gameUrl, '/agent/observation', grant.token)
    assert.equal(observation.observation.hand, `seat-secret-${view.seats.findIndex(s => s.id === seat.id)}`)
    assert.equal(JSON.stringify(observation).includes('seat-secret-0'), false)
    assert.equal(observation.sceneError, null)
    assert.equal(observation.scene.root.children[0].text, observation.observation.hand)
    grants.push(grant)
  }
  for (const token of [alice.token, bob.token, ...grants.map(g => g.token)]) {
    const agent = grants.some(g => g.token === token)
    const route = agent ? '/agent/actions' : roomPath + '/actions'
    const input = { expectedVersion: view.version, idempotencyKey: `move-${++serial}`, action: { type: 'move' } }
    view = await request(gameUrl, route, token, input)
    assert.deepEqual(await request(gameUrl, route, token, input), view)
  }
  assert.equal(view.status, 'finished')
  await game.engine.tick()
  view = await request(gameUrl, roomPath, alice.token)
  assert.equal(view.settlement, 'settled')
  for (const [player, balance] of [[alice, 110], [bob, 90]]) {
    assert.deepEqual(await request(economicUrl, '/me', player.wallet), {
      instanceId: 'integration',
      accountId: player.name,
      available: balance,
      reserved: 0,
    })
  }
  const orderBody = { itemId: 'pet.integration-apple', quantity: 1, expectedTotal: 20 }
  const receipt = await request(economicUrl, '/orders', alice.wallet, orderBody, 200, 'spend-game-winnings')
  assert.deepEqual(await request(economicUrl, '/orders', alice.wallet, orderBody, 200, 'spend-game-winnings'), receipt)
  assert.equal((await request(economicUrl, '/me', alice.wallet)).available, 90)
  view = await request(gameUrl, roomPath + '/next-match', alice.token, {})
  assert.notEqual(view.matchId, oldMatch)
  assert.equal(view.handNo, 2)
  assert.equal(view.funding, null)
  assert.equal(view.seats.every(s => !s.ready), true)
  const revoked = await request(gameUrl, '/agent/observation', grants[0].token, undefined, 403)
  assert.equal(revoked.error.code, 'grant_scope_changed')
  assert.equal((await request(economicUrl, `/agreements/${funding.agreementId}`, alice.wallet)).state, 'settled')

  // A renderer that fails only after play starts must not turn a player's
  // inability to act into a loss. Exercise cancellation through the real ledger.
  const failingPackage = structuredClone(packageData)
  failingPackage.manifest = { ...failingPackage.manifest, version: '1.0.1', minPlayers: 2, maxPlayers: 2 }
  failingPackage.ui.render = failingPackage.ui.render.replace(
    'if(typeof process',
    "if(observation.move>0)throw Error('broken renderer');if(typeof process",
  )
  const failingPublished = await request(gameUrl, '/packages', alice.token, failingPackage)
  const failingConsent = { ...consent, packageHash: failingPublished.hash }
  let broken = await request(gameUrl, '/rooms', alice.token, {
    packageHash: failingPublished.hash,
    mode: 'token',
    stake: 10,
    maxPlayers: 2,
    allowAgents: false,
    consent: failingConsent,
  })
  const brokenPath = `/rooms/${broken.id}`
  await request(gameUrl, brokenPath + '/join', bob.token, { consent: failingConsent })
  for (const player of players) {
    await request(gameUrl, brokenPath + '/ready', player.token, { ready: true, consent: failingConsent })
  }
  await request(gameUrl, brokenPath + '/start', alice.token, {})
  await game.engine.tick()
  broken = await request(gameUrl, brokenPath, alice.token)
  const brokenFunding = { agreementId: broken.funding.agreementId, termsHash: broken.funding.termsHash }
  for (const player of players) await request(economicUrl, '/reserve', player.wallet, brokenFunding)
  await game.engine.tick()
  broken = await request(gameUrl, brokenPath, alice.token)
  assert.equal(broken.status, 'playing')
  broken = await request(gameUrl, brokenPath + '/actions', alice.token, {
    expectedVersion: broken.version,
    idempotencyKey: 'trigger-ui-failure',
    action: { type: 'move' },
  })
  assert.equal(broken.status, 'aborted')
  assert.equal(broken.sceneError, 'ui_render_failed')
  assert.equal(broken.scene, null)
  await game.engine.tick()
  await game.engine.tick()
  broken = await request(gameUrl, brokenPath, bob.token)
  assert.equal(broken.settlement, 'refunded')
  assert.equal(broken.sceneError, 'ui_render_failed')
  for (const player of players) {
    const balance = await request(economicUrl, '/me', player.wallet)
    assert.equal(balance.available, 90)
    assert.equal(balance.reserved, 0)
  }
  assert.equal(
    (await request(economicUrl, `/agreements/${brokenFunding.agreementId}`, alice.wallet)).state,
    'cancelled',
  )
  // Exercise the actual author sources, never potentially stale built packages.
  for (const name of ['gomoku', 'holdem']) {
    const { pkg } = await buildGame(name, join(directory, 'published-games'))
    const metadata = await request(gameUrl, '/packages', alice.token, pkg)
    const terms = {
      packageHash: metadata.hash,
      stake: 10,
      policy: pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1',
      reviewState: 'unreviewed',
    }
    let match = await request(gameUrl, '/rooms', alice.token, {
      packageHash: metadata.hash,
      mode: 'token',
      stake: 10,
      policy: terms.policy,
      maxPlayers: 2,
      allowAgents: false,
      consent: terms,
    })
    const matchPath = `/rooms/${match.id}`
    await request(gameUrl, matchPath + '/join', bob.token, { consent: terms })
    for (const player of players) {
      await request(gameUrl, matchPath + '/ready', player.token, { ready: true, consent: terms })
    }
    const before = await Promise.all(players.map(player => request(economicUrl, '/me', player.wallet)))
    await request(gameUrl, matchPath + '/start', alice.token, {})
    await game.engine.tick()
    match = await request(gameUrl, matchPath, alice.token)
    const agreementInput = { agreementId: match.funding.agreementId, termsHash: match.funding.termsHash }
    for (const player of players) await request(economicUrl, '/reserve', player.wallet, agreementInput)
    await game.engine.tick()
    match = await request(gameUrl, matchPath, alice.token)
    let move = 0
    while (match.status === 'playing') {
      assert.ok(move < 100, 'shipped game must terminate within this strategy budget')
      const player = players[match.turn]
      match = await request(gameUrl, matchPath, player.token)
      assert.equal(match.sceneError, null)
      assert.ok(match.scene)
      const action = name === 'gomoku'
        ? { type: 'place', x: Math.floor(move / 2), y: move % 2 }
        : { type: match.observation.legalActions.some(action => action.type === 'call') ? 'call' : 'check' }
      match = await request(gameUrl, matchPath + '/actions', player.token, {
        expectedVersion: match.version,
        idempotencyKey: `${name}-token-${move++}`,
        action,
      })
    }
    assert.equal(match.status, 'finished')
    const payouts = name === 'gomoku' ? [20, 0] : match.result.payouts
    assert.equal(payouts.reduce((sum, amount) => sum + amount, 0), 20)
    await game.engine.tick()
    await game.engine.tick()
    assert.equal((await request(gameUrl, matchPath, alice.token)).settlement, 'settled')
    for (const [index, player] of players.entries()) {
      const balance = await request(economicUrl, '/me', player.wallet)
      assert.equal(balance.available, before[index].available - 10 + payouts[index])
      assert.equal(balance.reserved, 0)
    }
  }
  economy.store.assertConservation('integration')
})
