import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GamePackage } from '../../sdk/index.js'
import { invokeBot } from '../../server/runner.js'
import { spectate } from '../../server/spectate.js'
import { game, harness } from './helpers.js'
const built = mkdtempSync(join(tmpdir(), 'rules-bot-packages-'))
execFileSync(process.execPath, [
  '--input-type=module',
  '-e',
  `import {build} from './games/tools/package.mjs'; await build('gomoku', ${
    JSON.stringify(built)
  }); await build('holdem', ${JSON.stringify(built)});`,
])
function builtPackage(name: string): GamePackage {
  const manifest = JSON.parse(readFileSync(new URL(`../../games/${name}/manifest.json`, import.meta.url), 'utf8'))
  return JSON.parse(readFileSync(join(built, `${manifest.id}-${manifest.version}.json`), 'utf8')) as GamePackage
}
const gomoku = builtPackage('gomoku')
const holdem = builtPackage('holdem')
rmSync(built, { recursive: true })
async function setup(pkg: GamePackage, count = 1, mode = 'score') {
  const h = await harness()
  const meta = await h.request('/v1/packages', h.alice.token, pkg)
  assert.equal(meta.status, 200, JSON.stringify(meta.body))
  const created = await h.request('/v1/rooms', h.alice.token, { packageHash: meta.body.hash, mode, botCount: count })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const path = `/v1/rooms/${created.body.id}`
  const start = async () => {
    await h.request(path + '/ready', h.alice.token, { ready: true })
    const r = await h.request(path + '/start', h.alice.token, {})
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'playing')
    return r.body
  }
  const tick = async () => await h.app.engine.serial(async () => await h.app.engine.tick())
  return { ...h, meta: meta.body, created: created.body, path, start, tick }
}
await test('default zero; waiting creator adds/removes real bot seats; capacity, authorization, token and legacy guards', async (t) => {
  const h = await setup(holdem, 0)
  t.after(async () => await h.app.close())
  assert.equal(h.created.seats.length, 1)
  assert.equal((await h.request(h.path + '/bots', h.bob.token, { add: true })).status, 403)
  const added = (await h.request(h.path + '/bots', h.alice.token, { add: true })).body
  assert.equal(added.seats[1].kind, 'bot')
  assert.equal(added.seats[1].ready, true)
  assert.notEqual(added.seats[1].accountId, added.creatorAccountId)
  assert.equal((await h.request(h.path + '?seatId=' + added.seats[1].id, h.alice.token)).status, 403)
  assert.equal(
    (await h.request(h.path + '/bots', h.alice.token, { removeSeatId: added.seats[1].id })).body.seats.length,
    1,
  )
  await h.tick()
  assert.equal((await h.app.engine.load(h.created.id)).status, 'waiting')
  const invalid = await h.request('/v1/rooms', h.alice.token, { packageHash: h.meta.hash, mode: 'score', botCount: 8 })
  assert.equal(invalid.body.error.code, 'invalid_bot_count')
  // Local chips are a match-only mode and require no wallet.
  const local = await h.request('/v1/rooms', h.alice.token, {
    packageHash: h.meta.hash,
    mode: 'local-chips',
    botCount: 1,
  })
  assert.equal(local.status, 200)
  const tokenRoom = await h.app.engine.load(local.body.id)
  tokenRoom.mode = 'token'
  await h.app.store.db.prepare('UPDATE rooms SET body=? WHERE id=?').run(JSON.stringify(tokenRoom), tokenRoom.id)
  assert.equal(
    (await h.request(`/v1/rooms/${tokenRoom.id}/bots`, h.alice.token, { add: true })).body.error.code,
    'legacy_transaction_read_only',
  )
  const legacy = await h.request('/v1/packages', h.alice.token, game())
  const noBot = await h.request('/v1/rooms', h.alice.token, {
    packageHash: legacy.body.hash,
    mode: 'score',
    botCount: 1,
  })
  assert.equal(noBot.body.error.code, 'rules_bot_unavailable')
  const empty = await h.request('/v1/rooms', h.alice.token, { packageHash: legacy.body.hash, mode: 'score' })
  assert.equal(empty.body.seats.length, 1)
})
await test('Gomoku human action triggers one legal computer move; exit cancels; no bot impersonation', async (t) => {
  const h = await setup(gomoku)
  t.after(async () => await h.app.close())
  const r = await h.start()
  await h.tick()
  assert.equal((await h.app.engine.load(r.id)).version, r.version)
  const body = { expectedVersion: r.version, idempotencyKey: 'human', action: { type: 'place', x: 7, y: 7 } }
  const moved = await h.request(h.path + '/actions', h.alice.token, body)
  assert.equal(moved.status, 200)
  assert.equal(
    (await h.request(h.path + '/actions', h.alice.token, {
      ...body,
      expectedVersion: moved.body.version,
      idempotencyKey: 'steal',
    })).status,
    403,
  )
  await Promise.all([await h.tick(), await h.tick()])
  const after = await h.app.engine.load(r.id)
  assert.equal(
    (after.state as {
      moves: number
    }).moves,
    2,
  )
  assert.equal(after.turn, 0)
  assert.equal(after.version, moved.body.version + 1)
  assert.equal((await h.request(h.path + '/bots', h.alice.token, { add: true })).status, 409)
  await h.request(h.path + '/leave', h.alice.token, {})
  const ended = await h.app.engine.load(r.id)
  assert.equal(ended.status, 'aborted')
  await h.tick()
  assert.equal((await h.app.engine.load(r.id)).version, ended.version)
})
await test('Holdem starts below capacity with all humans ready; real bets and spectator privacy through finish', async (t) => {
  const h = await setup(holdem, 2)
  t.after(async () => await h.app.close())
  await h.request(h.path + '/join', h.bob.token, {})
  await h.request(h.path + '/ready', h.alice.token, { ready: true })
  assert.equal((await h.request(h.path + '/start', h.alice.token, {})).body.error.code, 'not_ready')
  await h.request(h.path + '/ready', h.bob.token, { ready: true })
  const initial = await h.start()
  assert.equal(initial.seats.length, 4)
  assert.equal(initial.maxPlayers, 8)
  let botActions = 0
  for (let i = 0; i < 200; i++) {
    const room = await h.app.engine.load(initial.id)
    if (room.status !== 'playing') {
      break
    }
    const publicView = await spectate(h.app.engine, room.id)
    const observation = publicView.observation as {
      players: {
        hole: unknown[]
      }[]
      legalActions: unknown[]
    }
    assert.ok(observation.players.every(p => p.hole.every(c => c === null)))
    assert.deepEqual(observation.legalActions, [])
    const index = room.turn!
    const seat = room.seats[index]
    const view = room.observations[seat.id] as {
      players: {
        hole: unknown[]
      }[]
      legalActions: {
        type: string
      }[]
      participants: {
        kind: string
      }[]
    }
    assert.ok(view.players.every((p, i) => i === index || p.hole.every(c => c === null)))
    assert.equal(view.participants[1].kind, 'bot')
    if (seat.kind === 'bot') {
      await h.tick()
      assert.equal((await h.app.engine.load(room.id)).version, room.version + 1)
      botActions++
    } else {
      const action = view.legalActions.find(a => a.type === 'check') ?? view.legalActions.find(a => a.type === 'call')
        ?? { type: 'fold' }
      const result = await h.request(
        h.path + '/actions',
        seat.accountId === h.alice.account.id ? h.alice.token : h.bob.token,
        { expectedVersion: room.version, idempotencyKey: `step:${i}`, action },
      )
      assert.equal(result.status, 200, JSON.stringify(result.body))
    }
  }
  const final = await h.app.engine.load(initial.id)
  assert.equal(final.status, 'finished')
  assert.ok(botActions > 0)
  await h.tick()
  assert.equal((await h.app.engine.load(final.id)).version, final.version)
  const next = await h.request(h.path + '/next-match', h.alice.token, {})
  assert.ok(
    next.body.seats.filter((s: {
      kind: string
    }) => s.kind === 'bot').every((s: {
      ready: boolean
    }) => s.ready),
  )
})
await test('strategy isolation, bounded failure, legal validation and disposal', async (t) => {
  const ctx = { seatIndex: 1, seatCount: 2, mode: 'score' as const, canAct: true }
  const probe = await invokeBot(
    `globalThis.bot=(view,ctx)=>({keys:Object.keys(ctx),view,random:typeof globalThis.__platformRandom,fetch:typeof fetch,state:typeof state,seed:typeof seed})`,
    { hand: 'mine' },
    ctx,
  )
  assert.deepEqual(probe.value, {
    keys: ['seatIndex', 'seatCount', 'mode', 'canAct'],
    view: { hand: 'mine' },
    random: 'undefined',
    fetch: 'undefined',
    state: 'undefined',
    seed: 'undefined',
  })
  const pkg = game()
  pkg.manifest.rulesBot = 'rules-bot-v1'
  pkg.bot = { format: 'rules-bot-v1', source: "globalThis.bot=()=>({type:'illegal'})" }
  const h = await setup(pkg)
  t.after(async () => await h.app.close())
  const room = await h.start()
  await h.request(h.path + '/actions', h.alice.token, {
    expectedVersion: room.version,
    idempotencyKey: 'go',
    action: { type: 'move' },
  })
  const before = await h.app.engine.load(room.id)
  await h.tick()
  await h.tick()
  assert.equal((await h.app.engine.load(room.id)).version, before.version)
  await assert.rejects(invokeBot('globalThis.bot=()=>{while(true){}}', null, ctx), /rule_failure|runtime_limit/)
  h.app.engine.dispose()
  await h.tick()
  assert.equal((await h.app.engine.load(room.id)).version, before.version)
})
await test('creator enters waiting already ready; public lifecycle has no initialized game, joiner prepares once', async (t) => {
  const h = await setup(holdem, 1)
  t.after(async () => await h.app.close())
  assert.equal(h.created.seats[0].ready, true)
  const room = await h.app.engine.load(h.created.id)
  assert.equal(room.state, null)
  assert.equal(room.cursor, 0)
  const observation = h.created.observation
  assert.equal(observation.phase, 'waiting')
  assert.deepEqual(observation.legalActions, [])
  assert.equal(observation.players, undefined)
  assert.equal(observation.board, undefined)
  assert.equal(observation.seed, undefined)
  const publicView = await spectate(h.app.engine, room.id)
  assert.equal(
    (publicView.observation as {
      selfSeat: unknown
    }).selfSeat,
    null,
  )
  const joined = await h.request(h.path + '/join', h.bob.token, {})
  assert.equal(joined.body.seats[2].ready, false)
  assert.equal((await h.request(h.path + '/start', h.alice.token, {})).body.error.code, 'not_ready')
  const ready = await h.request(h.path + '/ready', h.bob.token, { ready: true })
  assert.equal(ready.body.seats[2].ready, true)
  assert.equal((await h.request(h.path + '/start', h.alice.token, {})).body.status, 'playing')
})
await test('targeted physical chairs survive holes, human joins, removals and next match without rule ordinal confusion', async (t) => {
  const h = await setup(holdem, 0)
  t.after(async () => await h.app.close())
  const handshake = (await h.request('/v1/handshake')).body
  assert.deepEqual(handshake.seatManagement, ['targeted-bot-seats-v1'])
  let view = (await h.request(h.path + '/bots', h.alice.token, { add: true, seatIndex: 5 })).body
  assert.deepEqual(
    view.seats.map((s: {
      seatIndex: number
    }) => s.seatIndex),
    [0, 5],
  )
  const farBot = view.seats[1].id
  const before = view.version
  assert.equal((await h.request(h.path + '/bots', h.alice.token, { add: true, seatIndex: 5 })).status, 409)
  assert.equal((await h.request(h.path + '/bots', h.alice.token, { add: true, seatIndex: 8 })).status, 400)
  assert.equal((await h.request(h.path + '/bots', h.bob.token, { add: true, seatIndex: 1 })).status, 403)
  assert.equal((await h.app.engine.load(h.created.id)).version, before)
  view = (await h.request(h.path + '/bots', h.alice.token, { add: true, seatIndex: 1 })).body
  const middleBot = view.seats[1].id
  view = (await h.request(h.path + '/bots', h.alice.token, { removeSeatId: middleBot })).body
  assert.deepEqual(
    view.seats.map((s: {
      seatIndex: number
    }) => s.seatIndex),
    [0, 5],
  )
  view = (await h.request(h.path + '/join', h.bob.token, {})).body
  assert.deepEqual(
    view.seats.map((s: {
      seatIndex: number
    }) => s.seatIndex),
    [0, 1, 5],
  )
  assert.equal(view.seats[2].id, farBot)
  assert.equal(view.selfSeatId, view.seats[1].id)
  assert.equal((await h.request(h.path + '/bots', h.alice.token, { removeSeatId: view.selfSeatId })).status, 404)
  await h.request(h.path + '/leave', h.bob.token, {})
  view = (await h.request(h.path + '/start', h.alice.token, {})).body
  assert.equal(view.status, 'playing')
  assert.equal(view.observation.selfSeat, 0)
  assert.deepEqual(
    view.seats.map((s: {
      seatIndex: number
    }) => s.seatIndex),
    [0, 5],
  )
  if ((await h.app.engine.load(h.created.id)).turn !== 0) {
    await h.tick()
  }
  const current = await h.app.engine.load(h.created.id)
  assert.equal(current.turn, 0)
  const done = (await h.request(h.path + '/actions', h.alice.token, {
    expectedVersion: current.version,
    idempotencyKey: 'targeted-chair-fold',
    action: { type: 'fold' },
  })).body
  assert.equal(done.status, 'finished', JSON.stringify(done))
  view = (await h.request(h.path + '/next-match', h.alice.token, {})).body
  assert.equal(view.status, 'waiting')
  assert.deepEqual(
    view.seats.map((s: {
      seatIndex: number
    }) => s.seatIndex),
    [0, 5],
  )
  assert.equal(view.seats[1].id, farBot)
})
await test('legacy room normalization preserves chairs and an agent fills the hole without replacing the distant bot', async (t) => {
  const h = await harness()
  t.after(async () => await h.app.close())
  const meta = (await h.request('/v1/packages', h.alice.token, holdem)).body
  const created =
    (await h.request('/v1/rooms', h.alice.token, { packageHash: meta.hash, mode: 'score', allowAgents: true })).body
  const path = `/v1/rooms/${created.id}`
  await h.request(path + '/join', h.bob.token, {})
  const legacy = await h.app.engine.load(created.id)
  legacy.seats.forEach(seat => delete seat.seatIndex)
  await h.app.engine.store.db.prepare('UPDATE rooms SET body=? WHERE id=?').run(JSON.stringify(legacy), created.id)
  let view = (await h.request(path + '/bots', h.alice.token, { add: true, seatIndex: 5 })).body
  assert.deepEqual(
    view.seats.map((s: {
      seatIndex: number
    }) => s.seatIndex),
    [0, 1, 5],
  )
  const farBot = view.seats[2].id
  await h.request(path + '/leave', h.bob.token, {})
  const agent = await h.app.engine.agentSeat(h.alice.account, created.id, {
    participantId: 'test-agent',
    name: 'Companion',
  })
  assert.equal(agent.seat.seatIndex, 1)
  assert.equal(agent.seat.kind, 'agent')
  view = agent.view
  assert.equal(view.seats[2].id, farBot)
  assert.equal(view.seats[2].kind, 'bot')
  assert.deepEqual(
    view.seats.map((s: {
      seatIndex: number
    }) => s.seatIndex),
    [0, 1, 5],
  )
})
