import gomokuPresentation from './gomoku-presentation.json' with { type: 'json' }
import digests from './local-html-digests.json' with { type: 'json' }
import type { GameUiBundleV1 } from '@cordisx/protocol/isolated-game-ui/v1'
import { verifyHtmlUi } from '../../../sdk/html-ui.mjs'
import type { GameRoomPort } from './port.js'
import type { Room } from './model.js'
// Exact UI bundles developed and authorized in this local delivery. Imported HTML is not admitted.
const localDigests = new Set(digests)
export type KnownHtmlUi = { bundle: GameUiBundleV1 | null; waitingUi: boolean }
export type WaitingPresentation = {
  sourcePackageHash: string
  sourceDigest: string
  targetPackageHash: string
  targetDigest: string
}
const waitingPresentations: readonly WaitingPresentation[] = [{
  sourcePackageHash: '0886bafe5556be6f737debfc30d6bd35916d28ff13c1312001269d20fd33bb63',
  sourceDigest: 'fe62ebad3140ede823c3865bd0b9eaf18372c09f125ee2da68ccf55326331018',
  targetPackageHash: '46dc5c3849bcb0c7d1999708433e86032d75afd574b1f68f7e7ac5697c1179b2',
  targetDigest: '34f0a30b2a50447be53e023a1c511425dbb615cce32206164f731d90dde699c4',
}, {
  sourcePackageHash: 'c6fc07f59d6d552c4efffee5b89b53187071fa0f735bb4e436e2aa1ea5789bcd',
  sourceDigest: '3b0c7e58338f54ccdbebb069068e535f28c09e0294a595bea8f6cd2723e1f078',
  targetPackageHash: '19e9d9b59470d32ac3c451e8e51ff10e1d9974da25951889cc74ea6790a3d940',
  targetDigest: '437c90626af8a0737581fc6cff6345ab52c0bafadc401f2e537591fbc5322b9a',
}, {
  sourcePackageHash: '9514e9ba7c847c1794f67e700cb7f5795d74cf9bc397bb6a2743b39aa177eb7c',
  sourceDigest: '6c1b14ecf9ccd635425fcec76b9b28b61b54d932807e3ddbaa7f66457ed42043',
  targetPackageHash: '80e5626780b64d4a29c0cba073816fe0524a6ba7ac51aa40ffda702401219b41',
  targetDigest: '1864117da8bac03520ba4cb69ca764c646872849932153a63216a750ad781ce4',
}]
export function knownWaitingPresentation(packageHash: string, digest: string, status?: string) {
  if (status !== 'waiting' && status !== 'funding') return undefined
  return waitingPresentations.find(item => item.sourcePackageHash === packageHash && item.sourceDigest === digest)
}
export function assertWaitingPresentationTarget(presentation: WaitingPresentation, digest: string) {
  if (digest !== presentation.targetDigest) throw new Error('兼容等待界面身份不匹配')
}
async function verifiedHtmlUi(value: unknown, expectedDigest: string): Promise<GameUiBundleV1 | null> {
  const bundle = value as GameUiBundleV1 | { format: 'scene-v1' }
  if (bundle.format === 'scene-v1') return null
  if (!localDigests.has(expectedDigest)) {
    throw new Error('此 HTML 游戏包尚未获准运行；当前仅支持本次本地开发的游戏版本。')
  }
  const ui = await verifyHtmlUi(
    bundle,
    async content =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)))].map(x =>
        x.toString(16).padStart(2, '0')
      ).join(''),
  )
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => [k, canonical(v)]))
      : item
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(ui))))),
  ].map(x => x.toString(16).padStart(2, '0')).join('')
  if (digest !== expectedDigest) throw new Error('游戏资源完整性校验失败')
  return ui
}
export async function loadKnownHtmlUi(
  port: GameRoomPort,
  room: Room,
  signal: AbortSignal,
  status?: string,
): Promise<KnownHtmlUi> {
  const value = await port.gameUi!(room, signal) as { bundle: GameUiBundleV1 | { format: 'scene-v1' }; digest: string }
  const source = await verifiedHtmlUi(value.bundle, value.digest)
  // A presentation-only fix for these exact immutable packages. Rules and match identity stay pinned.
  if (isGomokuClockPresentation(room.game.packageHash, value.digest)) {
    return { bundle: await verifiedHtmlUi(gomokuPresentation.bundle, gomokuPresentation.digest), waitingUi: true }
  }
  const presentation = knownWaitingPresentation(room.game.packageHash, value.digest, status)
  if (!presentation) return { bundle: source, waitingUi: room.game.waitingUi === true }
  if (!port.gameUiPackage) throw new Error('当前客户端无法加载兼容等待界面')
  const target = await port.gameUiPackage(room.sourceId, presentation.targetPackageHash, signal) as {
    bundle: GameUiBundleV1 | { format: 'scene-v1' }
    digest: string
  }
  assertWaitingPresentationTarget(presentation, target.digest)
  const bundle = await verifiedHtmlUi(target.bundle, target.digest)
  if (bundle === null) throw new Error('兼容等待界面格式不匹配')
  return { bundle, waitingUi: true }
}

export function isGomokuClockPresentation(packageHash: string, digest: string) {
  return (packageHash === '4ce550ff5cf585984dd1d688a8671dde9400f7b1055405ab68104fb847ab4fe0'
    && digest === '4351537370490204ac2b99175df9844ccce8b7e3a3b33ffd26100733d786793d')
    || (packageHash === '80e5626780b64d4a29c0cba073816fe0524a6ba7ac51aa40ffda702401219b41'
      && digest === '1864117da8bac03520ba4cb69ca764c646872849932153a63216a750ad781ce4')
}
