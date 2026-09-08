import { harness } from './helpers.js'
const h = await harness({ database: process.argv[2] })
const room = await h.room()
await h.app.engine.serial(() =>
  h.app.engine.action(h.alice.account.id, room.id, {
    expectedVersion: room.version,
    idempotencyKey: 'durable-action',
    action: { type: 'move' },
  })
)
const committed = h.app.engine.load(room.id)
// Simulate abrupt termination after a durable action and during a subsequent
// uncommitted writer transaction. SQLite must retain only the acknowledged state.
h.app.store.db.exec('BEGIN IMMEDIATE')
h.app.store.db.prepare('UPDATE rooms SET body=? WHERE id=?').run('{}', room.id)
process.send!({
  roomId: room.id,
  accountId: h.alice.account.id,
  token: h.alice.token,
  version: committed.version,
  input: { expectedVersion: room.version, idempotencyKey: 'durable-action', action: { type: 'move' } },
})
setInterval(() => {}, 1000)
