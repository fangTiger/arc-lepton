import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const research = pgTable(
  'research',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    address: text('address').notNull(),
    prepareRequestId: text('prepare_request_id'),
    buyer: text('buyer'),
    topic: text('topic').notNull(),
    budgetUsdc: numeric('budget_usdc', { precision: 18, scale: 8 }).notNull(),
    budgetUnits: text('budget_units'),
    spentUsdc: numeric('spent_usdc', { precision: 18, scale: 8 }).notNull().default('0'),
    status: text('status', { enum: ['funding', 'funding_expired', 'running', 'completed', 'failed', 'cancelled'] })
      .notNull()
      .default('running'),
    activationPhase: text('activation_phase', { enum: ['none', 'funded', 'activating', 'active', 'expired', 'cancelled'] })
      .notNull()
      .default('active'),
    finalizationState: text('finalization_state', { enum: ['none', 'open', 'closing', 'closed', 'manual'] })
      .notNull()
      .default('open'),
    quotaReservationState: text('quota_reservation_state', { enum: ['none', 'reserved', 'activating', 'consumed', 'released'] })
      .notNull()
      .default('consumed'),
    researchKey: text('research_key'),
    expectedEscrowAddress: text('expected_escrow_address'),
    escrowAddress: text('escrow_address'),
    reportMd: text('report_md'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    fundingExpiresAt: timestamp('funding_expires_at', { withTimezone: true }),
    expectedExpiresAt: timestamp('expected_expires_at', { withTimezone: true }),
    fundingDeadline: timestamp('funding_deadline', { withTimezone: true }),
    intentSigner: text('intent_signer'),
    voucherNonce: text('voucher_nonce'),
    quotaDate: text('quota_date'),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    chainId: integer('chain_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('research_address_created_at_id_idx').on(table.address, table.createdAt.desc(), table.id.desc())],
)

export type ResearchRow = typeof research.$inferSelect
export type NewResearch = typeof research.$inferInsert
