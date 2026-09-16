import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_GAME_MINIMUM_WIDTH,
  MAXIMUM_DETAILS_PANE_WIDTH,
  MINIMUM_DETAILS_PANE_WIDTH,
  resolveRoomDetailLayout,
} from '../src/components/room-detail-layout.js'

test('default game minimum selects overlay until both game and pane fit', () => {
  assert.deepEqual(resolveRoomDetailLayout(960), {
    mode: 'overlay',
    paneWidth: MINIMUM_DETAILS_PANE_WIDTH,
  })
  assert.deepEqual(resolveRoomDetailLayout(961), {
    mode: 'wide',
    paneWidth: MINIMUM_DETAILS_PANE_WIDTH,
  })
})

test('declared game minimum controls the wide threshold', () => {
  assert.equal(resolveRoomDetailLayout(1_120, 800).mode, 'overlay')
  assert.deepEqual(resolveRoomDetailLayout(1_161, 800), { mode: 'wide', paneWidth: 348 })
})

test('pane width remains within its compact bounds', () => {
  assert.equal(resolveRoomDetailLayout(700).paneWidth, MINIMUM_DETAILS_PANE_WIDTH)
  assert.equal(resolveRoomDetailLayout(2_000).paneWidth, MAXIMUM_DETAILS_PANE_WIDTH)
})

test('invalid sizes use safe finite fallbacks', () => {
  assert.deepEqual(resolveRoomDetailLayout(Number.NaN, Number.NaN), {
    mode: 'overlay',
    paneWidth: MINIMUM_DETAILS_PANE_WIDTH,
  })
  assert.equal(resolveRoomDetailLayout(DEFAULT_GAME_MINIMUM_WIDTH + MINIMUM_DETAILS_PANE_WIDTH + 1, -1).mode, 'wide')
})
