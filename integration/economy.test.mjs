import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Exercise current pooled wallets, not the retired remote-ledger fee routes.
// Verify the installed SDK is the actual built owner checkout before using it.
const installed = resolve(fileURLToPath(import.meta.resolve('@cordisx/economy/server')), '../../..')
const owner = process.env.ECONOMY_REPOSITORY
assert.ok(owner, 'Set ECONOMY_REPOSITORY to the built economy checkout')
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex')

test('canonical economy package and real HTTP game pool integration', () => {
  for (const file of readdirSync(join(owner, 'dist'), { recursive: true }).filter(file => file.endsWith('.js'))) {
    assert.equal(digest(join(installed, 'dist', file)), digest(join(owner, 'dist', file)), file)
  }
  const environment = { ...process.env }
  delete environment.NODE_TEST_CONTEXT
  execFileSync(process.execPath, ['--import', 'tsx', '--test', 'tests/server/economy.test.ts'], {
    cwd: resolve(import.meta.dirname, '..'),
    stdio: 'inherit',
    env: environment,
  })
})
