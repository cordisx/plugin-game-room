import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileCreateSelection, sourceOrigin } from '../src/data/create-source-selection.js'
import { CreatePreferences } from '../src/data/create-preferences.js'
import type { CordisXOwnerDocumentSnapshotV1, CordisXOwnerDocumentsV1 } from 'cordisx/contracts'
import type { Game, SourceState } from '../src/data/model.js'
const official = 'https://official.example'
const state = (id: string, url = `https://${id}.example`): SourceState => ({
  source: { id, url, name: id, accountId: '', enabled: true },
  state: 'online',
  snapshot: {
    compatible: true,
    protocol: 'game-room/1',
    rooms: [],
    games: [
      { id: 'gomoku', packageHash: `${id}-gomoku`, modes: ['score'], version: '1.0.0', publisherId: 'fixture' } as Game,
    ],
  },
})
const empty = { sourceId: '', packageHash: '' }
test('available previous choice wins, otherwise configured official origin, then other compatible available sources', () => {
  const states = [state('local'), state('site', official)], options = { officialOrigins: [official] }
  const previous = { sourceId: 'local', origin: 'https://local.example' }
  assert.equal(reconcileCreateSelection(states, undefined, empty, { ...options, previous }).sourceId, 'local')
  assert.equal(reconcileCreateSelection(states, undefined, empty, options).sourceId, 'site')
  for (
    const first of [{ ...states[0]!, state: 'offline' as const }, { ...states[0]!, state: 'incompatible' as const }, {
      ...states[0]!,
      source: { ...states[0]!.source, enabled: false },
    }]
  ) {
    assert.equal(
      reconcileCreateSelection([first, states[1]!], undefined, empty, { ...options, previous }).sourceId,
      'site',
    )
  }
  assert.equal(reconcileCreateSelection([states[0]!], undefined, empty, options).sourceId, 'local')
})
test('origin binding rejects reused ids and official-looking display names do not define trust', () => {
  const fake = state('local')
  fake.source.name = '官方服务器'
  assert.equal(
    reconcileCreateSelection([fake, state('site', official)], undefined, empty, {
      officialOrigins: [official],
      previous: { sourceId: 'local', origin: 'https://old.example' },
    }).sourceId,
    'site',
  )
  assert.equal(sourceOrigin('https://OFFICIAL.example:443/'), official)
  assert.equal(sourceOrigin('javascript:alert(1)'), undefined)
})
test('empty and loading sources resolve later; late official and preference reads can update automatic selection', () => {
  const options = { officialOrigins: [official] }, local = state('local'), site = state('site', official)
  let selected = reconcileCreateSelection([], undefined, empty, options)
  assert.deepEqual(selected, empty)
  selected = reconcileCreateSelection([{ ...local, state: 'loading' }], undefined, selected, options)
  assert.deepEqual(selected, empty)
  selected = reconcileCreateSelection([local], undefined, selected, options)
  assert.equal(selected.packageHash, 'local-gomoku')
  selected = reconcileCreateSelection([local, site], undefined, selected, options)
  assert.equal(selected.packageHash, 'site-gomoku')
  selected = reconcileCreateSelection([local, site], undefined, selected, {
    ...options,
    previous: { sourceId: 'local', origin: local.source.url },
  })
  assert.equal(selected.packageHash, 'local-gomoku')
})
test('manual source is never stolen by refresh, late preference, official arrival or temporary disappearance', () => {
  const local = state('local'), selected = { sourceId: 'local', packageHash: 'local-gomoku' }
  const options = { sourceEdited: true, officialOrigins: [official], previous: { sourceId: 'site', origin: official } }
  assert.deepEqual(reconcileCreateSelection([local, state('site', official)], undefined, selected, options), selected)
  assert.deepEqual(reconcileCreateSelection([state('site', official)], undefined, selected, options), selected)
  assert.deepEqual(
    reconcileCreateSelection([local], undefined, { sourceId: 'local', packageHash: '' }, options),
    selected,
  )
})
test('a source without games gets its package when loaded while an explicit game selection remains untouched', () => {
  const local = state('local'), waiting = { ...local, snapshot: { ...local.snapshot!, games: [] } }
  const selected = reconcileCreateSelection([waiting], undefined, empty)
  assert.deepEqual(selected, { sourceId: 'local', packageHash: '' })
  assert.equal(reconcileCreateSelection([local], undefined, selected).packageHash, 'local-gomoku')
  assert.deepEqual(
    reconcileCreateSelection([local], undefined, { ...selected, packageHash: 'chosen-package' }, { gameEdited: true }),
    { sourceId: 'local', packageHash: 'chosen-package' },
  )
})
function documentFixture() {
  let snapshot: CordisXOwnerDocumentSnapshotV1 = {
    contract: 'cordisx.owner-documents/v1',
    revision: 4,
    schemaVersion: 1,
    value: { sourceId: 'old', origin: 'https://old.example' },
  }
  let release: (() => void) | undefined, held: Promise<void> | undefined
  const writes: unknown[] = []
  const documents = {
    load: async () => {
      const captured = snapshot
      await held
      return { status: 'loaded', snapshot: captured }
    },
    replace: async (command: Parameters<CordisXOwnerDocumentsV1['replace']>[0]) => {
      assert.equal(command.documentId, 'create-room-preferences')
      assert.equal(command.expectedRevision, snapshot.revision)
      writes.push(command)
      snapshot = {
        contract: command.contract,
        schemaVersion: command.schemaVersion,
        revision: snapshot.revision + 1,
        value: command.value,
      }
      return { status: 'accepted', snapshot }
    },
  } as unknown as CordisXOwnerDocumentsV1
  return {
    documents,
    writes,
    hold: () => {
      held = new Promise<void>(resolve => release = resolve)
    },
    release: () => release?.(),
  }
}
async function waitWrites(writes: unknown[], count: number) {
  for (let attempt = 0; attempt < 50 && writes.length < count; attempt++) {
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(writes.length, count)
}
test('public owner document restores after a new activation and persists manual origin-bound choices using CAS', async () => {
  const f = documentFixture(), preferences = new CreatePreferences(f.documents)
  await preferences.load()
  assert.equal(preferences.current?.sourceId, 'old')
  preferences.remember(state('local').source)
  await waitWrites(f.writes, 1)
  preferences.remember(state('site', official).source)
  await waitWrites(f.writes, 2)
  preferences.dispose()
  const restored = new CreatePreferences(f.documents)
  await restored.load()
  assert.deepEqual(restored.current, { sourceId: 'site', origin: official })
  restored.dispose()
})
test('late preference load cannot overwrite manual selection and disposal ignores a late read', async () => {
  const f = documentFixture()
  f.hold()
  const preferences = new CreatePreferences(f.documents), loading = preferences.load()
  preferences.remember(state('local').source)
  f.release()
  await loading
  await waitWrites(f.writes, 1)
  assert.deepEqual(preferences.current, { sourceId: 'local', origin: 'https://local.example' })
  preferences.dispose()
  const late = documentFixture()
  late.hold()
  const closed = new CreatePreferences(late.documents), read = closed.load()
  closed.dispose()
  late.release()
  await read
  assert.equal(closed.current, undefined)
})
test('unavailable owner storage leaves manual choice usable without private fallback or overwriting retained data', async () => {
  let writes = 0
  const preferences = new CreatePreferences(
    {
      load: async () => ({ status: 'unavailable', code: 'corrupt-store', diagnostic: 'fixture', recoverable: true }),
      replace: async () => {
        writes++
        throw new Error('must preserve')
      },
    } as unknown as CordisXOwnerDocumentsV1,
  )
  await preferences.load()
  preferences.remember(state('local').source)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes, 0)
  assert.equal(preferences.current?.sourceId, 'local')
  preferences.dispose()
})

