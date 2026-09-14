import { type CreateContext, resolveCreateSelection } from './lobby-context.js'
import { normalizeSourceUrl, type SourceState } from './model.js'
/** Product-owned configured origin, not a server name or remotely supplied trust claim. */
export const DEFAULT_OFFICIAL_SOURCE_ORIGINS = ['https://cordisx-game-room-api.sunshine4188y.chatgpt.site']
export type CreateSourceChoice = { sourceId: string; origin: string }
export type CreateSelection = { sourceId: string; packageHash: string }
export function sourceOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(normalizeSourceUrl(url))
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : undefined
  } catch {
    return undefined
  }
}
/** Preferences never identify a replacement server by an old id or a display name. */
export function reconcileCreateSelection(
  states: readonly SourceState[],
  context: CreateContext | undefined,
  current: CreateSelection,
  options: {
    previous?: CreateSourceChoice
    officialOrigins?: readonly string[]
    sourceEdited?: boolean
    gameEdited?: boolean
  } = {},
): CreateSelection {
  const available = states.filter(state =>
    state.state === 'online' && state.snapshot?.compatible && state.source.enabled
  )
  const official = new Set(options.officialOrigins?.map(sourceOrigin).filter(Boolean))
  const previous = options.previous
    && available.find(state =>
      state.source.id === options.previous?.sourceId && sourceOrigin(state.source.url) === options.previous.origin
    )
  const sourceId = options.sourceEdited
    ? current.sourceId
    : (previous ?? available.find(state => official.has(sourceOrigin(state.source.url)))
      ?? available.find(state => state.source.id === context?.sourceId) ?? available[0])?.source.id ?? ''
  if (sourceId === current.sourceId && (current.packageHash || options.gameEdited)) return current
  const next = resolveCreateSelection(states, {
    ...context,
    sourceId,
    chooseSource: false,
    chooseGame: context?.chooseGame ?? false,
  })
  return { sourceId, packageHash: next.packageHash }
}
