import test from 'node:test'
import assert from 'node:assert/strict'
import { compareSemanticVersions, latestGameCatalog, latestSourceGames } from '../src/data/game-catalog.js'
import { createContext, defaultLobbyFilters, resolveCreateSelection } from '../src/data/lobby-context.js'
import { generalCreateSchema } from '../src/data/create-schema.js'
import type { Game, SourceState } from '../src/data/model.js'
const game = (version: string, id = 'holdem', hash = `${id}-${version}`): Game => ({
  id,
  name: '同名玩法',
  version,
  packageHash: hash,
  publisherId: 'publisher',
  modes: ['score', 'token'],
  policies: [],
  icon: '',
  description: '',
  rulesBot: true,
  minPlayers: 2,
  maxPlayers: 8,
})
const source = (id: string, games: Game[]): SourceState => ({
  source: { id, name: id, url: 'http://localhost:1234', enabled: true, accountId: '' },
  state: 'online',
  snapshot: { games, rooms: [], compatible: true, protocol: 'game-room/1' },
})
test('SemVer numeric/prerelease precedence and build ties, without numeric precision loss', () => {
  for (
    const [a, b] of [
      ['1.5.11', '1.5.7'],
      ['1.0.0', '1.0.0-rc.1'],
      ['1.0.0-beta.11', '1.0.0-beta.2'],
      ['1.0.0-beta', '1.0.0-10'],
      ['1.0.0-alpha.1', '1.0.0-alpha'],
      ['999999999999999999999.0.0', '999999999999999999998.0.0'],
    ]
  ) assert(compareSemanticVersions(a!, b!)! > 0)
  assert.equal(compareSemanticVersions('1.0.0+one', '1.0.0+two'), 0)
  for (const invalid of ['1.5', 'v1.5.11', '01.5.11', '1.0.0-01', 'latest']) {
    assert.equal(compareSemanticVersions(invalid, '1.0.0'), undefined)
  }
})
test('latest games retain source/id boundaries, exclude unavailable sources and preserve original packages', () => {
  const states = [
    source('one', [game('1.5.7'), game('1.5.11'), game('2.0.0', 'other')]),
    source('two', [game('1.1.0')]),
  ]
  const before = JSON.stringify(states)
  assert.deepEqual(latestGameCatalog(states).map(item => [item.source.id, item.game.id, item.game.version]), [
    ['one', 'holdem', '1.5.11'],
    ['one', 'other', '2.0.0'],
    ['two', 'holdem', '1.1.0'],
  ])
  states[0]!.snapshot!.games.reverse()
  assert.equal(latestSourceGames(states[0])[0]!.version, '1.5.11')
  states[0]!.snapshot!.games.reverse()
  assert.equal(JSON.stringify(states), before)
  assert.deepEqual(latestSourceGames({ ...states[0]!, state: 'offline' }), [])
})
test('same-precedence publisher/hash ambiguity needs explicit choice; old versions do not win', () => {
  const state = source('one', [game('1.5.7'), game('1.5.11+one', 'holdem', 'one'), {
    ...game('1.5.11+two', 'holdem', 'two'),
    publisherId: 'other',
  }])
  const context = createContext([state], { ...defaultLobbyFilters(), gameId: 'holdem' })
  assert.equal(resolveCreateSelection([state], context).packageHash, '')
  assert.deepEqual(latestSourceGames(state).map(g => g.packageHash).sort(), ['one', 'two'])
  assert.equal(
    resolveCreateSelection([state], { sourceId: 'one', gameId: 'missing', chooseSource: false, chooseGame: false })
      .packageHash,
    '',
  )
})
test('room-player schema uses actual min/max including host and bounds bots by chosen capacity', () => {
  const g = game('1.5.11'), states = [source('one', [g])]
  const value = {
    sourceId: 'one',
    gameId: g.packageHash,
    name: 'test',
    mode: 'score',
    maxPlayers: 4,
    botCount: 3,
    allowAgents: true,
  }
  const schema = generalCreateSchema(states, 'one', g, false, 4)
  assert.doesNotThrow(() => schema(value))
  for (const bad of [{ maxPlayers: 1 }, { maxPlayers: 9 }, { maxPlayers: 3.5 }, { botCount: 4 }]) {
    assert.throws(() => schema({ ...value, ...bad }))
  }
  const fixed = { ...g, id: 'gomoku', minPlayers: 2, maxPlayers: 2 }
  const fixedSchema = generalCreateSchema(states, 'one', fixed, false, 2)
  assert.equal(fixedSchema.dict!.maxPlayers!.meta.disabled, true)
  assert.throws(() => fixedSchema({ ...value, maxPlayers: 3 }))
  assert.throws(() =>
    generalCreateSchema(states, 'one', g, true, 4)({ ...value, stake: 100, mode: 'token', botCount: 1 })
  )
})