test('unknown preference schema stays preserved and a CAS conflict never performs an unguarded overwrite', async () => {
  let writes = 0
  const unknown = new CreatePreferences(
    {
      load: async () => ({
        status: 'loaded',
        snapshot: { contract: 'cordisx.owner-documents/v1', revision: 5, schemaVersion: 2, value: {} },
      }),
      replace: async () => {
        writes++
        throw new Error('must preserve unknown schema')
      },
    } as unknown as CordisXOwnerDocumentsV1,
  )
  await unknown.load()
  unknown.remember(state('local').source)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes, 0)
  unknown.dispose()
  const conflict = new CreatePreferences(
    {
      load: async () => ({ status: 'missing', revision: 0 }),
      replace: async command => {
        writes++
        assert.equal(command.expectedRevision, 0)
        return { status: 'conflict', actualRevision: writes }
      },
    } as CordisXOwnerDocumentsV1,
  )
  await conflict.load()
  conflict.remember(state('local').source)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes, 2)
  assert.equal(conflict.current?.sourceId, 'local')
  conflict.dispose()
})

test('another window revision gets one bounded CAS retry and restores the last choice', async () => {
  let revision = 0, value: unknown = {}, writes = 0
  const documents = {
    load: async () =>
      revision
        ? { status: 'loaded', snapshot: { contract: 'cordisx.owner-documents/v1', revision, schemaVersion: 1, value } }
        : { status: 'missing', revision: 0 },
    replace: async command => {
      writes++
      if (command.expectedRevision !== revision) return { status: 'conflict', actualRevision: revision }
      value = command.value
      revision++
      return {
        status: 'accepted',
        snapshot: { contract: 'cordisx.owner-documents/v1', revision, schemaVersion: 1, value },
      }
    },
  } as CordisXOwnerDocumentsV1
  const first = new CreatePreferences(documents), second = new CreatePreferences(documents)
  await Promise.all([first.load(), second.load()])
  first.remember(state('local').source)
  for (let attempt = 0; attempt < 50 && revision < 1; attempt++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(revision, 1)
  second.remember(state('site', official).source)
  for (let attempt = 0; attempt < 50 && revision < 2; attempt++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(revision, 2)
  assert.equal(writes, 3)
  const restored = new CreatePreferences(documents)
  await restored.load()
  assert.equal(restored.current?.sourceId, 'site')
  first.dispose()
  second.dispose()
  restored.dispose()
})
test('an old choice conflict cannot retry over a newer manual choice in this instance', async () => {
  let release!: (value: { status: 'conflict'; actualRevision: number }) => void
  const writes: Parameters<CordisXOwnerDocumentsV1['replace']>[0][] = []
  const documents = {
    load: async () => ({ status: 'missing', revision: 0 }),
    replace: async command => {
      writes.push(command)
      if (writes.length === 1) return new Promise(resolve => release = resolve)
      assert.equal(command.expectedRevision, 1)
      return {
        status: 'accepted',
        snapshot: { contract: 'cordisx.owner-documents/v1', schemaVersion: 1, revision: 2, value: command.value },
      }
    },
  } as CordisXOwnerDocumentsV1
  const preferences = new CreatePreferences(documents)
  await preferences.load()
  preferences.remember(state('local').source)
  await waitWrites(writes, 1)
  preferences.remember(state('site', official).source)
  release({ status: 'conflict', actualRevision: 1 })
  await waitWrites(writes, 2)
  assert.deepEqual(writes.map(command => command.value), [{ sourceId: 'local', origin: 'https://local.example' }, {
    sourceId: 'site',
    origin: official,
  }])
  assert.equal(preferences.current?.sourceId, 'site')
  preferences.dispose()
})

test('late public documents attachment uses the same preference object and persists earlier manual selection', async () => {
  const f = documentFixture(), preferences = new CreatePreferences()
  let notifications = 0
  const stop = preferences.subscribe(() => notifications++)
  preferences.remember(state('local').source)
  await new Promise(resolve => setImmediate(resolve))
  preferences.attach(f.documents)
  await waitWrites(f.writes, 1)
  assert.deepEqual(preferences.current, { sourceId: 'local', origin: 'https://local.example' })
  const restored = new CreatePreferences(f.documents)
  await restored.load()
  assert.equal(restored.current?.sourceId, 'local')
  assert.equal(notifications, 1)
  stop()
  preferences.dispose()
  restored.dispose()
})
test('detached public documents ignore their late load and a new attachment can restore', async () => {
  const old = documentFixture(), next = documentFixture(), preferences = new CreatePreferences()
  old.hold()
  preferences.attach(old.documents)
  const loading = preferences.load()
  preferences.detach(old.documents)
  old.release()
  await loading
  assert.equal(preferences.current, undefined)
  preferences.attach(next.documents)
  await preferences.load()
  assert.equal(preferences.current?.sourceId, 'old')
  preferences.dispose()
})
