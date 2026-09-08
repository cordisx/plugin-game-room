import { array, number, object, string } from './http.js'
export const PACKAGE_LIMIT = 600 * 1024
export type PackagePreview = {
  name: string
  id: string
  version: string
  digest: string
  bytes: number
  modes: string[]
  document: Record<string, unknown>
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map((
        [key, value],
      ) => [key, canonical(value)]),
    )
  }
  return value
}
/** Parse as data only. Rules and HTML are never evaluated, imported, or inserted into the document. */
export async function inspectPackage(text: string): Promise<PackagePreview> {
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > PACKAGE_LIMIT) throw new Error('游戏包超过 600 KiB 上限')
  const document = object(JSON.parse(text))
  const manifest = object(document.manifest)
  if (document.packageVersion !== 1) throw new Error('需要 GamePackage v1')
  const id = string(manifest.id)
  const version = string(manifest.version)
  if (!/^[a-z0-9-]{1,64}$/.test(id) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('玩法 ID 或版本格式不兼容')
  string(document.rules)
  const ui = object(document.ui)
  if (ui.format !== 'scene-v1') throw new Error('需要 scene-v1 声明式界面；不接受 HTML 包')
  string(ui.render)
  const min = number(manifest.minPlayers)
  const max = number(manifest.maxPlayers)
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 2 || max > 8 || max < min) {
    throw new Error('人数范围须为 2–8 人')
  }
  const modes = array(manifest.modes).map(string)
  if (!modes.length || modes.some(mode => !['score', 'local-chips', 'token'].includes(mode))) {
    throw new Error('经济模式不兼容')
  }
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(document))))
  const digest = [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { name: string(manifest.name), id, version, digest, bytes, modes, document }
}
