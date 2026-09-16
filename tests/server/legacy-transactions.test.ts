import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers.js'

test('legacy Token pending journal is read-only; timer and mutations cannot call old wallet service', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const room = await h.room()
  const historical = await h.app.engine.load(room.id)
  Object.assign(historical, {
    mode: 'token',
    status: 'funding',
    settlement: 'pending',
    economyOp: 'cancel',
    fundingDeadline: 1,
    economyIdentity: { instanceId: 'original-wallet', gameServiceId: 'original-service', url: 'http://127.0.0.1:1' },
    funding: { economyUrl: 'http://127.0.0.1:1', agreementId: 'original-agreement', termsHash: 'original-hash' },
    economyTerms: { matchId: historical.matchId, opaqueHistoricalTerms: 'retain-exactly' },
  })
  const body = JSON.stringify(historical)
  await h.app.store.db.prepare('UPDATE rooms SET body=? WHERE id=?').run(body, room.id)
  await h.app.engine.serial(() => h.app.engine.tick())
  await h.app.engine.serial(() => h.app.engine.catchUp(room.id))
  const recovery = await h.request(`/v1/rooms/${room.id}/legacy-recovery`, h.alice.token)
  assert.equal(recovery.status, 200)
  assert.equal(recovery.body.operation, 'cancel')
  assert.equal(recovery.body.funding.termsHash, 'original-hash')
  assert.deepEqual(recovery.body.terms, historical.economyTerms)
  assert.equal(recovery.body.automaticRelease, false)
  for (const op of ['start', 'next-match', 'join', 'ready', 'leave', 'bots', 'agent-seats']) {
    assert.equal((await h.request(`/v1/rooms/${room.id}/${op}`, h.alice.token, { ready: true })).status, 410, op)
  }
  assert.equal((await h.request(`/v1/rooms/${room.id}/legacy-recovery`, h.stranger.token)).status, 403)
  assert.equal((await h.request('/v1/economy/link', h.alice.token, { code: 'old-proof' })).status, 410)
  assert.equal((await h.app.store.db.prepare('SELECT body FROM rooms WHERE id=?').get(room.id))?.body, body)
})
