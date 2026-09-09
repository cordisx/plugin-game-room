import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

process.umask(0o077)
const [baseUrl, statePath, packagePath] = process.argv.slice(2)
if (!baseUrl || !statePath || !packagePath) {
  throw Error('Usage: node deploy/demo-init.mjs http://127.0.0.1:PORT STATE_DIR PACKAGE_DIR')
}
const url = new URL(baseUrl)
assert(
  url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
  'Demo initialization is loopback-only',
)
const directory = resolve(statePath)
mkdirSync(directory, { recursive: true, mode: 0o700 })
const credentialsPath = join(directory, 'credentials.json')
const publicPath = join(directory, 'public-config.json')
function read(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
}
function save(path, value) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  renameSync(path + '.tmp', path)
  chmodSync(path, 0o600)
}
async function request(path, token, body) {
  const response = await fetch(new URL(path, url), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const value = await response.json()
  if (!response.ok) throw Error(`${path}: ${response.status} ${value.error?.code ?? 'request_failed'}`)
  return value
}
const handshake = await request('/v1/handshake')
assert.equal(handshake.protocol, 'game-room/1')
assert.equal(handshake.economyAvailable, false, 'This initializer must not connect demo accounts to an economy')
assert(handshake.uiFormats.includes('scene-v1'))
const credentials = read(credentialsPath, {
  schema: 'game-room-demo-credentials/v1',
  url: url.origin,
  serverId: handshake.serverId,
  accounts: [],
})
assert.equal(credentials.serverId, handshake.serverId, 'Existing credentials belong to another persistent server')
for (const [role, name] of [['preview', 'preview_player'], ['opponent', 'preview_opponent']]) {
  let entry = credentials.accounts.find(account => account.role === role)
  if (!entry) {
    entry = { role, name, password: randomBytes(24).toString('base64url') }
    credentials.accounts.push(entry)
    save(credentialsPath, credentials)
  }
  if (entry.token) {
    try {
      const me = await request('/v1/me', entry.token)
      assert.equal(me.account.id, entry.accountId)
      continue
    } catch { /* Reauthenticate the same demonstration account. */ }
  }
  let session
  try {
    session = await request('/v1/accounts', undefined, { name: entry.name, password: entry.password })
  } catch (error) {
    if (!error.message.includes('account_exists')) throw error
    session = await request('/v1/sessions', undefined, { name: entry.name, password: entry.password })
  }
  entry.accountId = session.account.id
  entry.token = session.token
  save(credentialsPath, credentials)
}
const [preview, opponent] = ['preview', 'opponent'].map(role =>
  credentials.accounts.find(account => account.role === role)
)
const accounts = [preview, opponent]
const config = read(publicPath, {
  schema: 'game-room-demo/v1',
  serverId: handshake.serverId,
  url: url.origin,
  mode: 'score-only',
  economyAvailable: false,
  accounts: [],
  packages: [],
  verification: [],
  joinableRooms: [],
})
assert.equal(config.serverId, handshake.serverId)
config.accounts = accounts.map(({ role, name, accountId }) => ({ role, name, accountId }))
config.sources = accounts.map(account => ({
  role: account.role,
  source: {
    id: handshake.serverId,
    name: '本地真实演示 · 双测试账号',
    url: url.origin,
    accountId: account.accountId,
    enabled: true,
  },
}))
for (const file of ['gomoku-1.0.0.json', 'texas-holdem-1.0.0.json']) {
  const pkg = JSON.parse(readFileSync(join(resolve(packagePath), file), 'utf8'))
  assert.equal(pkg.ui.format, 'scene-v1')
  const metadata = await request('/v1/packages', preview.token, pkg)
  const policy = pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1'
  const gameId = pkg.manifest.id
  config.packages = [...config.packages.filter(item => item.manifest.id !== gameId), metadata]
  const verified = config.verification.find(item => item.packageHash === metadata.hash)
  if (!verified) {
    let room = await request('/v1/rooms', preview.token, {
      packageHash: metadata.hash,
      mode: 'score',
      maxPlayers: 2,
      policy,
      turnTimeoutMs: 600000,
      config: {
        roomName: `已验证完整对局 · ${pkg.manifest.name}`,
        demo: true,
        verificationOnly: true,
        opponentDescription: '两个测试账号顺序提交 HTTP 动作；非模型对手',
      },
    })
    const path = `/v1/rooms/${room.id}`
    await request(path + '/join', opponent.token, {})
    for (const account of accounts) await request(path + '/ready', account.token, { ready: true })
    room = await request(path + '/start', preview.token, {})
    assert.equal(room.status, 'playing')
    let actions = 0
    while (room.status === 'playing') {
      assert(actions < 100, 'Verification exceeded bounded action count')
      const actor = accounts[room.turn]
      room = await request(path, actor.token)
      assert(room.scene && room.sceneError === null, 'Expected a validated real scene')
      if (gameId === 'texas-holdem') assert.deepEqual(room.observation.players[1 - room.turn].hole, [null, null])
      const action = gameId === 'gomoku'
        ? { type: 'place', x: Math.floor(actions / 2), y: actions % 2 }
        : { type: room.observation.legalActions.some(item => item.type === 'call') ? 'call' : 'check' }
      const command = { expectedVersion: room.version, idempotencyKey: `${room.matchId}:demo:${actions}`, action }
      room = await request(path + '/actions', actor.token, command)
      assert.deepEqual(await request(path + '/actions', actor.token, command), room)
      actions++
    }
    assert.equal(room.status, 'finished')
    assert.equal(room.settlement, 'none')
    config.verification.push({
      gameId,
      packageHash: metadata.hash,
      roomId: room.id,
      matchId: room.matchId,
      actions,
      status: room.status,
      result: room.result,
      verifiedAt: new Date().toISOString(),
    })
    save(publicPath, config)
  }
  // Do not reset or replace a room once a reviewer has joined it.
  if (!config.joinableRooms.some(item => item.packageHash === metadata.hash)) {
    const room = await request('/v1/rooms', opponent.token, {
      packageHash: metadata.hash,
      mode: 'score',
      maxPlayers: 2,
      policy,
      turnTimeoutMs: 600000,
      config: {
        roomName: `${pkg.manifest.name} · 真实双账号可加入`,
        demo: true,
        opponentDescription: 'preview_opponent 为第二个手动测试账号，需另一窗口开局及落子；非AI',
      },
    })
    await request(`/v1/rooms/${room.id}/ready`, opponent.token, { ready: true })
    config.joinableRooms.push({
      gameId,
      packageHash: metadata.hash,
      roomId: room.id,
      creatorAccountId: opponent.accountId,
      joinAsAccountId: preview.accountId,
      requiresOpponentWindow: true,
    })
  }
  save(publicPath, config)
}
console.log(JSON.stringify(
  {
    url: url.origin,
    serverId: handshake.serverId,
    credentialsFile: credentialsPath,
    publicConfigFile: publicPath,
    accounts: config.accounts,
    joinableRooms: config.joinableRooms,
    verified: config.verification.map(({ gameId, actions, status }) => ({ gameId, actions, status })),
  },
  null,
  2,
))
