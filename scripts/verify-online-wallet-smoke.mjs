import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { build } from '../games/tools/package.mjs'
import { createGameServer } from '../dist/server/http.js'
const directory = mkdtempSync(join(tmpdir(), 'online-fee-verification-')), probe = createServer()
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
const key = generateKeyPairSync('ed25519'), origin = 'http://127.0.0.1:' + port
const app = createGameServer({
  database: join(directory, 'game.sqlite'),
  tickMs: 0,
  accessPolicy: 'login-required',
  walletSpend: { origin, privateKey: key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() },
})
try {
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve))
  const packages = await Promise.all(['gomoku', 'holdem'].map(name => build(name, directory)))
  const child = spawn(process.execPath, [
    'scripts/online-wallet-spend-smoke.mjs',
    '--allow-loopback',
    origin,
    ...packages.map(pkg => pkg.path),
  ], { stdio: 'inherit' })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  assert.equal(code, 0)
  console.log(
    'PASS exact portable online smoke against isolated loopback Game and temporary SQLite wallets; no Site/Native/original ledger accessed',
  )
} finally {
  await app.close()
  rmSync(directory, { recursive: true, force: true })
}
