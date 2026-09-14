import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createContext,
  defaultLobbyFilters,
  lobbyEmptyState,
  openLobbyCreate,
  resolveCreateSelection,
} from '../src/data/lobby-context.js'
import type { Game, SourceState } from '../src/data/model.js'
const source = (id: string, games = ['gomoku', 'holdem']): SourceState => ({
  source: { id, name: id, url: 'http://127.0.0.1:1234', accountId: '', enabled: true },
  state: 'online',
  snapshot: {
    rooms: [],
    games: games.map(
      id => ({
        id,
        name: id,
        packageHash: `${id}-package`,
        version: '1.0.0',
        publisherId: 'p',
        modes: ['score'],
      } as Game),
    ),
    compatible: true,
    protocol: 'game-room/1',
  },
})
test('all entry points share source/game context without using search as room name', () => {
  const states = [source('one')],
    filters = { ...defaultLobbyFilters(), gameId: 'holdem', sourceIds: ['one'], search: 'query' }
  const runtime = {
    lobbyStates: states,
    lobbyFilters: filters,
    createContext: undefined as ReturnType<typeof createContext> | undefined,
    navigate: (page: string) => assert.equal(page, 'create'),
  }
  openLobbyCreate(runtime)
  assert.deepEqual(runtime.createContext, createContext(states, filters))
  assert.deepEqual(resolveCreateSelection(states, runtime.createContext), {
    sourceId: 'one',
    packageHash: 'holdem-package',
  })
  assert.equal('name' in runtime.createContext!, false)
})
test('ambiguous/unavailable sources and unsupported games never silently select another', () => {
  const states = [source('one'), source('two', ['gomoku'])]
  for (const sourceIds of [[], ['one', 'two'], ['missing']]) {
    assert.equal(
      resolveCreateSelection(states, createContext(states, { ...defaultLobbyFilters(), sourceIds })).sourceId,
      '',
    )
  }
  const context = createContext([source('one')], { ...defaultLobbyFilters(), gameId: 'missing' })
  assert.equal(resolveCreateSelection([source('one')], context).packageHash, '')
  assert.equal(
    resolveCreateSelection(states, { sourceId: 'two', gameId: 'holdem', chooseSource: false, chooseGame: false })
      .packageHash,
    '',
  )
})
test('loading resolves initial context and disappearing source remains unavailable', () => {
  const context = createContext([source('one')], { ...defaultLobbyFilters(), gameId: 'holdem' })
  assert.equal(resolveCreateSelection([], context).sourceId, '')
  assert.equal(resolveCreateSelection([source('one')], context).packageHash, 'holdem-package')
  assert.equal(resolveCreateSelection([{ ...source('one'), state: 'offline' }], context).sourceId, '')
})
test('real loaded data distinguishes loading/error/lobby/game/search/filter emptiness', () => {
  const f = defaultLobbyFilters(), states = [source('one')]
  assert.equal(lobbyEmptyState([], f).kind, 'loading')
  assert.equal(lobbyEmptyState([{ ...source('one'), state: 'offline' }], f).kind, 'error')
  assert.equal(lobbyEmptyState([...states, { ...source('two'), state: 'loading' }], f).kind, 'loading')
  assert.equal(lobbyEmptyState(states, f).kind, 'lobby')
  assert.equal(lobbyEmptyState(states, { ...f, search: 'q' }).kind, 'search')
  assert.equal(lobbyEmptyState(states, { ...f, gameId: 'holdem' }).kind, 'game')
  assert.equal(lobbyEmptyState(states, { ...f, agents: true }).kind, 'filter')
  assert.equal(lobbyEmptyState(states, { ...f, gameId: 'missing' }).kind, 'filter')
})
test('partial failed sources cannot claim a truly empty lobby; no sources is unavailable', () => {
  assert.equal(
    lobbyEmptyState([source('one'), { ...source('two'), state: 'offline' }], defaultLobbyFilters()).kind,
    'error',
  )
  assert.equal(lobbyEmptyState([], defaultLobbyFilters(), false).kind, 'error')
})
test('a selected game prefers its latest version but requires an explicit publisher choice when ambiguous', () => {
  const state = source('one')
  state.snapshot!.games.push({ ...state.snapshot!.games[0]!, version: '1.10.0', packageHash: 'new-package' })
  const context = createContext([state], { ...defaultLobbyFilters(), gameId: 'gomoku' })
  assert.equal(resolveCreateSelection([state], context).packageHash, 'new-package')
  state.snapshot!.games.push({
    ...state.snapshot!.games[0]!,
    publisherId: 'other',
    version: '1.10.0',
    packageHash: 'other-package',
  })
  assert.equal(resolveCreateSelection([state], context).packageHash, '')
})
