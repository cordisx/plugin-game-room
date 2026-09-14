import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { build, canonical } from './package.mjs'
// Explicit developer operation for the two user-authorized local examples only.
// Publishing/importing a package never invokes this or grants execution trust.
const target = new URL('../../client/src/data/local-html-digests.json', import.meta.url)
// Retain already authorized local bundles so pinned active rooms remain playable.
const digests = JSON.parse(await readFile(target, 'utf8'))
for (const game of ['gomoku', 'holdem']) {
  const { pkg } = await build(game)
  digests.push(createHash('sha256').update(canonical(pkg.ui)).digest('hex'))
}
await writeFile(
  new URL('../../client/src/data/local-html-digests.json', import.meta.url),
  `${JSON.stringify([...new Set(digests)], null, 2)}\n`,
)
