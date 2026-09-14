import { sql } from 'drizzle-orm'
import { check, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
export const meta = sqliteTable('meta', { key: text().primaryKey(), value: text().notNull() })
export const accounts = sqliteTable('accounts', {
  id: text().primaryKey(),
  name: text().notNull().unique(),
  salt: text().notNull(),
  password: text().notNull(),
  economy_id: text(),
})
export const managedIdentities = sqliteTable('managed_identities', {
  issuer: text().notNull(),
  subject: text().notNull(),
  account_id: text().notNull().unique().references(() => accounts.id),
}, table => [primaryKey({ columns: [table.issuer, table.subject] })])
export const displayProfiles = sqliteTable('display_profiles', {
  account_id: text().primaryKey(),
  subject_hash: text().notNull(),
  body: text().notNull(),
})
export const sessions = sqliteTable('sessions', {
  hash: text().primaryKey(),
  account_id: text().notNull(),
  expires: integer().notNull(),
})
export const packages = sqliteTable('packages', {
  hash: text().primaryKey(),
  publisher_id: text().notNull(),
  game_id: text().notNull(),
  version: text().notNull(),
  body: text().notNull(),
}, table => [unique().on(table.publisher_id, table.game_id, table.version)])
export const rooms = sqliteTable('rooms', { id: text().primaryKey(), body: text().notNull() })
export const commands = sqliteTable('commands', {
  room_id: text().notNull(),
  account_id: text().notNull(),
  key: text().notNull(),
  digest: text().notNull(),
  response: text().notNull(),
}, table => [primaryKey({ columns: [table.room_id, table.account_id, table.key] })])
export const grants = sqliteTable('grants', {
  id: text().primaryKey(),
  hash: text().notNull().unique(),
  room_id: text().notNull(),
  match_id: text().notNull(),
  seat_id: text().notNull(),
  account_id: text().notNull(),
  expires: integer().notNull(),
  max_actions: integer().notNull(),
  used: integer().notNull().default(0),
  revoked: integer().notNull().default(0),
})
export const events = sqliteTable('events', {
  room_id: text().notNull(),
  version: integer().notNull(),
  body: text().notNull(),
}, table => [primaryKey({ columns: [table.room_id, table.version] })])
export const transactionReads = sqliteTable(
  'transaction_reads',
  { id: text().notNull(), valid: integer().notNull() },
  table => [check('read_conflict', sql`${table.valid}=1`)],
)
export const transactionWrites = sqliteTable(
  'transaction_writes',
  { id: text().notNull(), valid: integer().notNull() },
  table => [check('write_requirement', sql`${table.valid}=1`)],
)
export const rateBuckets = sqliteTable('rate_buckets', {
  key: text().primaryKey(),
  window: integer().notNull(),
  count: integer().notNull(),
})
export const managedNonces = sqliteTable('managed_nonces', {
  nonce: text().primaryKey(),
  expires: integer().notNull(),
  body: text().notNull(),
})

export const gameWalletBindings = sqliteTable('game_wallet_bindings', {
  account_id: text().primaryKey(),
  body: text().notNull(),
})
export const gameWalletChallenges = sqliteTable('game_wallet_challenges', {
  nonce: text().primaryKey(),
  account_id: text().notNull(),
  expires: integer().notNull(),
  body: text().notNull(),
})
export const gameSpendTransactions = sqliteTable('game_spend_transactions', {
  match_id: text().primaryKey(),
  room_id: text().notNull(),
  body: text().notNull(),
})

export const gameSpendParticipants = sqliteTable('game_spend_participants', {
  account_id: text().notNull(),
  match_id: text().notNull(),
}, table => [primaryKey({ columns: [table.account_id, table.match_id] })])
