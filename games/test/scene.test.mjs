import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validateScene } from '../tools/scene.mjs'
import { context, invoke, source } from './runtime.mjs'
const uiSource = name => readFile(new URL(`../${name}/render.js`, import.meta.url), 'utf8')
function nodes(node) {
  return [node, ...(node.children || []).flatMap(nodes)]
}
async function render(name, observation, overrides = {}) {
  const ctx = {
    seatIndex: observation?.selfSeat ?? 0,
    seatCount: name === 'gomoku' ? 2 : 3,
    mode: 'local-chips',
    canAct: observation?.turn === observation?.selfSeat,
    ...overrides,
  }
  const { value } = await invoke(await uiSource(name), 'render', [observation], ctx)
  return validateScene(value)
}
test('Gomoku scene has all legal moves, coordinate labels, and no enabled opponent controls', async () => {
  const rules = await source('gomoku')
  const t = (await invoke(rules, 'setup', [], context())).value
  for (const seat of [0, 1]) {
    const view = (await invoke(rules, 'observe', [t.state, seat], context())).value
    const scene = await render('gomoku', view)
    const buttons = nodes(scene.root).filter(n => n.type === 'button')
    assert.equal(buttons.length, 225)
    assert.deepEqual(buttons.filter(n => !n.disabled).map(n => n.action), view.legalActions)
    assert.equal(buttons[224].ariaLabel, '15 列 15 行，空位')
    assert.ok(Buffer.byteLength(JSON.stringify(scene)) < 64 * 1024)
  }
})
test('Holdem numeric action supports arbitrary legal raise amount, not only preset bets', async () => {
  const rules = await source('holdem')
  const t = (await invoke(rules, 'setup', [], context(3))).value
  const view = (await invoke(rules, 'observe', [t.state, t.turn], context(3))).value
  const scene = await render('holdem', view)
  const numeric = nodes(scene.root).find(n => n.type === 'number-action')
  assert.deepEqual({ min: numeric.min, max: numeric.max, step: numeric.step }, {
    min: 40,
    max: 1000,
    step: 1,
  })
  const action = { ...numeric.action, [numeric.valueKey]: 77 }
  const next =
    (await invoke(rules, 'act', [t.state, action], context(3, { seatIndex: t.turn }))).value
  assert.equal(next.state.currentBet, 77)
  const readonly = await render('holdem', view, { canAct: false })
  assert.equal(
    nodes(readonly.root).filter(n => n.type === 'number-action' || n.type === 'button').length,
    0,
  )
})
test('waiting scenes clear cards and actions; UI guest has no random or private-state input', async () => {
  for (const name of ['gomoku', 'holdem']) {
    const scene = await render(name, null, { canAct: false })
    assert.deepEqual(nodes(scene.root).filter(n => n.type === 'text').map(n => n.text), [
      '等待本手开始',
    ])
  }
  const rules =
    `globalThis.render=(observation,ctx)=>({version:1,root:{type:'text',text:[typeof Date,typeof Math.random,typeof __random,typeof ctx.random,typeof ctx.state].join(',')}});`
  const result = await invoke(rules, 'render', [null], {
    seatIndex: 0,
    seatCount: 2,
    mode: 'score',
    canAct: false,
  })
  assert.equal(result.value.root.text, 'undefined,undefined,undefined,undefined,undefined')
})
test('offline scene validator rejects executable fields and unsafe numeric action composition', () => {
  assert.throws(() =>
    validateScene({
      version: 1,
      root: { type: 'text', text: 'hello', html: '<script>bad</script>' },
    })
  )
  const root = {
    type: 'number-action',
    label: 'amount',
    min: 1,
    max: 10,
    step: 1,
    value: 5,
    action: { type: 'raise' },
    valueKey: '__proto__',
  }
  assert.throws(() => validateScene({ version: 1, root }))
  assert.throws(() => validateScene({ version: 1, root: { ...root, valueKey: 'to', value: 11 } }))
})
