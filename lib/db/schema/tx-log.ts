import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const txLog = pgTable(
  'tx_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    address: text('address').notNull(),
    source: text('source').notNull(),
    amount: numeric('amount', { precision: 18, scale: 8 }).notNull(),
    researchId: text('research_id'),
    txHash: text('tx_hash'),
    txStatus: text('tx_status').notNull().default('mock'),
    chainId: integer('chain_id'),
    blockNumber: text('block_number'),
    requestId: text('request_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tx_log_address_created_at_idx').on(table.address, table.createdAt.desc()),
    uniqueIndex('tx_log_address_request_id_uidx').on(table.address, table.requestId),
  ],
)

export type TxLog = typeof txLog.$inferSelect
export type NewTxLog = typeof txLog.$inferInsert
