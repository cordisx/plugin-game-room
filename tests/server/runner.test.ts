import test from 'node:test'
import assert from 'node:assert/strict'
import { invoke } from '../../server/runner.js'
const ctx = {
  seats: ['a', 'b'],
  config: {},
  seatIndex: null,
  mode: 'score' as const,
  stake: 0,
  policy: 'equal-winners-v1' as const,
}
const run = (rules: string, method: 'setup' | 'observe' = 'setup', limits = {}) =>
  invoke({ rules, method, args: [], ctx, seed: 'fixed-server-secret', cursor: 0 }, limits)
test('WASM guest has no filesystem, network, process, Date or random; deterministic platform random', async () => {
  const source =
    `globalThis.game={setup(ctx){return [typeof process,typeof require,typeof fetch,typeof Date,typeof Math.random,typeof XMLHttpRequest,typeof setTimeout,ctx.random(),ctx.random()]}}`
  const a = await run(source)
  const b = await run(source)
  assert.deepEqual(a, b)
  assert.equal(a.cursor, 2)
  assert.deepEqual((a.value as unknown[]).slice(0, 7), Array(7).fill('undefined'))
})
test('CPU, memory, output and async abuse fail closed; later healthy guest survives', async () => {
  for (
    const source of [
      `globalThis.game={setup(){while(true){}}}`,
      `globalThis.game={setup(){let x=[];while(true)x.push('x'.repeat(100000))}}`,
      `globalThis.game={setup(){return 'x'.repeat(300000)}}`,
      `globalThis.game={setup(){return Promise.resolve(1)}}`,
      `while(true){}`,
    ]
  ) await assert.rejects(run(source), /rule_failure|runtime_limit|runtime_failure/)
  assert.equal((await run('globalThis.game={setup(){return 42}}')).value, 42)
})
test('observation cannot advance platform randomness or import host modules', async () => {
  await assert.rejects(run('globalThis.game={observe(ctx){return ctx.random()}}', 'observe'))
  await assert.rejects(run(`import fs from 'node:fs';globalThis.game={setup(){return fs.readFileSync('/etc/passwd')}}`))
})
