import test from 'node:test'
import assert from 'node:assert/strict'
import { game, harness, rules } from './helpers.js'
test('one owner controls several Agents without observations, commands or budgets crossing seats', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const pkg = game(
    rules.replace('s.n>=2?', 's.n>=3?').replace(':{state:s,turn:1}', ':{state:s,turn:(ctx.seatIndex+1)%3}').replace(
      'scores:[0,1]',
      'scores:[0,1,2]',
    ),
  )
  pkg.manifest.maxPlayers = 3
  const meta = (await h.request('/v1/packages', h.alice.token, pkg)).body
  const room =
    (await h.request('/v1/rooms', h.alice.token, { packageHash: meta.hash, mode: 'score', allowAgents: true })).body
  const path = `/v1/rooms/${room.id}`
  const seats = []
  for (const participantId of ['agent-one', 'agent-two']) {
    const response = await h.request(path + '/agent-seats', h.alice.token, { participantId, name: participantId })
    assert.equal(response.status, 200)
    seats.push(response.body.seat)
    assert.equal(
      (await h.request(path + '/agent-seats', h.alice.token, { participantId, name: participantId })).body.seat.id,
      response.body.seat.id,
    )
  }
  for (const seat of [room.seats[0], ...seats]) {
    await h.request(path + '/ready', h.alice.token, { ready: true, seatId: seat.id })
  }
  const grants = []
  for (const seat of seats) {
    grants.push(
      (await h.request(path + '/agent-grants', h.alice.token, {
        seatId: seat.id,
        expiresAt: Date.now() + 60000,
        maxActions: 1,
      })).body,
    )
  }
  const started = (await h.request(path + '/start', h.alice.token, {})).body
  assert.equal((await h.request('/v1/agent/observation', grants[0].token)).body.observation.hand, 'private-1')
  assert.equal((await h.request('/v1/agent/observation', grants[1].token)).body.observation.hand, 'private-2')
  const ownReplay = await h.request(path + '/replay', h.alice.token)
  assert(!JSON.stringify(ownReplay.body).includes('private-1'))
  let view = (await h.request(path + '/actions', h.alice.token, {
    expectedVersion: started.version,
    idempotencyKey: 'same-key',
    action: { type: 'move' },
  })).body
  for (const grant of grants) {
    const response = await h.request('/v1/agent/actions', grant.token, {
      expectedVersion: view.version,
      idempotencyKey: 'same-key',
      action: { type: 'move' },
    })
    assert.equal(response.status, 200)
    view = response.body
    assert.equal(view.selfSeatId, grant.seatId)
  }
  assert.equal(view.status, 'finished')
  await h.request(path + '/next-match', h.alice.token, {})
  assert.equal((await h.request('/v1/agent/observation', grants[0].token)).body.error.code, 'grant_scope_changed')
})
test('exhausted Agent budget rolls back action, replay and room version together', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const room = await h.room(
    game(rules.replace('s.n>=2?', 's.n>=4?').replace(':{state:s,turn:1}', ':{state:s,turn:1-ctx.seatIndex}')),
  )
  const path = `/v1/rooms/${room.id}`
  const grant = (await h.request(path + '/agent-grants', h.alice.token, {
    seatId: room.selfSeatId,
    expiresAt: Date.now() + 60000,
    maxActions: 1,
  })).body
  const a = (await h.request('/v1/agent/actions', grant.token, {
    expectedVersion: room.version,
    idempotencyKey: 'one',
    action: { type: 'move' },
  })).body
  const b = (await h.request(path + '/actions', h.bob.token, {
    expectedVersion: a.version,
    idempotencyKey: 'two',
    action: { type: 'move' },
  })).body
  const exhausted = await h.request('/v1/agent/actions', grant.token, {
    expectedVersion: b.version,
    idempotencyKey: 'three',
    action: { type: 'move' },
  })
  assert.equal(exhausted.body.error.code, 'grant_budget_exhausted')
  const current = (await h.request(path, h.alice.token)).body
  assert.equal(current.version, b.version)
  assert.equal(current.observation.n, 2)
})
