import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agreement, EconomyAdapter, FundingTerms } from '../../server/economy.js'
import { canonical } from '../../server/errors.js'
import { createGameServer } from '../../server/http.js'
import { game, harness, rules } from './helpers.js'

class EconomyDouble implements EconomyAdapter {
  url = 'http://127.0.0.1:1/'
  serviceId = 'game-service'
  terms: FundingTerms | undefined
  agreement: Agreement | undefined
  settleCalls: string[] = []
  cancelCalls: string[] = []
  actualSettlements = 0
  actualRefunds = 0
  loseSettle = false
  loseCancel = false
  failGet = false
  async redeem(code: string, gameAccountId: string) {
    return { instanceId: 'economy-instance', accountId: code, gameServiceId: this.serviceId, gameAccountId }
  }
  async create(terms: FundingTerms) {
    if (!this.agreement || this.terms?.matchId !== terms.matchId) {
      this.terms = structuredClone(terms)
      this.agreement = {
        id: 'agreement-' + terms.matchId,
        instanceId: 'economy-instance',
        serviceId: this.serviceId,
        termsHash: 'fixed-terms-hash',
        state: 'open',
        reservations: [],
      }
    }
    return structuredClone(this.agreement)
  }
  async get() {
    if (this.failGet) throw Error('offline')
    return structuredClone(this.agreement!)
  }
  async settle(_id: string, _termsHash: string, amounts: { accountId: string; amount: number }[], key: string) {
    this.settleCalls.push(key)
    if (this.agreement!.state === 'open') {
      this.actualSettlements++
      this.agreement!.state = 'settled'
      this.agreement!.outcomeId = canonical(amounts)
    }
    if (this.loseSettle) {
      this.loseSettle = false
      throw Error('lost applied response')
    }
    assert.equal(amounts.reduce((a, b) => a + b.amount, 0), this.terms!.participants.reduce((a, b) => a + b.amount, 0))
    return structuredClone(this.agreement!)
  }
  async cancel(_id: string, key: string) {
    this.cancelCalls.push(key)
    if (this.agreement!.state === 'open') {
      this.actualRefunds++
      this.agreement!.state = 'cancelled'
    }
    if (this.loseCancel) {
      this.loseCancel = false
      throw Error('lost applied response')
    }
    return structuredClone(this.agreement!)
  }
  reserveAll() {
    this.agreement!.reservations = this.terms!.participants.map(p => p.accountId)
  }
}
async function tokenRoom(
  h: Awaited<ReturnType<typeof harness>>,
  source = rules,
  policy = 'equal-winners-v1',
  render?: string,
) {
  await h.request('/v1/economy/link', h.alice.token, { code: 'eco-alice' })
  await h.request('/v1/economy/link', h.bob.token, { code: 'eco-bob' })
  const pkg = game(source)
  if (render) pkg.ui.render = render
  const published = await h.request('/v1/packages', h.alice.token, pkg)
  assert.equal(published.status, 200, JSON.stringify(published.body))
  const meta = published.body
  const consent = { packageHash: meta.hash, stake: 10, policy, reviewState: 'unreviewed' }
  const created = await h.request('/v1/rooms', h.alice.token, {
    packageHash: meta.hash,
    mode: 'token',
    stake: 10,
    policy,
    consent,
    turnTimeoutMs: 1000,
    allowAgents: true,
  })
  assert.equal(created.status, 200)
  const path = `/v1/rooms/${created.body.id}`
  assert.equal((await h.request(path + '/join', h.bob.token, {})).body.error.code, 'consent_required')
  await h.request(path + '/join', h.bob.token, { consent })
  await h.request(path + '/ready', h.alice.token, { ready: true, consent })
  await h.request(path + '/ready', h.bob.token, { ready: true, consent })
  const room = (await h.request(path + '/start', h.alice.token, {})).body
  assert.equal(room.status, 'funding')
  return { path, room, consent }
}
test('partial funding expires; refund lost response reconciles once without phantom settlement', async t => {
  const economy = new EconomyDouble()
  let now = 1000000
  const h = await harness({ economy, now: () => now })
  t.after(() => h.app.close())
  const { path, room } = await tokenRoom(h)
  economy.agreement!.reservations = ['eco-alice']
  economy.loseCancel = true
  now += 600001
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal(h.app.engine.load(room.id).status, 'aborted')
  assert.equal(h.app.engine.load(room.id).settlement, 'pending')
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal(h.app.engine.load(room.id).settlement, 'refunded')
  assert.equal(economy.actualRefunds, 1)
  assert.equal(economy.actualSettlements, 0)
  const next = (await h.request(path + '/next-match', h.alice.token, {})).body
  assert.equal(next.status, 'waiting')
  assert.notEqual(next.matchId, room.matchId)
})
test('minting/negative/outsized payouts abort and refund reserved funds', async t => {
  for (const payout of ['[21,0]', '[-1,21]', '[0,9007199254740992]']) {
    const economy = new EconomyDouble()
    const h = await harness({ economy })
    t.after(() => h.app.close())
    const source = rules.replace('s.n>=2?', 's.n>=1?').replace('scores:[0,1]', `payouts:${payout}`)
    const { room } = await tokenRoom(h, source, 'conserved-payouts-v1')
    economy.reserveAll()
    await h.app.engine.serial(() => h.app.engine.tick())
    const playing = h.app.engine.load(room.id)
    await h.app.engine.serial(() =>
      h.app.engine.action(h.alice.account.id, room.id, {
        expectedVersion: playing.version,
        idempotencyKey: 'malicious',
        action: { type: 'move' },
      })
    )
    assert.equal(h.app.engine.load(room.id).status, 'aborted')
    await h.app.engine.serial(() => h.app.engine.tick())
    assert.equal(h.app.engine.load(room.id).settlement, 'refunded')
    assert.equal(economy.actualSettlements, 0)
    assert.equal(economy.actualRefunds, 1)
  }
})
test('settlement applied but response lost survives restart with same operation identity', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'game-economy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const economy = new EconomyDouble()
  const database = join(dir, 'game.sqlite')
  const h = await harness({ economy, database })
  t.after(() => h.app.server.listening ? h.app.close() : undefined)
  const { room } = await tokenRoom(h)
  economy.reserveAll()
  await h.app.engine.serial(() => h.app.engine.tick())
  let playing = h.app.engine.load(room.id)
  await h.app.engine.serial(() =>
    h.app.engine.action(h.alice.account.id, room.id, {
      expectedVersion: playing.version,
      idempotencyKey: 'first',
      action: { type: 'move' },
    })
  )
  playing = h.app.engine.load(room.id)
  await h.app.engine.serial(() =>
    h.app.engine.action(h.bob.account.id, room.id, {
      expectedVersion: playing.version,
      idempotencyKey: 'second',
      action: { type: 'move' },
    })
  )
  economy.loseSettle = true
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal(h.app.engine.load(room.id).settlement, 'pending')
  await h.app.close()
  const restarted = createGameServer({ database, economy, tickMs: 0 })
  t.after(() => restarted.close())
  await restarted.engine.serial(() => restarted.engine.tick())
  assert.equal(restarted.engine.load(room.id).settlement, 'settled')
  assert.equal(economy.actualSettlements, 1)
  assert.equal(new Set(economy.settleCalls).size, 1)
  assert.equal(economy.actualRefunds, 0)
})
test('external escrow expiry ends play and terminal result never retries settlement forever', async t => {
  const economy = new EconomyDouble()
  const h = await harness({ economy })
  t.after(() => h.app.close())
  const { room } = await tokenRoom(h)
  economy.reserveAll()
  await h.app.engine.serial(() => h.app.engine.tick())
  economy.agreement!.state = 'expired'
  await h.app.engine.serial(() => h.app.engine.tick())
  const ended = h.app.engine.load(room.id)
  assert.equal(ended.status, 'aborted')
  assert.equal(ended.settlement, 'refunded')
  assert.equal(economy.settleCalls.length, 0)
  assert.equal(economy.cancelCalls.length, 0)
})
test('economic account link refuses raw user bearer and verifies proof audience', async t => {
  const economy = new EconomyDouble()
  const h = await harness({ economy })
  t.after(() => h.app.close())
  assert.equal(
    (await h.request('/v1/economy/link', h.alice.token, { token: 'never-send-this' })).body.error.code,
    'link_proof_required',
  )
  economy.redeem = async () => ({
    instanceId: 'i',
    accountId: 'alice',
    gameServiceId: 'other-service',
    gameAccountId: h.alice.account.id,
  })
  assert.equal(
    (await h.request('/v1/economy/link', h.alice.token, { code: 'audience-wrong' })).body.error.code,
    'economy_identity_mismatch',
  )
})
test('malicious rule timeout aborts and refunds escrow', async t => {
  let now = 1000000
  const economy = new EconomyDouble()
  const h = await harness({ economy, now: () => now })
  t.after(() => h.app.close())
  const source = rules.replace('return {state:s,turn:null,done:{winners:[1-ctx.seatIndex]}}', 'while(true){}')
  const { room } = await tokenRoom(h, source)
  economy.reserveAll()
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.notEqual(h.app.engine.view(h.app.engine.load(room.id), h.alice.account.id).scene, null)
  now += 1001
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal(h.app.engine.load(room.id).status, 'aborted')
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal(h.app.engine.load(room.id).settlement, 'refunded')
  assert.equal(economy.actualSettlements, 0)
})
test('foreign agreement terms cannot start a funded match', async t => {
  const economy = new EconomyDouble()
  const h = await harness({ economy })
  t.after(() => h.app.close())
  const { room } = await tokenRoom(h)
  economy.reserveAll()
  economy.agreement!.termsHash = 'changed-terms'
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal(h.app.engine.load(room.id).status, 'funding')
  assert.equal(economy.actualSettlements, 0)
})
test('persistent economic instance pin rejects reused account IDs on another instance or service', async t => {
  const economy = new EconomyDouble()
  const dir = mkdtempSync(join(tmpdir(), 'game-instance-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const database = join(dir, 'state.sqlite')
  const h = await harness({ economy, database })
  t.after(() => h.app.server.listening ? h.app.close() : undefined)
  assert.equal((await h.request('/v1/economy/link', h.alice.token, { code: 'same-account' })).status, 200)
  const account = h.app.accounts.authenticate(h.alice.token)
  await h.app.close()
  const replacement = new EconomyDouble()
  replacement.redeem = async (_code, gameAccountId) => ({
    instanceId: 'different-instance',
    accountId: 'same-account',
    gameServiceId: replacement.serviceId,
    gameAccountId,
  })
  const app = createGameServer({ database, economy: replacement, tickMs: 0 })
  t.after(() => app.close())
  await assert.rejects(
    app.engine.serial(() => app.engine.linkEconomy(account, 'new-proof')),
    /economy_instance_changed/,
  )
  replacement.serviceId = 'different-service'
  await assert.rejects(
    app.engine.serial(() => app.engine.linkEconomy(account, 'new-proof-2')),
    /economy_instance_changed/,
  )
  assert.equal(app.engine.economyIdentity()?.instanceId, 'economy-instance')
})
test('a settled ACK with different payouts is never reported as successful', async t => {
  const economy = new EconomyDouble()
  const h = await harness({ economy })
  t.after(() => h.app.close())
  const { room } = await tokenRoom(h)
  economy.reserveAll()
  await h.app.engine.serial(() => h.app.engine.tick())
  let state = h.app.engine.load(room.id)
  await h.app.engine.serial(() =>
    h.app.engine.action(h.alice.account.id, room.id, {
      expectedVersion: state.version,
      idempotencyKey: 'one',
      action: { type: 'move' },
    })
  )
  state = h.app.engine.load(room.id)
  await h.app.engine.serial(() =>
    h.app.engine.action(h.bob.account.id, room.id, {
      expectedVersion: state.version,
      idempotencyKey: 'two',
      action: { type: 'move' },
    })
  )
  const settle = economy.settle.bind(economy)
  economy.settle = async (...args) => ({ ...await settle(...args), outcomeId: 'forged-payout' })
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal(h.app.engine.load(room.id).settlement, 'pending')
  await assert.rejects(
    h.app.engine.serial(() => h.app.engine.nextMatch(h.app.accounts.authenticate(h.alice.token), room.id)),
    /settlement_pending/,
  )
})
for (
  const failure of [
    {
      name: 'mid-match guest exception',
      at: 1,
      code: 'throw Error("renderer failure")',
      reason: 'ui_render_failed',
      agent: false,
    },
    {
      name: 'mid-match guest timeout through Agent action',
      at: 1,
      code: 'while(true){}',
      reason: 'ui_render_failed',
      agent: true,
    },
    {
      name: 'mid-match invalid scene',
      at: 1,
      code: 'return {version:1,root:{type:"iframe"}}',
      reason: 'ui_scene_invalid',
      agent: false,
    },
    {
      name: 'invalid final scene before settlement',
      at: 2,
      code: 'return {version:1,root:{type:"iframe"}}',
      reason: 'ui_scene_invalid',
      agent: false,
    },
  ]
) {
  test(`${failure.name} aborts, refunds once, blocks actions/timeouts and allows next match`, async t => {
    let now = 1000000
    const economy = new EconomyDouble()
    const h = await harness({ economy, now: () => now })
    t.after(() => h.app.close())
    const render =
      `globalThis.render=(observation)=>{if(observation.n>=${failure.at}){${failure.code}} return {version:1,root:{type:'text',text:observation.hand}}}`
    const { room, path, consent } = await tokenRoom(h, rules, 'equal-winners-v1', render)
    economy.reserveAll()
    await h.app.engine.serial(() => h.app.engine.tick())
    let current = h.app.engine.load(room.id)
    const originalMatchId = current.matchId
    let actor = h.alice
    let endpoint = path + '/actions'
    let credential = actor.token
    if (failure.at === 2) {
      const first = await h.request(endpoint, credential, {
        expectedVersion: current.version,
        idempotencyKey: 'first-good',
        action: { type: 'move' },
      })
      assert.equal(first.body.status, 'playing')
      actor = h.bob
      credential = actor.token
      current = h.app.engine.load(room.id)
    }
    if (failure.agent) {
      const seat = current.seats.find(s => s.accountId === actor.account.id)!
      const grant = await h.request(path + '/agent-grants', actor.token, {
        seatId: seat.id,
        expiresAt: now + 60000,
        maxActions: 2,
      })
      assert.equal(grant.status, 200)
      credential = grant.body.token
      endpoint = '/v1/agent/actions'
    }
    const input = { expectedVersion: current.version, idempotencyKey: 'ui-fault', action: { type: 'move' } }
    const failed = await h.request(endpoint, credential, input)
    assert.equal(failed.status, 200)
    assert.equal(failed.body.status, 'aborted')
    assert.equal(failed.body.sceneError, failure.reason)
    assert.equal(failed.body.scene, null)
    assert.equal(failed.body.deadline, null)
    assert.equal(failed.body.result, null)
    assert.equal(failed.body.settlement, 'pending')
    assert.equal(h.app.engine.load(room.id).economyOp, 'cancel')
    for (const seat of current.seats) {
      const view = h.app.engine.view(h.app.engine.load(room.id), seat.accountId, seat.id)
      assert.equal(view.scene, null)
      assert.equal(view.sceneError, failure.reason)
    }
    assert.equal((await h.request(path + '/next-match', h.alice.token, {})).body.error.code, 'settlement_pending')
    economy.loseCancel = true
    now += 2000
    await h.app.engine.serial(() => h.app.engine.tick())
    assert.equal(h.app.engine.load(room.id).settlement, 'pending')
    await h.app.engine.serial(() => h.app.engine.tick())
    await h.app.engine.serial(() => h.app.engine.tick())
    assert.equal(h.app.engine.load(room.id).settlement, 'refunded')
    assert.equal(economy.actualRefunds, 1)
    assert.equal(economy.settleCalls.length, 0)
    assert.equal(h.app.engine.view(h.app.engine.load(room.id), actor.account.id).sceneError, failure.reason)
    assert.equal(
      (await h.request(endpoint, credential, { ...input, idempotencyKey: 'stale-after-refund' })).body.error.code,
      'not_playing',
    )
    assert.deepEqual((await h.request(endpoint, credential, input)).body, failed.body)
    const replay = (await h.request(path + '/replay', h.alice.token)).body
    assert.equal(replay.events.at(-1).view.sceneError, failure.reason)
    const next = (await h.request(path + '/next-match', h.alice.token, {})).body
    assert.equal(next.status, 'waiting')
    assert.equal(next.sceneError, null)
    assert.notEqual(next.matchId, originalMatchId)
    for (const user of [h.alice, h.bob]) {
      assert.equal((await h.request(path + '/ready', user.token, { ready: true, consent })).status, 200)
    }
    assert.equal((await h.request(path + '/start', h.alice.token, {})).body.status, 'funding')
    economy.reserveAll()
    await h.app.engine.serial(() => h.app.engine.tick())
    assert.equal(h.app.engine.load(room.id).status, 'playing')
    assert.equal(h.app.engine.view(h.app.engine.load(room.id), h.alice.account.id).sceneError, null)
  })
}
test('failed authoritative observation also aborts and refunds instead of leaving an unplayable seat', async t => {
  const economy = new EconomyDouble()
  const h = await harness({ economy })
  t.after(() => h.app.close())
  const source = rules.replace(
    "return {hand:s.hands[i],n:s.n,legalActions:[{type:'move'}]}",
    "throw Error('observation-failed')",
  )
  const { room } = await tokenRoom(h, source)
  economy.reserveAll()
  await h.app.engine.serial(() => h.app.engine.tick())
  const aborted = h.app.engine.view(h.app.engine.load(room.id), h.alice.account.id)
  assert.equal(aborted.status, 'aborted')
  assert.equal(aborted.observation, null)
  assert.equal(aborted.sceneError, 'observation_failed')
  await h.app.engine.serial(() => h.app.engine.tick())
  assert.equal(h.app.engine.load(room.id).settlement, 'refunded')
  assert.equal(economy.actualRefunds, 1)
  assert.equal(economy.actualSettlements, 0)
})
