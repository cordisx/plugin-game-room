import { allocateSeat, orderSeats } from './seat-positions.js'
import type { Engine, Room } from './engine.js'
import { integer, requireThat } from './errors.js'
import { invokeBot } from './runner.js'
export async function addRulesBots(engine: Engine, room: Room, count: unknown, targetSeatIndex?: unknown) {
  requireThat(integer(count, 0, room.maxPlayers - room.seats.length), 'invalid_bot_count')
  if (!count) {
    return
  }
  requireThat(room.mode !== 'token', 'bot_economy_identity_unavailable', 409)
  requireThat((await engine.packages.get(room.packageHash)).bot, 'rules_bot_unavailable', 409)
  for (let i = 0; i < count; i++) {
    const seatIndex = allocateSeat(room.seats, room.maxPlayers, targetSeatIndex)
    const id = engine.store.id('bot')
    // No login, grant, wallet or owner-account alias exists for this seat.
    const names = new Set(room.seats.map(s => s.name))
    let n = 1
    while (names.has(`规则电脑 ${n}`)) {
      n++
    }
    room.seats.push({
      seatIndex,
      id,
      accountId: id,
      participantId: null,
      kind: 'bot',
      name: `规则电脑 ${n}`,
      ready: true,
    })
    orderSeats(room.seats)
  }
}
// One attempt per persisted turn/version. Failures wait for the ordinary timeout;
// neither repeated polling nor restarts can spin an invalid strategy indefinitely.
export async function runRulesBot(engine: Engine, room: Room) {
  if (engine.isDisposed || room.status !== 'playing' || room.turn === null) {
    return
  }
  const seat = room.seats[room.turn]
  if (seat.kind !== 'bot') {
    return
  }
  const strategy = (await engine.packages.get(room.packageHash)).bot
  if (!strategy) {
    return
  }
  const key = `bot:${room.matchId}:${room.version}`
  const claimKey = `bot-attempt:${room.id}`
  const claimed = await engine.store.atomic(async () => {
    const prior = await engine.store.db.prepare('SELECT value FROM meta WHERE key=?').get(claimKey)
    if (prior?.value === key) return false
    await engine.store.db.prepare(
      'INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(claimKey, key)
    return true
  })
  if (!claimed) return
  try {
    const { value: action } = await invokeBot(strategy.source, room.observations[seat.id] ?? null, {
      seatIndex: room.turn,
      seatCount: room.seats.length,
      mode: room.mode,
      canAct: true,
    })
    if (engine.isDisposed) {
      return
    }
    await engine.action(
      seat.accountId,
      room.id,
      {
        expectedVersion: room.version,
        idempotencyKey: key,
        action,
      },
      undefined,
      seat.id,
    )
  } catch {
    // Existing authoritative timeout resolves a broken or illegal policy.
  }
}
