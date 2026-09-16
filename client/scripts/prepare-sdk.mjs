/** Verify the owner-built SDK artifacts used by the client and backend. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const directory = fileURLToPath(new URL('../../sdk/release/', import.meta.url))
const evidence = JSON.parse(readFileSync(join(directory, 'sdk-evidence.json'), 'utf8'))
if (!/^[a-f0-9]{40}$/.test(evidence.hostCommit)) throw new Error('Missing exact Host source')
for (const pkg of evidence.packages) {
  const bytes = readFileSync(join(directory, pkg.filename))
  if (
    createHash('sha256').update(bytes).digest('hex') !== pkg.sha256
    || 'sha512-' + createHash('sha512').update(bytes).digest('base64') !== pkg.integrity
  ) throw new Error('SDK digest mismatch: ' + pkg.filename)
}
console.info('Owner-built SDK digests verified.')
