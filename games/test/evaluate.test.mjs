import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { context, invoke } from './runtime.mjs'
const rules = await readFile(new URL('../holdem/evaluate.js', import.meta.url), 'utf8')
  + '\nglobalThis.game={act:cards=>holdemEvaluate(cards)};'
const cards = text =>
  text.split(' ').map(card => 'shdc'.indexOf(card[1]) * 13 + '23456789TJQKA'.indexOf(card[0]))
const score = async text => (await invoke(rules, 'act', [cards(text)], context())).value
test('all nine categories compare correctly', async () => {
  const hands = [
    'As Kh 9d 5c 3s',
    'As Ah Kd 5c 3s',
    'As Ah Kd Kc 3s',
    'As Ah Ad Kc 3s',
    '2s 3h 4d 5c 6s',
    'As Js 9s 5s 3s',
    'As Ah Ad Kc Ks',
    'As Ah Ad Ac Ks',
    'As Ks Qs Js Ts',
  ]
  const scores = await Promise.all(hands.map(score))
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i] > scores[i - 1], hands[i])
})
test('wheel, six-high, kickers, two triples and seven-card best selection', async () => {
  assert.ok(await score('As 2h 3d 4c 5s') < await score('2s 3h 4d 5c 6s'))
  assert.ok(await score('As Ah Kd 5c 3s') > await score('As Ah Qd Jc 9s'))
  assert.equal(await score('As Ah Ad Kc Ks Kh 2s'), await score('As Ah Ad Kc Ks'))
  assert.equal(await score('As Ks Qs Js Ts 2d 3h'), await score('As Ks Qs Js Ts'))
  assert.equal(await score('As Ah Kd Kc Qs 3d 2h'), await score('As Ah Kd Kc Qs'))
  await assert.rejects(score('As As Kd Kc Qs'), /invalid_cards/)
})
