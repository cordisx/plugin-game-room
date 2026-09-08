import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export class Store {
  readonly db: DatabaseSync
  readonly serverId: string
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, economy_id TEXT);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS packages (hash TEXT PRIMARY KEY, publisher_id TEXT NOT NULL, game_id TEXT NOT NULL, version TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(publisher_id,game_id,version));
      CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (room_id TEXT NOT NULL, account_id TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(room_id,account_id,key));
      CREATE TABLE IF NOT EXISTS events (room_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(room_id,version));
    `)
    this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('serverId', randomUUID())
    this.serverId = (this.db.prepare('SELECT value FROM meta WHERE key=?').get('serverId') as { value: string }).value
  }
  id(kind: string) {
    return `${this.serverId}:${kind}:${randomUUID()}`
  }
  atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = fn()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  close() {
    this.db.close()
  }
}
