import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { smoke } from './smoke.mjs'

export const root = fileURLToPath(new URL('../', import.meta.url))
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${
      Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(
        ',',
      )
    }}`
  }
  return JSON.stringify(value)
}
export function validate(pkg) {
  const m = pkg.manifest
  if (
    pkg.packageVersion !== 1 || !m || !/^[a-z0-9-]{1,64}$/.test(m.id)
    || !/^\d+\.\d+\.\d+$/.test(m.version) || typeof m.name !== 'string' || !m.name.trim()
    || !Number.isInteger(m.minPlayers) || !Number.isInteger(m.maxPlayers) || m.minPlayers < 2
    || m.maxPlayers > 8 || m.maxPlayers < m.minPlayers
    || !Array.isArray(m.modes) || !m.modes.length
    || m.modes.some(mode => !['score', 'local-chips', 'token'].includes(mode))
    || typeof pkg.rules !== 'string' || !pkg.rules.includes('globalThis.game')
    || typeof pkg.ui?.html !== 'string' || !pkg.ui.html.includes('<!doctype html>')
  ) {
    throw Error('Invalid GamePackage v1')
  }
  if (/<(?:script|link|iframe|img)\b[^>]*\b(?:src|href)\s*=/i.test(pkg.ui.html)) {
    throw Error('UI must be self-contained')
  }
  return createHash('sha256').update(canonical(pkg)).digest('hex')
}
export async function build(name, output = join(root, 'dist')) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid source directory')
  const dir = join(root, name)
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  const pieces = name === 'holdem' ? ['evaluate.js', 'rules.js'] : ['rules.js']
  const rules = (await Promise.all(pieces.map(file => readFile(join(dir, file), 'utf8')))).join(
    '\n',
  )
  const [css, adapter, ui, body] = await Promise.all([
    readFile(join(root, 'shared/game.css'), 'utf8'),
    readFile(join(root, 'shared/adapter.js'), 'utf8'),
    readFile(join(dir, 'ui.js'), 'utf8'),
    readFile(join(dir, 'body.html'), 'utf8'),
  ])
  const html =
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${manifest.name}</title><style>${css}</style><body>${body}<script>${adapter}\n${ui}</script></body></html>`
  const pkg = { packageVersion: 1, manifest, rules, ui: { html } }
  const hash = validate(pkg)
  await mkdir(output, { recursive: true })
  const path = join(output, `${manifest.id}-${manifest.version}.json`)
  await writeFile(path, `${canonical(pkg)}\n`)
  return { path, hash, pkg }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = 'build', ...args] = process.argv.slice(2)
  if (command === 'build') {
    for (const name of args.length ? args : ['gomoku', 'holdem']) {
      const { path, hash } = await build(name)
      console.log(`${hash}  ${path}`)
    }
  } else if (command === 'validate') {
    if (!args.length) throw Error('Usage: npm run validate -- <package.json>')
    for (const path of args) {
      const pkg = JSON.parse(await readFile(path, 'utf8'))
      const hash = validate(pkg)
      await smoke(pkg)
      console.log(`${hash}  ${path} (QuickJS setup/observe/timeout passed)`)
    }
  } else throw Error('Usage: package.mjs build [gomoku|holdem] | validate <package.json>')
}
