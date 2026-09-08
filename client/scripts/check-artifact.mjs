import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const root = new URL('../dist/runtime/', import.meta.url)
const artifact = JSON.parse(readFileSync(new URL('artifact.json', root), 'utf8'))
assert.equal(artifact.contract, 'cordisx.plugin-generation-artifact/v1')
assert.equal(artifact.format, 'browser-esm-graph')
assert.deepEqual(artifact.initialStyles, [])
const indexed = new Map(artifact.files.map(file => [file.path, file]))
assert(indexed.has(artifact.entry))
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
console.info(`Verified ${indexed.size} indexed runtime files and complete lazy CSS graph.`)
