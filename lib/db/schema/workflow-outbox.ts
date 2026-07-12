import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { WorkflowOperationPhase, WorkflowOperationType } from '../workflow-outbox-repo'

export const workflowOutbox = pgTable(
  'workflow_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    operationKey: text('operation_key').notNull(),
    type: text('type').$type<WorkflowOperationType>().notNull(),
    researchId: text('research_id').notNull(),
    escrowAddress: text('escrow_address'),
    phase: text('phase').$type<WorkflowOperationPhase>().notNull().default('queued'),
    payloadHash: text('payload_hash').notNull(),
    protectedPayloadDigest: text('protected_payload_digest').notNull(),
    protectedPayload: text('protected_payload'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    fencingToken: integer('fencing_token').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    txHash: text('tx_hash'),
    chainId: integer('chain_id'),
    blockNumber: text('block_number'),
    blockHash: text('block_hash'),
    logIndex: integer('log_index'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflow_outbox_operation_key_uidx').on(table.operationKey),
    index('workflow_outbox_due_idx').on(table.phase, table.nextAttemptAt),
    index('workflow_outbox_research_idx').on(table.researchId),
  ],
)

export type WorkflowOutboxRow = typeof workflowOutbox.$inferSelect
export type NewWorkflowOutboxRow = typeof workflowOutbox.$inferInsert
