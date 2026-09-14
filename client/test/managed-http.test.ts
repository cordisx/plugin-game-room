import assert from 'node:assert/strict'
import test from 'node:test'
import type { HttpClientV3 } from '@cordisx/protocol/plugin-http/v3'
import type { HttpConnectionV1 } from '@cordisx/protocol/plugin-http/v1'
import { HostHttpTransport } from '../src/data/host-http.js'
const source = {
  id: 'server',
  name: 'Local',
  url: 'http://127.0.0.1:18973',
  enabled: true,
  accountDisplayName: '朋友甲',
}
const grant = (id: string): HttpConnectionV1 => ({
  contract: 'cordisx.http-connection/v1',
  id,
  origin: source.url,
  credential: 'bearer',
})
function fixture(previous: HttpConnectionV1 | null = null) {
  let resumed = previous
  let finish!: (value: Awaited<ReturnType<HttpClientV3['connectAccount']>>) => void
  let calls = 0
  let retained = 0
  let retainWait: Promise<void> | undefined
  const revoked: string[] = []
  const inputs: Parameters<HttpClientV3['connectAccount']>[0][] = []
  const client: HttpClientV3 = {
    contract: 'cordisx.http-client/v3',
    async connectAccount(input) {
      calls++
      inputs.push(input)
      return new Promise(resolve => {
        finish = resolve
      })
    },
    async submitWorkUsage() {
      throw new Error('Work issuance outside this fixture')
    },
    async authorize() {
      throw new Error('Bearer prompt must not replace managed login')
    },
    async request() {
      throw new Error('No raw requests needed by this fixture')
    },
    async exchange() {
      throw new Error('Token exchange outside this fixture')
    },
    async retain() {
      retained++
      await retainWait
      return { status: 'accepted', value: null }
    },
    async resume() {
      return { status: 'accepted', value: resumed }
    },
    async forget() {
      return { status: 'accepted', value: null }
    },
    async revoke(connection) {
      revoked.push(connection.id)
      return { status: 'accepted', value: null }
    },
    dispose() {},
  }
  const transport = new HostHttpTransport(client)
  return {
    transport,
    holdRetain: (wait: Promise<void>) => {
      retainWait = wait
    },
    resumeWith: (value: HttpConnectionV1 | null) => {
      resumed = value
    },
    inputs,
    revoked,
    calls: () => calls,
    retained: () => retained,
    async started() {
      while (!finish) await new Promise(resolve => setImmediate(resolve))
    },
    finish(body: unknown = { instanceId: source.id, account: { id: 'native-source-account', guest: false } }) {
      finish({
        status: 'accepted',
        value: {
          connection: grant('managed'),
          response: {
            statusCode: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
          },
        },
      })
    },
  }
}
test('managed transport uses exact source trust and its own resumed guest grant, with display name only', async t => {
  const old = grant('owned-guest')
  const f = fixture(old)
  t.after(() => f.transport.dispose())
  const pending = f.transport.connectAccount(source, new AbortController().signal)
  await f.started()
  assert.deepEqual(f.inputs, [{
    origin: source.url,
    sourceId: source.id,
    instanceId: source.id,
    audience: 'source-account',
    displayName: '朋友甲',
    previousConnection: old,
  }])
  f.finish()
  await pending
  assert.equal(f.retained(), 1)
})
test('cancelled managed-login waiter settles while held and preserves the other waiter', async t => {
  const f = fixture()
  t.after(() => f.transport.dispose())
  const controller = new AbortController()
  const cancelled = f.transport.connectAccount(source, controller.signal)
  const valid = f.transport.connectAccount(source, new AbortController().signal)
  await f.started()
  controller.abort(new Error('caller cancelled'))
  await assert.rejects(cancelled, /caller cancelled/)
  assert.equal(f.calls(), 1)
  f.finish()
  await valid
  assert.equal(f.retained(), 1)
  assert.deepEqual(f.revoked, [])
})
test('closed owner revokes a late unpromoted managed grant without saving it', async () => {
  const f = fixture()
  const pending = f.transport.connectAccount(source, new AbortController().signal)
  await f.started()
  await f.transport.dispose()
  f.finish()
  await assert.rejects(pending, /授权已被替换/)
  assert.equal(f.retained(), 0)
  assert.deepEqual(f.revoked, ['managed'])
})
test('unsafe managed response is rejected before retention and its grant is revoked', async t => {
  const f = fixture()
  t.after(() => f.transport.dispose())
  const pending = f.transport.connectAccount(source, new AbortController().signal)
  await f.started()
  f.finish({ instanceId: source.id, account: { id: 'account', guest: false }, sessionToken: 'must-not-leak' })
  await assert.rejects(pending, /响应不兼容/)
  assert.equal(f.retained(), 0)
  assert.deepEqual(f.revoked, ['managed'])
})

test('relogin resumes the current public retained grant instead of forwarding a cached retired handle', async t => {
  const f = fixture()
  t.after(() => f.transport.dispose())
  const signal = new AbortController().signal
  const first = f.transport.connectAccount(source, signal)
  await f.started()
  f.finish()
  await first
  const current = grant('current-resumed')
  f.resumeWith(current)
  const next = f.transport.connectAccount(source, signal)
  while (f.calls() < 2) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.inputs[1].previousConnection, current)
  f.finish()
  await next
})

test('a later waiter cannot extend the shared managed deadline while retention is held', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const f = fixture()
  t.after(() => f.transport.dispose())
  let release!: () => void
  f.holdRetain(new Promise<void>(resolve => release = resolve))
  const first = f.transport.connectAccount(source, new AbortController().signal)
  const firstRejected = assert.rejects(first)
  await f.started()
  f.finish()
  while (!f.retained()) await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(10000)
  const later = f.transport.connectAccount(source, new AbortController().signal)
  const laterRejected = assert.rejects(later, /授权已被替换/)
  t.mock.timers.tick(6000)
  await firstRejected
  t.mock.timers.tick(4000)
  release()
  await laterRejected
  assert.equal(f.retained(), 1)
  assert.deepEqual(f.revoked, [])
  await assert.rejects(
    f.transport.request({ source, path: '/protected', authenticated: true, signal: new AbortController().signal }),
    /连接此来源账户/,
  )
})
