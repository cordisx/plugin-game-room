import assert from 'node:assert/strict'
import test from 'node:test'
import { accessPolicy, configuredAccessPolicy } from '../../server/access-policy.js'
import { createGameServer } from '../../server/http.js'
await test('local launch requires login while explicit deployment guest policy remains supported', () => {
  assert.equal(configuredAccessPolicy({}), 'login-required')
  assert.equal(configuredAccessPolicy({ AUTH_POLICY: 'guest-allowed' }), 'guest-allowed')
  assert.equal(configuredAccessPolicy({ REQUIRE_LOGIN: 'false' }), 'guest-allowed')
  assert.equal(accessPolicy({ requireLogin: true }), 'login-required')
  assert.throws(() => configuredAccessPolicy({ AUTH_POLICY: 'typo' }))
  assert.throws(() => configuredAccessPolicy({ REQUIRE_LOGIN: 'yes' }))
  assert.throws(() => configuredAccessPolicy({ AUTH_POLICY: 'guest-allowed', REQUIRE_LOGIN: 'true' }))
})
for (const policy of ['guest-allowed', 'login-required'] as const) {
  await test(`handshake and guest issuance obey exact ${policy} policy`, async (t) => {
    const app = createGameServer({ accessPolicy: policy, tickMs: 0 })
    t.after(async () => await app.close())
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
    const address = app.server.address()
    assert(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const handshake = await (await fetch(origin + '/v1/handshake')).json()
    assert.deepEqual(handshake.access, { guests: policy === 'guest-allowed', policy })
    const response = await fetch(origin + '/v1/guests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(response.status, policy === 'guest-allowed' ? 200 : 403)
    const body = await response.json()
    if (policy === 'guest-allowed') {
      assert.equal(body.account.guest, true)
    } else {
      assert.equal(body.error.code, 'login_required')
      const existing = await app.accounts.guest()
      const headers = { authorization: `Bearer ${existing.token}` }
      assert.equal((await fetch(origin + '/v1/me', { headers })).status, 403)
      assert.equal((await fetch(origin + '/v1/rooms/missing/spectate', { headers })).status, 403)
      assert.equal((await fetch(origin + '/v1/session', { method: 'DELETE', headers })).status, 200)
      assert.equal((await fetch(origin + '/v1/me', { headers })).status, 401)
    }
  })
}
