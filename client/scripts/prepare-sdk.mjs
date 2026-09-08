/** Delegate exact-source packaging to the maintained Host recipe; no consumer-side Git prepare. */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const hostSha = 'be2403c70664ff6624671224a405e409874d59c7'
const protocolSha = '465c444c65eec1be8e337b94c2cf658ed536f49c'
const expected = {
  'cordisx-0.1.0-beta.2.tgz': 'abd300ccade96d095563f95f971164838237a376655a55b7f96bdccb3bf2dd46',
  'cordisx-protocol-0.1.0-alpha.0.tgz': '9576e28592b44c589aa847f3e57c02db1731a664c5cfa5a0f1fd5c4b5a3e21c8',
}
const cache = join(root, '.cache')
const output = join(cache, 'sdk')
const source = join(cache, `cordisx-source-${hostSha.slice(0, 12)}`)
const build = join(cache, `sdk-build-${hostSha.slice(0, 12)}-${randomUUID()}`)
mkdirSync(output, { recursive: true })
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim()
if (!existsSync(source)) {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', 'https://github.com/cordisx/cordisx.git', source], root)
}
run('git', ['fetch', 'origin', hostSha], source)
run('git', ['checkout', '--detach', hostSha], source)
if (git(['rev-parse', 'HEAD']) !== hostSha || git(['status', '--porcelain', '--untracked-files=no'])) {
  throw new Error('SDK source must be the exact clean Host commit')
}
// The Host builder requires a nonexistent absolute output directory and archives HEAD.
// It owns complete Channel/Proxy builds and executable modes; do not run npm ci first.
run(process.execPath, ['scripts/prepare-sdk.mjs', build], source)
const evidence = JSON.parse(readFileSync(join(build, 'sdk-evidence.json'), 'utf8'))
if (
  evidence.hostCommit !== hostSha
  || !evidence.sources.some(input =>
    input.location === 'node_modules/@cordisx/protocol' && input.spec.endsWith(`#${protocolSha}`)
  )
) {
  throw new Error('SDK build evidence does not match the pinned inputs')
}
for (const [filename, hash] of Object.entries(expected)) {
  const actual = createHash('sha256').update(readFileSync(join(build, 'packages', filename))).digest('hex')
  if (actual !== hash || evidence.packages.find(item => item.filename === filename)?.sha256 !== actual) {
    throw new Error(`SDK archive mismatch for ${filename}: ${actual}; expected ${hash}`)
  }
}
const filename = `cordisx-${hostSha.slice(0, 12)}.tgz`
copyFileSync(join(build, 'packages/cordisx-0.1.0-beta.2.tgz'), join(output, filename))
writeFileSync(join(output, 'sdk-evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
console.info(`SDK ready: Host ${hostSha}, Protocol ${protocolSha}, ${filename}`)
