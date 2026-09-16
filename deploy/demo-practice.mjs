import assert from 'node:assert/strict'
import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

process.umask(0o077)
const [command, statePath = '.data/live-preview'] = process.argv.slice(2)
assert(['init', 'run'].includes(command), 'Usage: node deploy/demo-practice.mjs init|run STATE_DIR')
const directory = resolve(statePath)
const label = '规则练习对手（非AI模型）'
const read = name => JSON.parse(readFileSync(join(directory, name), 'utf8'))
function save(name, value) {
  const path = join(directory, name)
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  renameSync(path + '.tmp', path)
  chmodSync(path, 0o600)
}
let credential
if (command === 'init') {
  const all = read('credentials.json')
  const opponent = all.accounts.find(account => account.role === 'opponent')
  credential = { url: all.url, serverId: all.serverId, accountId: opponent.accountId, token: opponent.token }
  save('practice-credential.json', credential)
} else {
  assert.equal(
    statSync(join(directory, 'practice-credential.json')).mode & 0o077,
    0,
    'Practice credential must be private',
  )
  credential = read('practice-credential.json')
}
const origin = new URL(credential.url)
assert(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))
async function request(path, body) {
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${credential.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const value = await response.json()
  if (!response.ok) {
    const error = new Error(value.error?.code ?? 'request_failed')
    error.status = response.status
    throw error
  }
  return value
}
const handshake = await request('/v1/handshake')
assert.equal(handshake.serverId, credential.serverId)
assert.equal(handshake.economyAvailable, false)
assert.equal((await request('/v1/me')).account.id, credential.accountId)
if (command === 'init') {
  const config = read('public-config.json')
  config.practiceRooms ??= []
  for (const pkg of config.packages) {
    if (!['gomoku', 'texas-holdem'].includes(pkg.manifest.id)) continue
    if (config.practiceRooms.some(room => room.packageHash === pkg.hash)) continue
    const room = await request('/v1/rooms', {
      packageHash: pkg.hash,
      mode: 'score',
      maxPlayers: 2,
      turnTimeoutMs: 600000,
      policy: pkg.manifest.settlementPolicies?.[0] ?? 'equal-winners-v1',
      config: {
        roomName: `${pkg.manifest.name} · ${label}`,
        demo: true,
        opponentMode: 'deterministic-practice',
        opponentDescription:
          `${label}；仅自己的席位观察，通过真实API合法行动；双方准备后自动开局，结束15秒后回到准备页。`,
      },
    })
    await request(`/v1/rooms/${room.id}/ready`, { ready: true })
    config.practiceRooms.push({
      gameId: pkg.manifest.id,
      packageHash: pkg.hash,
      roomId: room.id,
      creatorAccountId: credential.accountId,
      joinAsAccountId: config.accounts.find(account => account.role === 'preview').accountId,
      requiresOpponentWindow: false,
      opponentLabel: label,
    })
  }
  // Retire only untouched manual waiting rooms; never remove a reviewer's seat.
  for (
    const old of config.joinableRooms.filter(room =>
      !config.practiceRooms.some(practice => practice.roomId === room.roomId)
    )
  ) {
    const room = await request(`/v1/rooms/${old.roomId}`)
    if (room.status === 'waiting' && room.seats.length === 1 && room.seats[0].accountId === credential.accountId) {
      await request(`/v1/rooms/${room.id}/leave`, {})
    }
  }
  config.manualRooms ??= config.joinableRooms
  config.joinableRooms = config.practiceRooms
  config.opponentMode = 'deterministic-practice'
  config.opponentLabel = label
  save('public-config.json', config)
  save('practice-config.json', {
    url: credential.url,
    serverId: credential.serverId,
    accountId: credential.accountId,
    opponentLabel: label,
    roomIds: config.practiceRooms.map(room => room.roomId),
    resetDelayMs: 15000,
  })
  console.log(
    JSON.stringify(
      {
        opponentLabel: label,
        rooms: config.practiceRooms,
        credentialFile: join(directory, 'practice-credential.json'),
      },
      null,
      2,
    ),
  )
} else {
  const config = read('practice-config.json')
  assert.equal(config.serverId, credential.serverId)
  assert.equal(config.accountId, credential.accountId)
  let stopping = false
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      stopping = true
    })
  }
  const finishedAt = new Map()
  function actionFor(view) {
    const observation = view.observation
    const legal = observation.legalActions ?? []
    if (observation.kind === 'gomoku') {
      const ownSeat = observation.selfSeat
      const size = observation.size
      function wins(action, seat) {
        return [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) => {
          let count = 1
          for (const sign of [-1, 1]) {
            for (let step = 1; step < 5; step++) {
              const x = action.x + dx * step * sign, y = action.y + dy * step * sign
              if (x < 0 || x >= size || y < 0 || y >= size || observation.board[y * size + x] !== seat) break
              count++
            }
          }
          return count >= 5
        })
      }
      const center = (size - 1) / 2
      return legal.find(action => wins(action, ownSeat)) ?? legal.find(action => wins(action, 1 - ownSeat))
        ?? [...legal].sort((a, b) =>
          (Math.abs(a.x - center) + Math.abs(a.y - center)) - (Math.abs(b.x - center) + Math.abs(b.y - center))
          || a.y - b.y || a.x - b.x
        )[0]
    }
    assert.equal(observation.kind, 'holdem', 'Unknown practice game')
    for (const type of ['check', 'call', 'fold', 'all-in']) {
      if (legal.some(action => action.type === type)) return { type }
    }
    const raise = legal.find(action => action.type === 'raise')
    return raise ? { type: 'raise', to: raise.minTo } : undefined
  }
  console.log(JSON.stringify({ event: 'practice_started', opponentLabel: label, roomIds: config.roomIds }))
  while (!stopping) {
    const managed = read('practice-config.json')
    assert.equal(managed.serverId, credential.serverId)
    assert.equal(managed.accountId, credential.accountId)
    assert(Array.isArray(managed.roomIds) && managed.roomIds.length <= 8)
    for (const roomId of managed.roomIds) {
      if (stopping) break
      try {
        const path = `/v1/rooms/${roomId}`
        const room = await request(path)
        assert.equal(room.mode, 'score', 'Practice process must never control token rooms')
        const seatIndex = room.seats.findIndex(seat =>
          seat.accountId === credential.accountId && seat.id === room.selfSeatId
        )
        assert(seatIndex >= 0)
        if (room.status === 'waiting') {
          finishedAt.delete(room.matchId)
          const current = room.seats[seatIndex].ready ? room : await request(path + '/ready', { ready: true })
          if (current.seats.length >= current.manifest.minPlayers && current.seats.every(seat => seat.ready)) {
            await request(path + '/start', {})
          }
        } else if (room.status === 'playing' && room.turn === seatIndex) {
          const action = actionFor(room)
          if (action) {
            await request(path + '/actions', {
              expectedVersion: room.version,
              idempotencyKey: `${room.matchId}:practice:${room.version}`,
              action,
            })
          }
        } else if (['finished', 'aborted'].includes(room.status)) {
          if (!finishedAt.has(room.matchId)) finishedAt.set(room.matchId, Date.now())
          if (Date.now() - finishedAt.get(room.matchId) >= config.resetDelayMs) await request(path + '/next-match', {})
        }
      } catch (error) {
        console.error(JSON.stringify({ event: 'practice_request_failed', roomId, code: error.message }))
        if (error.status === 401) {
          stopping = true
          break
        }
      }
    }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, Math.max(1000, managed.roomIds.length * 500)))
  }
  console.log(JSON.stringify({ event: 'practice_stopped' }))
}
