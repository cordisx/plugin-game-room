import type { GamePackage, RoomView } from '../../sdk/index.js'
import { createGameServer, type ServerOptions } from '../../server/http.js'
export const rules = `globalThis.game={
 setup(ctx){return {state:{hands:ctx.seats.map((_,i)=>'private-'+i),n:0,draw:ctx.random()},turn:0}},
 observe(s,i){return {hand:s.hands[i],n:s.n,legalActions:[{type:'move'}]}},
 act(s,a,ctx){if(a.type!=='move')throw Error('invalid_action');s.n++;return s.n>=2?{state:s,turn:null,done:{winners:[1],scores:[0,1]}}:{state:s,turn:1}},
 timeout(s,ctx){return {state:s,turn:null,done:{winners:[1-ctx.seatIndex]}}}
};`
export function game(source = rules): GamePackage {
  return {
    packageVersion: 1,
    manifest: {
      id: 'test-game',
      version: '1.0.0',
      name: 'Test',
      minPlayers: 2,
      maxPlayers: 2,
      modes: ['score', 'local-chips', 'token'],
      settlementPolicies: ['equal-winners-v1', 'conserved-payouts-v1'],
    },
    rules: source,
    ui: {
      format: 'scene-v1',
      render:
        `globalThis.render=(observation,context)=>({version:1,root:{type:'stack',children:[{type:'text',text:observation.hand},{type:'button',label:'Move',action:{type:'move'},disabled:!context.canAct}]}})`,
    },
  }
}
export async function harness(options: ServerOptions = {}) {
  const app = createGameServer({ ...options, tickMs: 0 })
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r))
  const address = app.server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}`
  async function request(path: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const res = await fetch(url + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json(), headers: res.headers }
  }
  async function register(name: string) {
    return (await request('/v1/accounts', undefined, { name, password: 'correct-horse-battery' })).body
  }
  const alice = await register('alice')
  const bob = await register('bobby')
  const stranger = await register('charlie')
  async function room(pkg = game(), extra: Record<string, unknown> = {}) {
    const meta = (await request('/v1/packages', alice.token, pkg)).body
    const initial =
      (await request('/v1/rooms', alice.token, { packageHash: meta.hash, mode: 'score', allowAgents: true, ...extra }))
        .body as RoomView
    await request(`/v1/rooms/${initial.id}/join`, bob.token, {})
    await request(`/v1/rooms/${initial.id}/ready`, alice.token, { ready: true })
    await request(`/v1/rooms/${initial.id}/ready`, bob.token, { ready: true })
    const started = await request(`/v1/rooms/${initial.id}/start`, alice.token, {})
    return started.body as RoomView
  }
  return { app, url, request, alice, bob, stranger, room }
}
