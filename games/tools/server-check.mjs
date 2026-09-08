import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from './package.mjs'

// Compile the actual server in its owner's checkout first. Never execute guest rules in Node.
const artifact = process.argv[2]
if (!artifact) {
  throw Error('Usage: node tools/server-check.mjs /absolute/path/dist/server/runner.js')
}
const artifactUrl = pathToFileURL(resolve(artifact))
const { invoke, invokeUi, transition } = await import(artifactUrl.href)
const { parseScene } = await import(new URL('../sdk/scene.js', artifactUrl).href)
for (const name of ['gomoku', 'holdem']) {
  const { pkg, hash } = await build(name)
  const ctx = {
    seats: ['seat-0', 'seat-1'],
    config: {},
    mode: 'local-chips',
    stake: 0,
    policy: name === 'holdem' ? 'conserved-payouts-v1' : 'equal-winners-v1',
    seatIndex: null,
  }
  let cursor = 0
  async function run(method, args, seatIndex = null) {
    const result = await invoke({
      rules: pkg.rules,
      method,
      args,
      ctx: { ...ctx, seatIndex },
      seed: 'integration-seed',
      cursor,
    })
    cursor = result.cursor
    return result.value
  }
  let t = transition(await run('setup', []), 2)
  let steps = 0
  while (!t.done) {
    const view = await run('observe', [t.state, t.turn])
    const rendered = await invokeUi({
      render: pkg.ui.render,
      observation: view,
      context: { seatIndex: t.turn, seatCount: 2, mode: ctx.mode, canAct: true },
    })
    parseScene(rendered.value)
    const action = name === 'gomoku'
      ? { type: 'place', x: Math.floor(steps / 2), y: steps % 2 }
      : { type: view.legalActions.some(a => a.type === 'call') ? 'call' : 'check' }
    if (steps === 0) {
      await assert.rejects(run('act', [t.state, { type: 'definitely-invalid' }], t.turn))
    }
    t = transition(await run('act', [t.state, action], t.turn), 2)
    assert.ok(++steps < 100)
    if (name === 'holdem') {
      for (let seat = 0; seat < 2; seat++) {
        const seen = await run('observe', [t.state, seat])
        assert.equal(seen.deck, undefined)
        if (!t.done) assert.deepEqual(seen.players[1 - seat].hole, [null, null])
      }
      assert.equal(t.state.players.reduce((n, p) => n + p.stack + (t.done ? 0 : p.total), 0), 2000)
    }
  }
  if (name === 'gomoku') assert.deepEqual(t.done.winners, [0])
  else assert.equal(t.done.payouts.reduce((a, b) => a + b, 0), 2000)
  console.log(`${name}: actual server QuickJS complete, ${steps} actions, ${hash}`)
}
