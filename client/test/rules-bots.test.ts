import assert from 'node:assert/strict'
import test from 'node:test'
import { generalCreateSchema } from '../src/data/create-schema.js'
import type { Game, SourceState } from '../src/data/model.js'
const game: Game = {
  id: 'gomoku',
  name: '五子棋',
  version: '1.4.0',
  packageHash: 'hash',
  publisherId: 'author',
  icon: '',
  description: '',
  modes: ['score', 'token'],
  policies: [],
  rulesBot: true,
  maxPlayers: 2,
}
const states: SourceState[] = [{
  source: { id: 'source', name: 'source', url: 'http://localhost', accountId: '', enabled: true },
  state: 'online',
  snapshot: { rooms: [], games: [game], compatible: true, protocol: 'game-room/1' },
}]
const value = { sourceId: 'source', gameId: 'hash', name: '朋友', mode: 'score', maxPlayers: 2, allowAgents: false }
test('creation schema defaults bots to zero, caps Gomoku at one, and explains unavailable Token/legacy modes', () => {
  const schema = generalCreateSchema(states, 'source', game)
  assert.equal(schema(value).botCount, 0)
  assert.equal(schema({ ...value, botCount: 1 }).botCount, 1)
  assert.throws(() => schema({ ...value, botCount: 2 }))
  assert.throws(() => schema({ ...value, botCount: -1 }))
  assert.throws(() => schema({ ...value, botCount: .5 }))
  const token = generalCreateSchema(states, 'source', game, true)
  assert.throws(() => token({ ...value, mode: 'token', stake: 100, botCount: 1 }))
  assert.match(JSON.stringify(token), /独立资金身份/)
  const legacy = generalCreateSchema(states, 'source', { ...game, rulesBot: false })
  assert.throws(() => legacy({ ...value, botCount: 1 }))
  assert.equal(legacy(value).botCount, 0)
  const poker = generalCreateSchema(states, 'source', { ...game, maxPlayers: 8 })
  assert.equal(poker({ ...value, maxPlayers: 8, botCount: 7 }).botCount, 7)
})

test('old servers cannot silently accept a bot draft; capability is source-scoped and refreshed', async () => {
  const { LivePort } = await import('../src/data/live-restored.js')
  const source = states[0]!.source
  let available = false
  const transport = {
    dispose() {},
    async request({ path }: { path: string }) {
      if (path === '/v1/handshake') {
        return {
          serverId: source.id,
          protocol: 'game-room/1',
          gamePackageVersion: 1,
          uiFormats: ['scene-v1'],
          ...(available ? { rulesBots: ['rules-bot-v1'] } : {}),
        }
      }
      if (path === '/v1/rooms') return { rooms: [] }
      if (path === '/v1/packages') {
        return {
          packages: [{ hash: 'hash', publisherId: 'author', manifest: { ...game, rulesBot: 'rules-bot-v1' } }],
        }
      }
      throw Error('unexpected request')
    },
  }
  const port = new LivePort([source], transport)
  const signal = new AbortController().signal
  assert.equal((await port.list(source, signal)).games[0]!.rulesBot, false)
  await assert.rejects(
    port.create(source.id, {
      name: 'room',
      gameId: 'gomoku',
      gameVersion: '1.4.0',
      packageHash: 'hash',
      mode: 'score',
      stake: 0,
      allowAgents: false,
      botCount: 1,
    }, signal),
    /服务器尚未支持/,
  )
  available = true
  assert.equal((await port.list(source, signal)).games[0]!.rulesBot, true)
  available = false
  assert.equal((await port.list(source, signal)).games[0]!.rulesBot, false)
  port.dispose()
})

test('only one available selected source hides its selector; zero, multiple and stale selections stay explicit', () => {
  assert.equal(generalCreateSchema(states, 'source', game).dict?.sourceId, undefined)
  assert.ok(generalCreateSchema([], 'source', game).dict?.sourceId)
  assert.ok(generalCreateSchema(states, 'stale', game).dict?.sourceId)
  const other = { ...states[0]!, source: { ...states[0]!.source, id: 'other' } }
  assert.ok(generalCreateSchema([...states, other], 'source', game).dict?.sourceId)
})
