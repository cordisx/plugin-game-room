export type RoomDetailLayoutMode = 'wide' | 'overlay'

export interface RoomDetailLayout {
  mode: RoomDetailLayoutMode
  paneWidth: number
}

export const DEFAULT_GAME_MINIMUM_WIDTH = 640
export const MINIMUM_DETAILS_PANE_WIDTH = 320
export const MAXIMUM_DETAILS_PANE_WIDTH = 400
const DETAILS_PANE_RATIO = 0.3
const PANE_DIVIDER_WIDTH = 1

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Resolve the layout from the outer room width so opening the pane cannot change the decision. */
export function resolveRoomDetailLayout(
  availableWidth: number,
  declaredGameMinimumWidth?: number,
): RoomDetailLayout {
  const width = Math.max(0, Number.isFinite(availableWidth) ? availableWidth : 0)
  const gameMinimumWidth = positive(declaredGameMinimumWidth, DEFAULT_GAME_MINIMUM_WIDTH)
  const paneWidth = Math.min(
    MAXIMUM_DETAILS_PANE_WIDTH,
    Math.max(MINIMUM_DETAILS_PANE_WIDTH, Math.round(width * DETAILS_PANE_RATIO)),
  )
  return {
    mode: width >= gameMinimumWidth + paneWidth + PANE_DIVIDER_WIDTH ? 'wide' : 'overlay',
    paneWidth,
  }
}
