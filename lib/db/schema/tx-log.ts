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
    settlementId: text('settlement_id'),
    requestId: text('request_id'),
    backend: text('backend'),
    version: integer('version'),
    paymentIntentId: text('payment_intent_id'),
    toolOrdinal: integer('tool_ordinal'),
    requestKey: text('request_key'),
    sourceId: text('source_id'),
    amountUnits: text('amount_units'),
    registryRevision: text('registry_revision'),
    expectedPayout: text('expected_payout'),
    maxUnitPrice: text('max_unit_price'),
    registryReadBlock: text('registry_read_block'),
    payloadHash: text('payload_hash'),
    escrowAddress: text('escrow_address'),
    researchKey: text('research_key'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tx_log_address_created_at_idx').on(table.address, table.createdAt.desc()),
    uniqueIndex('tx_log_address_request_id_uidx').on(table.address, table.requestId),
    uniqueIndex('tx_log_address_research_tool_ordinal_uidx').on(table.address, table.researchId, table.toolOrdinal),
  ],
)

export type TxLog = typeof txLog.$inferSelect
export type NewTxLog = typeof txLog.$inferInsert
