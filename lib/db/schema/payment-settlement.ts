import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const paymentSettlement = pgTable(
  'payment_settlement',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    address: text('address').notNull(),
    researchId: text('research_id').notNull(),
    requestIds: jsonb('request_ids').$type<string[]>().notNull(),
    totalAmount: numeric('total_amount', { precision: 18, scale: 8 }).notNull(),
    status: text('status').notNull().default('broadcasting'),
    txHash: text('tx_hash'),
    chainId: integer('chain_id'),
    blockNumber: text('block_number'),
    attempts: integer('attempts').notNull().default(1),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payment_settlement_address_research_uidx').on(table.address, table.researchId),
    index('payment_settlement_status_updated_at_idx').on(table.status, table.updatedAt),
  ],
)

export type PaymentSettlementRow = typeof paymentSettlement.$inferSelect
export type NewPaymentSettlementRow = typeof paymentSettlement.$inferInsert
