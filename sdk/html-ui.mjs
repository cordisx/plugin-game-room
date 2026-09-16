/** Portable package resource validation; has no Host or server dependency. */
export const htmlUiLimits = Object.freeze({ assets: 32, assetBytes: 262144, totalBytes: 1048576 })
const media = new Set(['text/html', 'text/css', 'text/javascript', 'image/svg+xml'])
const encoder = new TextEncoder()
export function parseHtmlUi(value) {
  const fail = () => {
    throw Error('invalid_html_ui')
  }
  const record = item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail()
    if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) fail()
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail()
      const d = Object.getOwnPropertyDescriptor(item, key)
      if (!d.enumerable || !Object.hasOwn(d, 'value')) fail()
    }
  }
  record(value)
  if (Object.keys(value).some(k => !['format', 'bridgeVersion', 'entry', 'assets'].includes(k))) {
    fail()
  }
  if (value.format !== 'html-v1' || value.bridgeVersion !== 1 || typeof value.entry !== 'string') {
    fail()
  }
  record(value.assets)
  const entries = Object.entries(value.assets)
  if (!entries.length || entries.length > htmlUiLimits.assets) fail()
  let total = 0
  for (const [path, asset] of entries) {
    if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+$/.test(path)) fail()
    record(asset)
    if (Object.keys(asset).some(k => !['mediaType', 'content', 'sha256'].includes(k))) fail()
    if (
      !media.has(asset.mediaType) || typeof asset.content !== 'string'
      || !/^[a-f0-9]{64}$/.test(asset.sha256)
    ) fail()
    const bytes = encoder.encode(asset.content).length
    if (bytes > htmlUiLimits.assetBytes) fail()
    total += bytes
  }
  if (total > htmlUiLimits.totalBytes || value.assets[value.entry]?.mediaType !== 'text/html') {
    fail()
  }
  return JSON.parse(JSON.stringify(value))
}
/** Caller supplies its platform digest; verification precedes any execution. */
export async function verifyHtmlUi(value, sha256) {
  const ui = parseHtmlUi(value)
  for (const asset of Object.values(ui.assets)) {
    if (await sha256(asset.content) !== asset.sha256) throw Error('html_ui_integrity')
  }
  return ui
}
