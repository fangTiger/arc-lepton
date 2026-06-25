import { index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const txLog = pgTable(
  'tx_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    address: text('address').notNull(),
    source: text('source').notNull(),
    amount: numeric('amount', { precision: 18, scale: 8 }).notNull(),
    txHash: text('tx_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('tx_log_address_created_at_idx').on(table.address, table.createdAt.desc())],
)

export type TxLog = typeof txLog.$inferSelect
export type NewTxLog = typeof txLog.$inferInsert
