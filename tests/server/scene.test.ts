import test from 'node:test'
import assert from 'node:assert/strict'
import { parseScene } from '../../sdk/scene.js'
import { invokeUi } from '../../server/runner.js'
import { game, harness } from './helpers.js'
const context = { seatIndex: 0, seatCount: 2, mode: 'score' as const, canAct: true }
const scene = (root: unknown) => ({ version: 1, root })
const text = { type: 'text', text: 'safe' }
test('scene exact keys and bounded trees reject executable primitives, action pollution and budgets', () => {
  assert.deepEqual(parseScene(scene(text)), scene(text))
  const bad = [
    scene({ ...text, html: '<script>fetch("https://attacker")</script>' }),
    scene({ type: 'image', src: 'https://attacker' }),
    scene({ type: 'button', label: 'Go', action: { url: 'https://text-only' }, href: 'https://attacker' }),
    scene({ type: 'button', label: 'Go', action: JSON.parse('{"__proto__":{"polluted":true}}') }),
    scene({ type: 'button', label: 'Go', action: { nested: { constructor: 'x' } } }),
    scene({ type: 'button', label: 'Go', action: '界'.repeat(1500) }),
    scene({ type: 'grid', columns: 20, children: [] }),
    scene({ ...text, text: 'x'.repeat(2049) }),
    scene({ type: 'stack', children: Array.from({ length: 401 }, () => text) }),
    scene({
      type: 'stack',
      children: Array.from({ length: 4 }, () => ({ type: 'stack', children: Array.from({ length: 300 }, () => text) })),
    }),
    scene({ type: 'stack', children: Array.from({ length: 40 }, () => ({ type: 'text', text: '界'.repeat(1024) })) }),
  ]
  let deep: unknown = text
  for (let i = 0; i < 16; i++) deep = { type: 'stack', children: [deep] }
  bad.push(scene(deep))
  for (const value of bad) assert.throws(() => parseScene(value), /invalid_scene/)
  assert.throws(() => parseScene(scene({ type: 'button', label: 'Go', action: [, 1] })), /invalid_scene/)
  assert.throws(() =>
    parseScene(scene({
      type: 'button',
      label: 'Go',
      action: {
        get dangerous() {
          throw Error('must not execute')
        },
      },
    })), /invalid_scene/)
})
test('numeric actions support arbitrary bounded raises and reject unsafe increments/keys', () => {
  const node = {
    type: 'number-action',
    label: 'Raise',
    min: 10,
    max: 500,
    step: 5,
    value: 25,
    action: { type: 'raise' },
    valueKey: 'amount',
  }
  assert.deepEqual(parseScene(scene(node)), scene(node))
  for (
    const patch of [
      { value: 26 },
      { step: 0 },
      { max: 2 },
      { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
      { valueKey: 'constructor' },
      { valueKey: 'nested.amount' },
      { action: [] },
      { value: Infinity },
    ]
  ) assert.throws(() => parseScene(scene({ ...node, ...patch })), /invalid_scene/)
})
test('UI guest sees only its observation and finite context; has no RNG, private rule state or platform capabilities', async () => {
  const render =
    `globalThis.render=(observation,context)=>({version:1,root:{type:'text',text:JSON.stringify({observation,keys:Object.keys(context).sort(),secret:typeof state,seed:typeof seed,random:typeof __platformRandom,math:typeof Math.random,date:typeof Date,network:typeof fetch,rtc:typeof RTCPeerConnection,process:typeof process})}})`
  const result = await invokeUi({ render, observation: { hand: 'own-hand' }, context })
  const validated = parseScene(result.value)
  assert.equal(validated.root.type, 'text')
  const values = JSON.parse((validated.root as { text: string }).text)
  assert.deepEqual(values.observation, { hand: 'own-hand' })
  assert.deepEqual(values.keys, ['canAct', 'mode', 'seatCount', 'seatIndex'])
  for (const key of ['secret', 'seed', 'random', 'math', 'date', 'network', 'rtc', 'process']) {
    assert.equal(values[key], 'undefined')
  }
  assert.equal(result.cursor, 0)
  for (
    const render of [
      'while(true){}',
      'globalThis.render=()=>{while(true){}}',
      'globalThis.render=()=>Promise.resolve(null)',
      'globalThis.render=()=>"x".repeat(65537)',
    ]
  ) await assert.rejects(invokeUi({ render, observation: null, context }))
})
test('HTTP scene is seat-private and persisted; legacy HTML is rejected and UI resource is JSON only', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const legacy = { ...game(), ui: { html: '<script>fetch("https://attacker")</script>' } }
  assert.equal((await h.request('/v1/packages', h.alice.token, legacy)).body.error.code, 'unsupported_ui_format')
  const room = await h.room()
  assert.equal(room.sceneError, null)
  assert(!JSON.stringify(room.scene).includes('private-1'))
  assert(JSON.stringify(room.scene).includes('private-0'))
  const bob = (await h.request(`/v1/rooms/${room.id}`, h.bob.token)).body
  assert(JSON.stringify(bob.scene).includes('private-1'))
  assert(!JSON.stringify(bob.scene).includes('private-0'))
  const replay = (await h.request(`/v1/rooms/${room.id}/replay`, h.alice.token)).body
  assert(!JSON.stringify(replay).includes('private-1'))
  assert.deepEqual(replay.events.at(-1).view.scene, room.scene)
  const meta = (await h.request(`/v1/packages/${room.packageHash}`)).body
  assert.equal(meta.uiFormat, 'scene-v1')
  const resource = await fetch(h.url + meta.uiUrl)
  assert.match(resource.headers.get('content-type')!, /application\/json/)
  assert.equal((await resource.json()).format, 'scene-v1')
})
test('malicious UI output aborts score and local-chips matches without exposing state', async t => {
  for (const mode of ['score', 'local-chips']) {
    const h = await harness()
    t.after(() => h.app.close())
    const pkg = game()
    pkg.ui.render = 'globalThis.render=()=>({version:1,root:{type:"text",text:"oops",url:"https://attacker"}})'
    const room = await h.room(pkg, { mode })
    assert.equal(room.status, 'aborted')
    assert.equal(room.scene, null)
    assert.equal(room.sceneError, 'ui_scene_invalid')
    assert.equal(room.result, null)
    assert.equal(room.deadline, null)
    const response = await h.request(`/v1/rooms/${room.id}/actions`, h.alice.token, {
      expectedVersion: room.version,
      idempotencyKey: 'cannot-play',
      action: { type: 'move' },
    })
    assert.equal(response.body.error.code, 'not_playing')
  }
})
test('a valid author scene showing a business error does not abort the match', async t => {
  const h = await harness()
  t.after(() => h.app.close())
  const pkg = game()
  pkg.ui.render = 'globalThis.render=()=>({version:1,root:{type:"text",text:"This move is not available"}})'
  const room = await h.room(pkg)
  assert.equal(room.status, 'playing')
  assert.equal(room.sceneError, null)
})
