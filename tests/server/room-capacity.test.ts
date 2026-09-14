import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GamePackage } from '../../sdk/index.js'
import { createGameServer } from '../../server/http.js'
import { harness } from './helpers.js'
const built = mkdtempSync(join(tmpdir(), 'capacity-packages-'))
let gomoku: GamePackage
let holdem: GamePackage
try {
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import {build} from './games/tools/package.mjs'; await build('gomoku', ${
      JSON.stringify(built)
    }); await build('holdem', ${JSON.stringify(built)});`,
  ])
  gomoku = JSON.parse(readFileSync(join(built, 'gomoku-1.5.12.json'), 'utf8'))
  holdem = JSON.parse(readFileSync(join(built, 'texas-holdem-1.4.10.json'), 'utf8'))
} finally {
  rmSync(built, { recursive: true })
}
async function publish(h: Awaited<ReturnType<typeof harness>>, pkg: GamePackage) {
  const result = await h.request('/v1/packages', h.alice.token, pkg)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  return result.body.hash as string
}
await test('capacity defaults to exact manifest maximum; fixed Gomoku and invalid values cannot persist', async (t) => {
  const h = await harness()
  t.after(async () => await h.app.close())
  for (const pkg of [gomoku, holdem]) {
    const packageHash = await publish(h, pkg)
    const defaults = await h.request('/v1/rooms', h.alice.token, { packageHash, mode: 'score' })
    assert.equal(defaults.status, 200)
    assert.equal(defaults.body.maxPlayers, pkg.manifest.maxPlayers)
    assert.equal(defaults.body.seats.length, 1)
    const before = (await h.app.engine.all()).length
    for (const maxPlayers of [null, '2', 1, pkg.manifest.maxPlayers + 1, 2.5, -1]) {
      const invalid = await h.request('/v1/rooms', h.alice.token, { packageHash, mode: 'score', maxPlayers })
      assert.equal(invalid.status, 400)
      assert.equal(invalid.body.error.code, 'invalid_max_players')
    }
    assert.equal((await h.app.engine.all()).length, before)
  }
})
await test('selected capacity persists and counts creator, human, bot and Agent together; spectators do not count', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'capacity-db-'))
  const database = join(dir, 'rooms.sqlite')
  const h = await harness({ database })
  let closed = false
  t.after(async () => {
    if (!closed) {
      await h.app.close()
    }
    rmSync(dir, { recursive: true })
  })
  const packageHash = await publish(h, holdem)
  const made = await h.request('/v1/rooms', h.alice.token, {
    packageHash,
    mode: 'score',
    maxPlayers: 4,
    botCount: 1,
    allowAgents: true,
  })
  assert.equal(made.status, 200)
  const path = `/v1/rooms/${made.body.id}`
  assert.equal(made.body.maxPlayers, 4)
  assert.deepEqual(
    made.body.seats.map((s: {
      kind: string
    }) => s.kind),
    ['human', 'bot'],
  )
  assert.equal((await h.request(path + '/join', h.bob.token, {})).status, 200)
  const agent = await h.request(path + '/agent-seats', h.stranger.token, { participantId: 'agent-1', name: 'Agent' })
  assert.equal(agent.status, 200)
  assert.equal((await h.app.engine.load(made.body.id)).seats.length, 4)
  for (let i = 0; i < 2; i++) {
    assert.equal((await h.request(path + '/spectate')).status, 200)
  }
  assert.equal((await h.app.engine.load(made.body.id)).seats.length, 4)
  assert.equal((await h.request(path + '/join', h.stranger.token, {})).body.error.code, 'room_full')
  assert.equal(
    (await h.request(path + '/agent-seats', h.bob.token, { participantId: 'agent-2', name: 'Extra' })).body.error.code,
    'room_full',
  )
  assert.equal((await h.request(path + '/bots', h.alice.token, { add: true })).body.error.code, 'invalid_bot_count')
  assert.equal(
    (await h.request('/v1/rooms', h.alice.token, { packageHash, mode: 'score', maxPlayers: 4, botCount: 4 })).body.error
      .code,
    'invalid_bot_count',
  )
  await h.request(path + '/ready', h.bob.token, { ready: true })
  await h.request(path + '/ready?seatId=' + agent.body.seat.id, h.stranger.token, { ready: true })
  const started = await h.request(path + '/start', h.alice.token, {})
  assert.equal(started.status, 200)
  assert.equal(started.body.status, 'playing')
  assert.equal(
    ((await h.app.engine.load(made.body.id)).state as {
      players: unknown[]
    }).players.length,
    4,
  )
  await h.app.close()
  closed = true
  const reopened = createGameServer({ database, tickMs: 0 })
  try {
    const restored = await reopened.engine.load(made.body.id)
    assert.equal(restored.maxPlayers, 4)
    assert.equal(restored.packageHash, packageHash)
    assert.equal(restored.manifest.version, holdem.manifest.version)
    assert.equal(restored.seats.length, 4)
  } finally {
    await reopened.close()
  }
})
await test('real Holdem rules support selected bounds and starting below capacity; concurrent joins cannot overfill', async (t) => {
  const h = await harness()
  t.after(async () => await h.app.close())
  const packageHash = await publish(h, holdem)
  for (const maxPlayers of [2, 8]) {
    const made = await h.request('/v1/rooms', h.alice.token, {
      packageHash,
      mode: 'score',
      maxPlayers,
      botCount: maxPlayers - 1,
    })
    assert.equal(made.status, 200)
    const started = await h.request(`/v1/rooms/${made.body.id}/start`, h.alice.token, {})
    assert.equal(started.status, 200)
    assert.equal(started.body.status, 'playing')
    assert.equal(started.body.maxPlayers, maxPlayers)
    assert.equal(
      ((await h.app.engine.load(made.body.id)).state as {
        players: unknown[]
      }).players.length,
      maxPlayers,
    )
  }
  const partial = await h.request('/v1/rooms', h.alice.token, { packageHash, mode: 'score', maxPlayers: 6 })
  const path = `/v1/rooms/${partial.body.id}`
  await h.request(path + '/join', h.bob.token, {})
  await h.request(path + '/ready', h.bob.token, { ready: true })
  const started = await h.request(path + '/start', h.alice.token, {})
  assert.equal(started.body.status, 'playing')
  assert.equal(started.body.maxPlayers, 6)
  assert.equal(
    ((await h.app.engine.load(partial.body.id)).state as {
      players: unknown[]
    }).players.length,
    2,
  )
  const race = await h.request('/v1/rooms', h.alice.token, { packageHash, mode: 'score', maxPlayers: 2 })
  const joins = await Promise.all(
    [h.bob, h.stranger].map(async (account) => await h.request(`/v1/rooms/${race.body.id}/join`, account.token, {})),
  )
  assert.deepEqual(joins.map(r => r.status).sort(), [200, 409])
  assert.equal((await h.app.engine.load(race.body.id)).seats.length, 2)
})
