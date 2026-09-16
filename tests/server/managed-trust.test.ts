import assert from 'node:assert/strict'
import test from 'node:test'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadManagedAccountTrust } from '../../server/managed-trust.js'
await test('provisioned private server input rejects public permissions, links and unknown fields', t => {
  const directory = mkdtempSync(join(tmpdir(), 'managed-private-input-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'managed-source-server.json')
  const input = {
    binding: { origin: 'http://127.0.0.1:58973', sourceId: 'server', instanceId: 'server', audience: 'source-account' },
    hostPublicKey: 'fixture-public',
    serverPrivateKey: 'fixture-private',
  }
  writeFileSync(path, JSON.stringify(input), { mode: 0o600 })
  assert.deepEqual(loadManagedAccountTrust(path), input)
  chmodSync(path, 0o644)
  assert.throws(() => loadManagedAccountTrust(path))
  chmodSync(path, 0o600)
  const link = join(directory, 'alias.json')
  symlinkSync(path, link)
  assert.throws(() => loadManagedAccountTrust(link))
  writeFileSync(path, JSON.stringify({ ...input, accountId: 'unverified' }))
  assert.throws(() => loadManagedAccountTrust(path))
  writeFileSync(path, JSON.stringify({ ...input, binding: { ...input.binding, accountId: 'unverified' } }))
  assert.throws(() => loadManagedAccountTrust(path))
  writeFileSync(path, JSON.stringify({ ...input, binding: { ...input.binding, audience: 'work-income' } }))
  assert.throws(() => loadManagedAccountTrust(path))
})
