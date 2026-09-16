/** Builds a reviewable experimental client without changing this checkout or its node_modules. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
const [hostInput, protocolInput, outputInput, existingSdk] = process.argv.slice(2)
if (!hostInput || !protocolInput || !outputInput) {
  throw new Error(
    'Usage: node scripts/prepare-schema-candidate.mjs <Host source> <Protocol source> <new output> [prepared SDK]',
  )
}
const host = path.resolve(hostInput)
const protocol = path.resolve(protocolInput)
const output = path.resolve(outputInput)
const repository = fileURLToPath(new URL('../../', import.meta.url))
const { snapshotSource } = await import(pathToFileURL(path.join(host, 'scripts/sdk-source-snapshot.mjs')).href)
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' })
await mkdir(output)
const sdk = existingSdk ? path.resolve(existingSdk) : path.join(output, 'sdk')
if (!existingSdk) {
  run(process.execPath, [path.join(host, 'scripts/prepare-sdk.mjs'), sdk, '--experimental-protocol', protocol], host)
}
const evidence = JSON.parse(await readFile(path.join(sdk, 'sdk-evidence.json'), 'utf8'))
if (!evidence.experimentalInputs?.protocol) {
  throw new Error('Expected explicit experimental Host and Protocol provenance')
}
const game = path.join(output, 'game-room')
const source = await snapshotSource(repository, game)
const client = path.join(game, 'client')
const packages = path.join(client, 'sdk/experimental')
await mkdir(packages, { recursive: true })
await copyFile(path.join(sdk, 'sdk-evidence.json'), path.join(packages, 'sdk-evidence.json'))
const { createHash } = await import('node:crypto')
for (const record of evidence.packages) {
  const archive = path.join(sdk, 'packages', record.filename)
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex')
  if (hash !== record.sha256) throw new Error(`Archive mismatch: ${record.filename}`)
  await copyFile(archive, path.join(packages, record.filename))
}
const manifestFile = path.join(client, 'package.json')
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
const find = prefix => evidence.packages.find(item => item.filename.startsWith(prefix))?.filename
const hostArchive = find('cordisx-0.')
const protocolArchive = find('cordisx-protocol-')
if (!hostArchive || !protocolArchive) throw new Error('SDK omitted required public packages')
manifest.devDependencies.cordisx = `file:sdk/experimental/${hostArchive}`
manifest.devDependencies['@cordisx/protocol'] = `file:sdk/experimental/${protocolArchive}`
manifest.overrides = { ...manifest.overrides, '@cordisx/protocol': '$@cordisx/protocol' }
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
// Local SDK archives keep versions across experimental source snapshots.
// Invalidate exact lock entries so npm cannot reuse a prior cached archive.
const lockFile = path.join(client, 'package-lock.json')
const lock = JSON.parse(await readFile(lockFile, 'utf8'))
for (const [name, record] of Object.entries(lock.packages)) {
  if (record.resolved?.startsWith('file:sdk/experimental/')) delete lock.packages[name]
}
await writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n')
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--allow-git=all', '--no-audit', '--no-fund'], client)
const resolvedLock = JSON.parse(await readFile(lockFile, 'utf8'))
for (const name of ['cordisx', '@cordisx/protocol']) {
  const archive = name === 'cordisx' ? hostArchive : protocolArchive
  const record = evidence.packages.find(record => record.filename === archive)
  if (resolvedLock.packages[`node_modules/${name}`]?.integrity !== record.integrity) {
    throw new Error(`Lockfile retained a stale SDK archive: ${name}`)
  }
}
run('npm', ['ci', '--ignore-scripts', '--allow-git=all', '--no-audit', '--no-fund'], client)
run('npm', ['run', 'typecheck'], client)
run('npm', ['run', 'build'], client)
run('npm', ['run', 'check:artifact'], client)
await writeFile(
  path.join(output, 'candidate-evidence.json'),
  JSON.stringify(
    {
      experimental: true,
      source,
      sdk: evidence,
      clientLockSha256: createHash('sha256').update(await readFile(path.join(client, 'package-lock.json'))).digest(
        'hex',
      ),
      checks: ['npm ci (fresh)', 'typecheck', 'build', 'check:artifact'],
    },
    null,
    2,
  ) + '\n',
)
console.info(`Experimental candidate ready at ${client}; shared checkout and installations unchanged.`)
