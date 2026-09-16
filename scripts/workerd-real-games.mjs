import { applyWorkersMigrations } from './apply-workers-migrations.mjs'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from '../games/tools/package.mjs'

import { Miniflare } from 'miniflare'
const mf = new Miniflare({
  modules: true,
  scriptPath: 'dist/server/index.js',
  modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
  compatibilityDate: '2026-07-30',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  bindings: { AUTH_POLICY: 'login-required' },
})
const db = await mf.getD1Database('DB')
await applyWorkersMigrations(db)
const origin = new URL('http://localhost')
const temporary = await mkdtemp(join(tmpdir(), 'workers-games-'))
const packagePaths = process.argv.length > 2
  ? process.argv.slice(2)
  : [(await build('gomoku', temporary)).path, (await build('holdem', temporary)).path]
assert.equal(packagePaths.length, 2)
try {
  async function request(path, token, body, method = body === undefined ? 'GET' : 'POST') {
    const url = new URL(path, origin)
    assert.equal(url.origin, origin.origin)
    const response = await mf.dispatchFetch(url, {
      method,
      redirect: 'error',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    assert(response.headers.get('content-type')?.includes('application/json'), `${path}: non-JSON ${response.status}`)
    const value = await response.json()
    assert.equal(response.status, 200, `${path}: ${response.status} ${value.error?.code ?? 'request_failed'}`)
    return value
  }

  assert.equal((await request('/health')).ok, true)
  const handshake = await request('/v1/handshake')
  assert.equal(handshake.protocol, 'game-room/1')
  assert.equal(handshake.economyAvailable, false)
  const runId = randomBytes(6).toString('hex')
  const accounts = []
  for (let index = 0; index < 2; index++) {
    const credentials = { name: `verify_${runId}_${index}`, password: randomBytes(24).toString('base64url') }
    const registered = await request('/v1/accounts', undefined, credentials)
    const session = await request('/v1/sessions', undefined, credentials)
    assert.equal(session.account.id, registered.account.id)
    assert.equal((await request('/v1/me', session.token)).account.id, registered.account.id)
    accounts.push(session)
  }

  const report = { origin: origin.origin, serverId: handshake.serverId, games: [] }
  try {
    for (const packagePath of packagePaths) {
      const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
      assert(['gomoku', 'texas-holdem'].includes(pkg.manifest.id))
      const metadata = await request('/v1/packages', accounts[0].token, pkg)
      let room = await request('/v1/rooms', accounts[0].token, {
        packageHash: metadata.hash,
        mode: 'score',
        maxPlayers: 2,
        policy: pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1',
        turnTimeoutMs: 600000,
        config: pkg.manifest.id === 'gomoku' ? { boardSize: 15, rounds: 2 } : { rounds: 2 },
      })
      const path = `/v1/rooms/${encodeURIComponent(room.id)}`
      await request(`${path}/join`, accounts[1].token, {})
      for (const account of accounts) await request(`${path}/ready`, account.token, { ready: true })
      room = await request(`${path}/start`, accounts[0].token, {})
      assert.equal(room.status, 'playing')
      let count = 0
      let roundMoves = 0
      let advances = 0
      while (room.status === 'playing') {
        assert(count < 120, 'Game exceeded bounded verification actions')
        const actor = accounts[room.turn]
        assert(actor, 'Unexpected turn')
        room = await request(path, actor.token)
        if (pkg.manifest.id === 'texas-holdem' && !room.observation.betweenHands) {
          assert.deepEqual(room.observation.players[1 - room.turn].hole, [null, null])
        }
        const advance = room.observation.legalActions.find(item => ['next-round', 'next-hand'].includes(item.type))
        const action = advance ?? (pkg.manifest.id === 'gomoku'
          ? { type: 'place', x: Math.floor(roundMoves / 2), y: roundMoves % 2 }
          : { type: room.observation.legalActions.some(item => item.type === 'call') ? 'call' : 'check' })
        if (advance) {
          advances++
          roundMoves = 0
        } else roundMoves++
        const command = {
          expectedVersion: room.version,
          idempotencyKey: `${runId}:${pkg.manifest.id}:${count}`,
          action,
        }
        room = await request(`${path}/actions`, actor.token, command)
        assert.deepEqual(
          await request(`${path}/actions`, actor.token, command),
          room,
          'Idempotent retry changed response',
        )
        count++
      }
      assert.equal(advances, 1, 'Configured second round must require an explicit advance')
      assert.equal(room.status, 'finished')
      assert.equal(room.settlement, 'none')
      const replay = await request(`${path}/replay`, accounts[0].token)
      assert.equal(replay.roomId, room.id)
      assert(replay.events.length > count)
      assert.equal((await request(path, accounts[0].token)).status, 'finished')
      report.games.push({
        game: pkg.manifest.id,
        version: pkg.manifest.version,
        roomId: room.id,
        actions: count,
        replayEvents: replay.events.length,
      })
    }
    assert.equal((await request('/v1/handshake')).serverId, handshake.serverId)
    assert.equal((await request('/health')).ok, true)
    console.log(JSON.stringify({ ...report, status: 'passed' }, null, 2))
  } finally {
    for (const account of accounts) await request('/v1/session', account.token, undefined, 'DELETE').catch(() => {})
  }
} finally {
  await mf.dispose()
  await rm(temporary, { recursive: true, force: true })
}
