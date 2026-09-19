import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
const root = new URL('../dist/runtime/', import.meta.url)
const artifact = JSON.parse(readFileSync(new URL('artifact.json', root), 'utf8'))
assert.equal(artifact.contract, 'cordisx.plugin-generation-artifact/v1')
assert.equal(artifact.format, 'browser-esm-graph')
assert.deepEqual(artifact.initialStyles, [])
const indexed = new Map(artifact.files.map(file => [file.path, file]))
assert(indexed.has(artifact.entry))
const brandPng = readFileSync(new URL('../assets/icon.png', import.meta.url))
assert(
  readFileSync(new URL(artifact.entry, root), 'utf8').includes(brandPng.toString('base64')),
  'production entry must embed the owned brand PNG for Host plugin metadata',
)
let lazy = 0
let styles = 0
for (const file of artifact.files) {
  assert(file.path.startsWith('./') && !file.path.split('/').includes('..'))
  const bytes = readFileSync(new URL(file.path, root))
  assert.equal(bytes.byteLength, file.byteLength)
  assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, file.digest)
  for (
    const target of [...file.imports ?? [], ...file.dynamicImports ?? [], ...file.styles ?? [], ...file.assets ?? []]
  ) assert(indexed.has(target), `unindexed dependency ${target}`)
  lazy += file.dynamicImports?.length ?? 0
  styles += file.kind === 'stylesheet' ? 1 : 0
}
assert(lazy > 0 && styles > 0, 'formal artifact must retain the lazy page and stylesheet graph')
assert(
  artifact.sharedImports.every(name =>
    ['cordisx/contracts', 'cordisx/react', 'cordisx/react/jsx-runtime', 'cordisx/react/jsx-dev-runtime', 'cordisx/ui']
      .includes(name)
  ),
)
const source = new URL('../src/', import.meta.url)
function verifyResource(relative) {
  const url = new URL(relative, root)
  for (const entry of readdirSync(url, { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`
    if (entry.isDirectory()) verifyResource(path)
    else {
      assert.deepEqual(readFileSync(new URL(path, root)), readFileSync(new URL(path, source)))
      assert(!indexed.has(`./${path}`), 'Skill documentation must remain outside the browser runtime graph')
    }
  }
}
verifyResource('skills')
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  cwd: new URL('../', import.meta.url),
  encoding: 'utf8',
}))
const packageFiles = new Set(packed.files.map(file => file.path))
assert(packageFiles.has('assets/icon.png'), 'package must retain the original brand PNG')
for (const file of artifact.files) {
  assert(packageFiles.has(`dist/runtime/${file.path.slice(2)}`), `unpacked runtime file ${file.path}`)
}
console.info(`Verified ${indexed.size} indexed runtime files and complete lazy CSS graph.`)
