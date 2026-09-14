import type { Game, SourceState } from './model.js'

const numeric = /^(0|[1-9]\d*)$/
function semanticVersion(value: string) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
      .exec(value)
  if (!match) return undefined
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(part => /^\d+$/.test(part) && !numeric.test(part))) return undefined
  return { core: match.slice(1, 4), prerelease }
}
const compareNumeric = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
/** SemVer 2 precedence; build metadata is deliberately ignored. Invalid versions are not selectable. */
export function compareSemanticVersions(left: string, right: string): number | undefined {
  const a = semanticVersion(left), b = semanticVersion(right)
  if (!a || !b) return undefined
  for (let index = 0; index < 3; index++) {
    const order = compareNumeric(a.core[index]!, b.core[index]!)
    if (order) return order
  }
  if (!a.prerelease.length || !b.prerelease.length) return Number(!a.prerelease.length) - Number(!b.prerelease.length)
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index], y = b.prerelease[index]
    if (x === undefined || y === undefined) return Number(x !== undefined) - Number(y !== undefined)
    if (x === y) continue
    const xn = numeric.test(x), yn = numeric.test(y)
    return xn && yn ? compareNumeric(x, y) : xn !== yn ? Number(yn) - Number(xn) : x < y ? -1 : 1
  }
  return 0
}
/** Never combines packages from different sources or rewrites existing room snapshots. */
export function latestSourceGames(state?: SourceState): Game[] {
  if (state?.state !== 'online' || !state.snapshot?.compatible) return []
  const groups = new Map<string, Game[]>()
  for (const game of state.snapshot.games) {
    if (!semanticVersion(game.version)) continue
    const previous = groups.get(game.id)
    const order = previous ? compareSemanticVersions(game.version, previous[0]!.version)! : 1
    if (order > 0) groups.set(game.id, [game])
    else if (!order && !previous!.some(item => item.packageHash === game.packageHash)) previous!.push(game)
  }
  return [...groups.values()].flat().sort((a, b) =>
    a.id.localeCompare(b.id) || a.publisherId.localeCompare(b.publisherId) || a.packageHash.localeCompare(b.packageHash)
  )
}
export function latestGameCatalog(states: readonly SourceState[]) {
  return states.flatMap(state => latestSourceGames(state).map(game => ({ source: state.source, game })))
}
