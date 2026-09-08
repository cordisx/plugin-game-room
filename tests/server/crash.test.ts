import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGameServer } from '../../server/http.js'
import type { ActionRequest } from '../../sdk/index.js'
test('SIGKILL discards uncommitted writes and retains acknowledged action, session and idempotency', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'game-crash-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const database = join(dir, 'state.sqlite')
  const child = fork(fileURLToPath(new URL('./crash-child.ts', import.meta.url)), [database], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  t.after(() => {
    child.kill('SIGKILL')
  })
  const [message] = await once(child, 'message', { signal: AbortSignal.timeout(15000) }) as [
    { roomId: string; accountId: string; token: string; version: number; input: ActionRequest },
  ]
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  const app = createGameServer({ database, tickMs: 0 })
  t.after(() => app.close())
  assert.equal(app.accounts.authenticate(message.token).id, message.accountId)
  const restored = app.engine.load(message.roomId)
  assert.equal(restored.version, message.version)
  assert.equal((restored.state as { n: number }).n, 1)
  const replay = await app.engine.serial(() => app.engine.action(message.accountId, message.roomId, message.input))
  assert.equal(replay.version, message.version)
  assert.equal(app.engine.load(message.roomId).version, message.version)
})
