import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'

process.umask(0o077)
const [mode, statePath, economyRepository, rawPort, optIn] = process.argv.slice(2)
assert(['initialize', 'serve', 'verify'].includes(mode))
assert.equal(optIn, '--local-test-only', 'Explicit local test provisioning opt-in required')
const directory = resolve(statePath)
const port = Number(rawPort)
assert(Number.isSafeInteger(port) && port >= 1024 && port <= 65535)
mkdirSync(directory, { recursive: true, mode: 0o700 })
chmodSync(directory, 0o700)
const privatePath = join(directory, 'operator-private.json')
const database = join(directory, 'economy.sqlite')
const { Economy, createEconomyServer } = await import(
  pathToFileURL(resolve(economyRepository, 'dist/server/index.js')).href
)
const url = `http://127.0.0.1:${port}`
const economy = new Economy(database)
let state
if (existsSync(privatePath)) {
  state = JSON.parse(readFileSync(privatePath, 'utf8'))
  assert.equal(state.url, url, 'Retain the same economic origin')
  assert.equal(state.testOnly, true)
} else {
  assert.equal(mode, 'initialize', 'Initialize this dedicated test directory first')
  assert.equal(economy.store.one('SELECT id FROM instances LIMIT 1'), undefined, 'Never adopt an unrelated database')
  const instanceId = 'local-game-room-test'
  const walletAccountId = 'local-review-wallet'
  const gameServiceId = 'local-review-game'
  economy.auth.createInstance(instanceId, 10000)
  economy.auth.createAccount(instanceId, walletAccountId)
  const gameServiceToken = economy.auth.createService(instanceId, gameServiceId, '*', 1000).token
  const rewardServiceToken = economy.auth.createService(instanceId, 'local-review-sponsor', 'welcome', 1000).token
  economy.commerce.createSource(
    instanceId,
    'local-test-initial-credit',
    'local-review-sponsor',
    'reward',
    1000,
    1000,
    1000,
  )
  state = { testOnly: true, url, instanceId, walletAccountId, gameServiceId, gameServiceToken, rewardServiceToken }
  writeFileSync(privatePath, JSON.stringify(state), { mode: 0o600 })
}
const server = createEconomyServer(economy)
try {
  if (mode !== 'verify') {
    server.listen(port, '127.0.0.1')
    await once(server, 'listening')
  }
  async function request(path, token, body, key) {
    const response = await fetch(url + '/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    })
    assert.equal(response.status, 200, `${path} returned ${response.status}; no credentials logged`)
    return response.json()
  }
  if (mode === 'initialize') {
    // Same source/event/key makes reruns return the original finite grant, never another credit.
    await request('/rewards/grant', state.rewardServiceToken, {
      sourceId: 'local-test-initial-credit',
      accountId: state.walletAccountId,
      eventId: 'initial-1000',
      amount: 1000,
      expectedInstanceId: state.instanceId,
    }, 'local-test-initial-1000')
    const code = economy.auth.enrollment(state.instanceId, state.walletAccountId)
    const session = await request('/session', undefined, { code })
    state.walletSessionToken = session.token
    writeFileSync(privatePath, JSON.stringify(state), { mode: 0o600 })
  }
  if (mode !== 'serve') {
    assert(state.walletSessionToken, 'Initialize a wallet session through the operator enrollment flow')
    const me = await request('/me', state.walletSessionToken)
    const ledger = await request('/ledger', state.walletSessionToken)
    assert.equal(me.instanceId, state.instanceId)
    assert.equal(me.accountId, state.walletAccountId)
    const initial = ledger.filter(row => row.reference === 'local-test-initial-credit:initial-1000')
    assert.equal(initial.length, 1, 'Exactly one initial credit')
    assert.equal(initial[0].availableDelta, 1000)
    assert.equal(initial[0].reservedDelta, 0)
    const publicConfig = {
      testOnly: true,
      label: '本地测试资产',
      url,
      instanceId: state.instanceId,
      walletAccountId: state.walletAccountId,
      gameServiceId: state.gameServiceId,
      available: me.available,
      reserved: me.reserved,
      ledger,
    }
    writeFileSync(join(directory, 'public-verification.json'), JSON.stringify(publicConfig, null, 2), { mode: 0o600 })
    console.log(
      JSON.stringify({
        testOnly: true,
        url,
        instanceId: me.instanceId,
        available: me.available,
        reserved: me.reserved,
        initialCreditCount: initial.length,
      }),
    )
  } else {
    console.log(JSON.stringify({ testOnly: true, url, instanceId: state.instanceId, pid: process.pid }))
    await new Promise(resolveStop => {
      for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, resolveStop)
    })
  }
} finally {
  if (server.listening) await new Promise(resolveClose => server.close(resolveClose))
  economy.close()
}
