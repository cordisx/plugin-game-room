import assert from 'node:assert/strict'
import test from 'node:test'
import { GameUiAssets } from '../src/data/game-ui-assets.js'
import type { HttpTransport } from '../src/data/http.js'
import type { Source } from '../src/data/model.js'

test('assets fetch in parallel, survive navigation cancellation and reuse immutable versions', async () => {
  const calls: string[] = []
  const completions: (() => void)[] = []
  const http = {
    request: ({ path }: { path: string }) => {
      calls.push(path)
      return new Promise(resolve =>
        completions.push(() =>
          resolve(path.endsWith('/ui') ? { format: 'html-v1' } : { hash: 'h', uiSha256: 'digest' })
        )
      )
    },
  } as unknown as HttpTransport
  const source = { id: 's', url: 'https://s.test' } as Source
  const assets = new GameUiAssets()
  const first = new AbortController()
  const abandoned = assets.load(http, source, 'h', first.signal)
  assert.equal(calls.length, 2)
  first.abort()
  await assert.rejects(abandoned)
  const next = assets.load(http, source, 'h', new AbortController().signal)
  completions.forEach(finish => finish())
  assert.equal((await next).digest, 'digest')
  await assets.load(http, source, 'h', new AbortController().signal)
  assert.equal(calls.length, 2)
})

test('failed package identity is not cached', async () => {
  let calls = 0
  const http = {
    request: async () => {
      calls++
      return { hash: 'wrong' }
    },
  } as unknown as HttpTransport
  const assets = new GameUiAssets()
  for (let i = 0; i < 2; i++) {
    await assert.rejects(
      assets.load(http, { id: 's', url: 'https://s.test' } as Source, 'h', new AbortController().signal),
      /身份/,
    )
  }
  assert.equal(calls, 4)
})
