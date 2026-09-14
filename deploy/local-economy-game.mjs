import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const [statePath, gameDatabase, rawPort, optIn] = process.argv.slice(2)
assert.equal(optIn, '--local-test-only')
const state = JSON.parse(readFileSync(join(resolve(statePath), 'operator-private.json'), 'utf8'))
assert.equal(state.testOnly, true)
const url = new URL(state.url)
assert.equal(url.protocol, 'http:')
assert.equal(url.hostname, '127.0.0.1')
assert(existsSync(gameDatabase), 'Keep the existing game database')
assert(Number.isSafeInteger(Number(rawPort)) && Number(rawPort) >= 1024 && Number(rawPort) <= 65535)
process.env.ECONOMY_URL = state.url
process.env.ECONOMY_SERVICE_ID = state.gameServiceId
process.env.ECONOMY_SERVICE_TOKEN = state.gameServiceToken
process.env.DATABASE_PATH = resolve(gameDatabase)
process.env.PORT = rawPort
process.env.BIND_HOST = '127.0.0.1'
await import(pathToFileURL(resolve(import.meta.dirname, '../server/main.ts')).href)
