import assert from 'node:assert/strict'
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'

process.umask(0o077)
const directory = resolve(process.argv[2] ?? '.data/live-preview')
const config = JSON.parse(readFileSync(join(directory, 'launch-config.json'), 'utf8'))
assert.equal(config.bindHost, '127.0.0.1', 'The demo must bind loopback only')
assert(Number.isSafeInteger(config.port) && config.port >= 1024 && config.port <= 65535)
assert.equal(config.mode, 'score-only')
assert.equal(config.economyConnected, false)
assert(Array.isArray(config.allowedOrigins) && config.allowedOrigins.every(origin => typeof origin === 'string'))
const occupied = await new Promise(resolveOccupied => {
  const socket = createConnection({ host: config.bindHost, port: config.port })
  socket.once('connect', () => {
    socket.destroy()
    resolveOccupied(true)
  })
  socket.once('error', () => resolveOccupied(false))
  socket.setTimeout(1000, () => {
    socket.destroy()
    resolveOccupied(true)
  })
})
if (occupied) throw Error('Preview port is occupied; inspect the existing listener instead of replacing it')
const log = openSync(join(directory, 'server.log'), 'a', 0o600)
const child = spawn(process.execPath, [join(directory, 'runtime/dist/server/main.js')], {
  cwd: directory,
  detached: true,
  stdio: ['ignore', log, log],
  env: {
    ...process.env,
    PORT: String(config.port),
    BIND_HOST: config.bindHost,
    DATABASE_PATH: join(directory, 'demo.sqlite'),
    ALLOWED_ORIGINS: config.allowedOrigins.join(','),
    ECONOMY_URL: '',
    ECONOMY_SERVICE_ID: '',
    ECONOMY_SERVICE_TOKEN: '',
  },
})
writeFileSync(join(directory, 'server.pid'), String(child.pid) + '\n', { mode: 0o600 })
child.unref()
closeSync(log)
console.log(
  JSON.stringify({
    pid: child.pid,
    url: `http://${config.bindHost}:${config.port}`,
    healthPath: '/health',
    database: join(directory, 'demo.sqlite'),
  }),
)
