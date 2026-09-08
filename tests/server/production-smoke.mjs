import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const staging = mkdtempSync(join(tmpdir(), 'game-production-'))
let child
try {
  for (const path of ['package.json', 'package-lock.json']) cpSync(resolve(path), join(staging, path))
  mkdirSync(join(staging, 'dist'))
  for (const path of ['server', 'sdk']) cpSync(resolve('dist', path), join(staging, 'dist', path), { recursive: true })
  const install = spawnSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: staging, encoding: 'utf8' })
  assert.equal(install.status, 0, install.stderr)
  const { invoke } = await import(pathToFileURL(join(staging, 'dist/server/runner.js')).href)
  const result = await invoke({
    rules: 'globalThis.game={setup(ctx){return {random:ctx.random(),network:typeof fetch}}}',
    method: 'setup',
    args: [],
    seed: 'smoke',
    cursor: 0,
    ctx: { seats: ['one', 'two'], config: {}, seatIndex: null, mode: 'score', stake: 0, policy: 'equal-winners-v1' },
  })
  assert.equal(result.value.network, 'undefined')
  assert.equal(result.cursor, 1)
  child = spawn(process.execPath, ['dist/server/main.js'], {
    cwd: staging,
    env: {
      ...process.env,
      PORT: '0',
      BIND_HOST: '127.0.0.1',
      DATABASE_PATH: join(staging, 'data.sqlite'),
      ECONOMY_URL: '',
      ECONOMY_SERVICE_ID: '',
      ECONOMY_SERVICE_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const address = await new Promise((resolveAddress, reject) => {
    const timer = setTimeout(() => reject(new Error('entrypoint startup timeout')), 10000)
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`entrypoint exited: ${code}`))
    })
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      const match = output.match(/listening on (\{[^\n]+\})/)
      if (match) {
        clearTimeout(timer)
        resolveAddress(JSON.parse(match[1]))
      }
    })
  })
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/handshake`)
  const handshake = await response.json()
  assert.equal(handshake.protocol, 'game-room/1')
  assert.equal(handshake.economyAvailable, false)
  const stopped = once(child, 'exit')
  child.kill('SIGTERM')
  await stopped
  console.log('Production dependency install, compiled WASM worker, main entrypoint and graceful shutdown passed')
} finally {
  if (child && child.exitCode === null) child.kill('SIGKILL')
  rmSync(staging, { recursive: true, force: true })
}
