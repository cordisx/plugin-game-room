import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from './package.mjs'
const artifact = process.argv[2]
if (!artifact) throw Error('Usage: node tools/http-check.mjs /absolute/path/dist/server/http.js')
const { createGameServer } = await import(pathToFileURL(resolve(artifact)).href)
const temp = await mkdtemp(join(tmpdir(), 'game-packages-http-'))
const database = join(temp, 'test.sqlite')
let now = Date.now()
let app, base
async function start() {
  app = createGameServer({ database, tickMs: 0, now: () => now })
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${app.server.address().port}`
}
async function request(path, token, body, expected = 200) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const value = await response.json()
  assert.equal(response.status, expected, JSON.stringify(value))
  return value
}
try {
  await start()
  const users = []
  for (const name of ['package-test-a', 'package-test-b']) {
    users.push(await request('/v1/accounts', null, { name, password: 'local-test-password-only' }))
  }
  for (const name of ['gomoku', 'holdem']) {
    const { pkg, hash } = await build(name)
    const metadata = await request('/v1/packages', users[0].token, pkg)
    assert.equal(metadata.hash, hash)
    let room = await request('/v1/rooms', users[0].token, {
      packageHash: hash,
      mode: 'local-chips',
      maxPlayers: 2,
      policy: name === 'holdem' ? 'conserved-payouts-v1' : 'equal-winners-v1',
      turnTimeoutMs: 1000,
    })
    const path = `/v1/rooms/${room.id}`
    await request(`${path}/join`, users[1].token, {})
    for (const user of users) await request(`${path}/ready`, user.token, { ready: true })
    room = await request(`${path}/start`, users[0].token, {})
    assert.equal(room.status, 'playing')
    let count = 0
    while (room.status === 'playing') {
      const seat = room.turn
      room = await request(path, users[seat].token)
      const action = name === 'gomoku'
        ? { type: 'place', x: Math.floor(count / 2), y: count % 2 }
        : { type: room.observation.legalActions.some(a => a.type === 'call') ? 'call' : 'check' }
      const payload = { expectedVersion: room.version, idempotencyKey: `${name}-${count}`, action }
      if (count === 0) {
        await request(`${path}/actions`, users[seat].token, {
          ...payload,
          idempotencyKey: 'invalid',
          action: { type: 'invalid' },
        }, 422)
        assert.equal((await request(path, users[seat].token)).version, room.version)
      }
      room = await request(`${path}/actions`, users[seat].token, payload)
      assert.deepEqual(await request(`${path}/actions`, users[seat].token, payload), room)
      if (count++ === 0) {
        await app.close()
        await start()
        // Re-authentication and SQLite recovery return exactly the persisted seat view.
        const session = await request('/v1/sessions', null, {
          name: users[seat].account.name,
          password: 'local-test-password-only',
        })
        users[seat].token = session.token
        assert.deepEqual(await request(path, users[seat].token), room)
      }
      assert.ok(count < 100)
    }
    assert.equal(room.status, 'finished')
    if (name === 'gomoku') assert.deepEqual(room.result.winners, [0])
    else assert.equal(room.result.payouts.reduce((a, b) => a + b, 0), 2000)
    for (let seat = 0; seat < 2; seat++) {
      const replay = await request(`${path}/replay`, users[seat].token)
      assert.ok(replay.events.length > count)
      for (const event of replay.events) {
        assert.equal(event.view.state, undefined)
        assert.equal(event.view.seed, undefined)
        if (name === 'holdem' && event.view.status === 'playing') {
          assert.deepEqual(event.view.observation.players[1 - seat].hole, [null, null])
        }
      }
    }
    const previousMatch = room.matchId
    room = await request(`${path}/next-match`, users[0].token, {})
    assert.equal(room.status, 'waiting')
    assert.notEqual(room.matchId, previousMatch)
    assert.equal(room.handNo, 2)
    for (const user of users) await request(`${path}/ready`, user.token, { ready: true })
    room = await request(`${path}/start`, users[0].token, {})
    const version = room.version
    now += 1001
    await app.engine.serial(() => app.engine.tick())
    room = await request(path, users[0].token)
    assert.equal(room.version, version + 1)
    assert.equal(room.status, 'finished') // Both examples lose/fold when their first turn expires.
    console.log(
      `${name}: HTTP upload, two users, ${count} actions, restart/resume, replay privacy, next match and timeout passed (${hash})`,
    )
  }
} finally {
  if (app) await app.close()
  await rm(temp, { recursive: true, force: true })
}
