import assert from 'node:assert/strict'
import { createGameServer } from './dist/server/http.js'
import { invoke, invokeUi } from './dist/server/runner.js'

// Mounted read-only into /app by CI; executes with the image's unprivileged user.
const app = createGameServer({ database: '/data/smoke.sqlite', tickMs: 0 })
try {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const { port } = app.server.address()
  const handshake = await (await fetch(`http://127.0.0.1:${port}/v1/handshake`)).json()
  assert.deepEqual(handshake.uiFormats, ['scene-v1'])
  const account = app.accounts.register('container-user', 'container-smoke-password')
  assert.equal(app.accounts.authenticate(account.token).id, account.account.id)
  const rule = await invoke({
    rules: 'globalThis.game={setup(ctx){return {n:ctx.random()}}}',
    method: 'setup',
    args: [],
    seed: 'smoke',
    cursor: 0,
    ctx: { seats: ['one', 'two'], config: {}, seatIndex: null, mode: 'score', stake: 0, policy: 'equal-winners-v1' },
  })
  assert.equal(rule.cursor, 1)
  const ui = await invokeUi({
    render: 'globalThis.render=(observation)=>({version:1,root:{type:"text",text:observation.text}})',
    observation: { text: 'container scene' },
    context: { seatIndex: 0, seatCount: 2, mode: 'score', canAct: true },
  })
  assert.equal(ui.value.root.text, 'container scene')
  console.log('Unprivileged read-only container: HTTP, writable SQLite, rule/UI WASM workers passed')
} finally {
  await app.close()
}
