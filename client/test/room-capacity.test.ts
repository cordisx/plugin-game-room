import assert from 'node:assert/strict'
import test from 'node:test'
import { LivePort } from '../src/data/live-restored.js'
import type { HttpRequest } from '../src/data/http.js'
import type { CreateRoom, Source } from '../src/data/model.js'

test('live catalog retains player bounds and creation sends selected total capacity with exact package pin', async () => {
  const source: Source = { id: 'server', name: 'Server', url: 'http://localhost', accountId: '', enabled: true }
  let sent: Record<string, unknown> = {}
  const manifest = { id: 'holdem', name: 'Holdem', version: '1.4.9', minPlayers: 2, maxPlayers: 8, modes: ['score'] }
  const port = new LivePort([source], {
    dispose() {},
    async request({ path, method, body }: HttpRequest) {
      if (path === '/v1/handshake') {
        return { serverId: 'server', protocol: 'game-room/1', gamePackageVersion: 1, uiFormats: ['scene-v1'] }
      }
      if (path === '/v1/packages') return { packages: [{ hash: 'exact-hash', publisherId: 'publisher', manifest }] }
      if (path === '/v1/rooms' && method === 'POST') {
        sent = body as Record<string, unknown>
        throw Error('request recorded')
      }
      if (path === '/v1/rooms') return { rooms: [] }
      throw Error('unexpected request ' + path)
    },
  })
  try {
    const signal = new AbortController().signal
    const listed = (await port.list(source, signal)).games[0]!
    assert.equal(listed.minPlayers, 2)
    assert.equal(listed.maxPlayers, 8)
    const draft: CreateRoom = {
      name: 'Room',
      gameId: 'holdem',
      gameVersion: '1.4.9',
      packageHash: 'exact-hash',
      mode: 'score',
      stake: 0,
      allowAgents: true,
    }
    for (const [maxPlayers, expected] of [[4, 4], [2, 2], [undefined, 8]] as const) {
      await assert.rejects(port.create('server', { ...draft, maxPlayers }, signal), /request recorded/)
      assert.equal(sent.maxPlayers, expected)
      assert.equal(sent.packageHash, 'exact-hash')
    }
  } finally {
    port.dispose()
  }
})
