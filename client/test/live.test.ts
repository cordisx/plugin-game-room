import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { LivePort } from '../src/data/live.js'
import { SourceAggregator } from '../src/data/aggregate.js'
import { consentFor, decodeInvitation, encodeInvitation, type Source, type SourceState } from '../src/data/model.js'
import { type HttpRequest, type HttpTransport, RequestFailure } from '../src/data/http.js'
const serverModule = process.env.GAME_ROOM_SERVER_MODULE
const fixture = {
  packageVersion: 1,
  manifest: {
    id: 'client-test',
    name: 'Client test',
    version: '1.0.0',
    minPlayers: 2,
    maxPlayers: 2,
    modes: ['score'],
  },
  rules:
    `globalThis.game={setup:()=>({state:{n:0,secret:'server-only'},turn:0}),act:(s,a)=>{if(a.type!=='move')throw Error('invalid_action');return {state:{...s,n:s.n+1},turn:s.n===0?1:null,...(s.n===1?{done:{winners:[0],scores:[1,0]}}:{})}},timeout:s=>({state:s,turn:null,done:{winners:[]}}),observe:(s,i)=>({n:s.n,seat:i,legalActions:[{type:'move'}]})}`,
  ui: {
    format: 'scene-v1',
    render:
      `globalThis.render=(o)=>({version:1,root:{type:'stack',children:[{type:'text',text:'Turn '+o.n},{type:'button',label:'Move',action:{type:'move'}}]}})`,
  },
}
// Synthetic credentials exist only in this test-only Node transport, never plugin artifacts.
class TestTransport implements HttpTransport {
  tokens = new Map<string, string>()
  dropNextAction = false
  async request(request: HttpRequest): Promise<unknown> {
    const response = await fetch(new URL(request.path, request.source.url), {
      method: request.method ?? 'GET',
      signal: request.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(request.authenticated ? { Authorization: `Bearer ${this.tokens.get(request.source.id)}` } : {}),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    })
    const body = await response.json() as { error?: { code?: string } }
    if (!response.ok) throw new RequestFailure(body.error?.code ?? `HTTP ${response.status}`, 'rejected')
    if (this.dropNextAction && request.path.endsWith('/actions')) {
      this.dropNextAction = false
      throw new Error('synthetic lost ACK')
    }
    return body
  }
  dispose() {
    this.tokens.clear()
  }
}
test('real two-server HTTP: exact packages, two-player match, lost ACK, replay, next match and outage', {
  skip: !serverModule,
}, async () => {
  const { createGameServer } = await import(pathToFileURL(serverModule!).href)
  const instances = [createGameServer({ tickMs: 0 }), createGameServer({ tickMs: 0 })]
  const transport = new TestTransport()
  const bobTransport = new TestTransport()
  const sources: Source[] = []
  let bobSource!: Source
  const signal = new AbortController().signal
  async function register(url: string, name: string) {
    const response = await fetch(`${url}/v1/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password: 'synthetic-test-password' }),
    })
    assert.equal(response.status, 200)
    return response.json() as Promise<{ token: string; account: { id: string } }>
  }
  try {
    for (const [index, instance] of instances.entries()) {
      await new Promise<void>(resolve => instance.server.listen(0, '127.0.0.1', resolve))
      const url = `http://127.0.0.1:${instance.server.address().port}`
      const handshake = await (await fetch(`${url}/v1/handshake`)).json() as { serverId: string }
      const account = await register(url, `ClientTest${index}`)
      const source = {
        id: handshake.serverId,
        name: `Source ${index}`,
        url,
        accountId: account.account.id,
        enabled: true,
      }
      sources.push(source)
      transport.tokens.set(source.id, account.token)
      await transport.request({
        source,
        path: '/v1/packages',
        method: 'POST',
        body: fixture,
        authenticated: true,
        signal,
      })
      if (index === 0) {
        const bob = await register(url, 'Bob')
        bobSource = { ...source, accountId: bob.account.id }
        bobTransport.tokens.set(source.id, bob.token)
        await bobTransport.request({
          source: bobSource,
          path: '/v1/packages',
          method: 'POST',
          body: { ...fixture, ui: { ...fixture.ui, render: fixture.ui.render + ';/*different publisher*/' } },
          authenticated: true,
          signal,
        })
      }
    }
    const port = new LivePort(sources, transport)
    const bob = new LivePort([bobSource], bobTransport)
    const catalog = await port.list(sources[0]!, signal)
    assert.equal(catalog.compatible, true)
    assert.equal(catalog.games.length, 2)
    const game = catalog.games.find(game => game.publisherId === bobSource.accountId)!
    const invitation = await port.create(sources[0]!.id, {
      name: 'Real client room',
      gameId: game.id,
      gameVersion: game.version,
      packageHash: game.packageHash,
      mode: 'score',
      stake: 0,
      allowAgents: true,
    }, signal)
    assert.equal(decodeInvitation(encodeInvitation(invitation, sources), sources).sourceId, sources[0]!.id)
    let aliceSeat = await port.join(invitation, signal)
    let bobSeat = await bob.join(invitation, signal)
    assert.equal(aliceSeat.room.game.packageHash, game.packageHash)
    assert.equal(aliceSeat.room.game.publisherId, bobSource.accountId)
    aliceSeat = await port.ready(aliceSeat, consentFor(aliceSeat.room), signal)
    bobSeat = await bob.ready(bobSeat, consentFor(bobSeat.room), signal)
    aliceSeat = await port.start(aliceSeat, signal)
    assert.equal(aliceSeat.status, 'playing')
    assert(aliceSeat.scene)
    assert(!JSON.stringify(aliceSeat.observation).includes('server-only'))
    transport.dropNextAction = true
    await assert.rejects(port.act(aliceSeat, { type: 'move' }, signal), /lost ACK/)
    const acknowledged = await port.act(aliceSeat, { type: 'move' }, signal)
    assert.equal((acknowledged.observation as { n: number }).n, 1)
    bobSeat = await bob.refreshSeat(bobSeat, signal)
    await bob.act(bobSeat, { type: 'move' }, signal)
    aliceSeat = await port.refreshSeat(acknowledged, signal)
    assert.equal(aliceSeat.status, 'finished')
    const history = await port.history(signal)
    assert.equal(history.length, 1)
    const replay = await port.replay(history[0]!, signal)
    assert(replay.length > 2)
    const next = await port.nextMatch(aliceSeat, signal)
    assert.notEqual(next.matchId, aliceSeat.matchId)
    assert.equal(next.status, 'waiting')
    assert.equal(next.observation, null)
    let states: SourceState[] = []
    const aggregate = new SourceAggregator(port, value => {
      states = value
    }, 200)
    await aggregate.refresh()
    assert.equal(states.filter(state => state.state === 'online').length, 2)
    await new Promise<void>(resolve => instances[1].server.close(resolve))
    await aggregate.refresh()
    assert.equal(states[0]!.state, 'online')
    assert.equal(states[0]!.snapshot!.rooms.length, 1)
    assert.equal(states[1]!.state, 'offline')
    aggregate.dispose()
    port.dispose()
    bob.dispose()
  } finally {
    for (const instance of instances) await instance.close()
  }
})
