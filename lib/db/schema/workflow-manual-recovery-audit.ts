import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const workflowManualRecoveryAudit = pgTable('workflow_manual_recovery_audit', {
  id: text('id').primaryKey(),
  operationKey: text('operation_key').notNull(),
  action: text('action', { enum: ['requeue', 'mark_closed'] }).notNull(),
  operator: text('operator').notNull(),
  reason: text('reason').notNull(),
  evidenceDigest: text('evidence_digest').notNull(),
  previousPhase: text('previous_phase').notNull(),
  nextPhase: text('next_phase').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

export type WorkflowManualRecoveryAuditRow = typeof workflowManualRecoveryAudit.$inferSelect
export type NewWorkflowManualRecoveryAuditRow = typeof workflowManualRecoveryAudit.$inferInsert
