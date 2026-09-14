import { waitingObservation } from './waiting.js'
import type { Room } from './engine.js'
import type { Engine } from './engine.js'
import { requireThat } from './errors.js'
import { invoke, invokeUi } from './runner.js'
import { parseScene } from '../sdk/scene.js'
/** Separate projection: never reuse a player's cached observation or private view. */
const caches = new WeakMap<Engine, Map<string, Promise<Awaited<ReturnType<typeof project>>>>>()
export async function spectate(engine: Engine, id: string) {
  const room = await engine.load(id)
  const key = JSON.stringify([id, room.matchId, room.version])
  const cache = caches.get(engine) ?? new Map()
  caches.set(engine, cache)
  let pending = cache.get(key)
  if (!pending) {
    pending = project(engine, room)
    cache.set(key, pending)
    if (cache.size > 128) {
      cache.delete(cache.keys().next().value!)
    }
    void pending.catch(() => cache.delete(key))
  }
  return pending
}
async function project(engine: Engine, room: Room) {
  requireThat(room.manifest.spectating === true, 'spectating_unavailable', 409)
  const participants = room.seats.map((s, seat) => ({
    seatIndex: s.seatIndex ?? seat,
    name: s.name,
    kind: s.kind,
    isOwner: s.kind !== 'bot' && s.accountId === room.creatorAccountId,
  }))
  const summary = { participants, roomId: room.id, matchId: room.matchId, version: room.version, status: room.status }
  if (room.status === 'waiting' || room.status === 'funding') {
    return { ...summary, observation: waitingObservation(room, null), scene: null }
  }
  if (room.state === null) {
    return { ...summary, observation: null, scene: null }
  }
  const pkg = await engine.packages.get(room.packageHash)
  const { value: observation } = await invoke({
    rules: pkg.rules,
    method: 'observe',
    args: [room.state, null],
    ctx: {
      seats: room.seats.map(s => s.id),
      participants: room.seats.map(s => ({ name: s.name, kind: s.kind })),
      config: room.config,
      seatIndex: null,
      mode: room.mode,
      stake: room.stake,
      policy: room.policy,
    },
    seed: room.seed,
    cursor: room.cursor,
  })
  if (pkg.ui.format === 'html-v1') {
    return { ...summary, observation, scene: null }
  }
  const { value: rendered } = await invokeUi({
    render: pkg.ui.render,
    observation,
    context: { seatIndex: -1, seatCount: room.seats.length, mode: room.mode, canAct: false },
  })
  return { ...summary, observation, scene: parseScene(rendered) }
}
