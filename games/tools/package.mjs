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
    pkg.packageVersion !== 1 || !m || typeof m.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(m.id)
    || typeof m.version !== 'string' || !/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(m.version)
    || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100
    || !Number.isInteger(m.minPlayers) || !Number.isInteger(m.maxPlayers) || m.minPlayers < 2
    || m.maxPlayers > 8 || m.maxPlayers < m.minPlayers
    || !Array.isArray(m.modes) || !m.modes.length
    || m.modes.some(mode => !['score', 'local-chips', 'token'].includes(mode))
    || (m.settlementPolicies !== undefined
      && (!Array.isArray(m.settlementPolicies) || !m.settlementPolicies.length
        || m.settlementPolicies.some(policy =>
          !['equal-winners-v1', 'conserved-payouts-v1'].includes(policy)
        )))
    || typeof pkg.rules !== 'string' || pkg.rules.length > 256 * 1024
    || !pkg.rules.includes('globalThis.game')
    || pkg.ui?.format !== 'scene-v1' || typeof pkg.ui.render !== 'string'
    || pkg.ui.render.length > 256 * 1024
  ) {
    throw Error('Invalid GamePackage v1')
  }
  return createHash('sha256').update(canonical(pkg)).digest('hex')
}
export async function build(name, output = join(root, 'dist')) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid source directory')
  const dir = join(root, name)
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  const license = await readFile(join(root, '../LICENSE'), 'utf8')
  const pieces = name === 'holdem' ? ['evaluate.js', 'rules.js'] : ['rules.js']
  const rules = `/*\n${license}*/\n`
    + (await Promise.all(pieces.map(file => readFile(join(dir, file), 'utf8')))).join(
      '\n',
    )
  const render = `/*\n${license}*/\n` + await readFile(join(dir, 'render.js'), 'utf8')
  const pkg = { packageVersion: 1, manifest, rules, ui: { format: 'scene-v1', render } }
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
      console.log(`${hash}  ${path} (QuickJS setup/observe/render/timeout passed)`)
    }
  } else throw Error('Usage: package.mjs build [gomoku|holdem] | validate <package.json>')
}
