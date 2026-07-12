import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import { asc, eq } from 'drizzle-orm'
import * as schema from './schema'
import { workflowManualRecoveryAudit } from './schema/workflow-manual-recovery-audit'
import {
  createWorkflowManualRecoveryAudit,
  type WorkflowManualRecoveryAudit,
  type WorkflowManualRecoveryAuditInput,
  type WorkflowManualRecoveryAuditRepo,
} from './workflow-manual-recovery-audit-repo'
import { normalizeWorkflowOperationKey } from './workflow-outbox-repo'

type DbClient = VercelPgDatabase<typeof schema>

export class PgWorkflowManualRecoveryAuditRepo implements WorkflowManualRecoveryAuditRepo {
  constructor(private readonly database: DbClient) {}

  async record(input: WorkflowManualRecoveryAuditInput): Promise<WorkflowManualRecoveryAudit> {
    const record = createWorkflowManualRecoveryAudit({
      ...input,
      operationKey: normalizeWorkflowOperationKey(input.operationKey),
    })
    await this.database.insert(workflowManualRecoveryAudit).values(record)
    return record
  }

  async listByOperationKey(operationKey: string): Promise<WorkflowManualRecoveryAudit[]> {
    const rows = await this.database
      .select()
      .from(workflowManualRecoveryAudit)
      .where(eq(workflowManualRecoveryAudit.operationKey, normalizeWorkflowOperationKey(operationKey)))
      .orderBy(asc(workflowManualRecoveryAudit.createdAt))
    return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }))
  }
}
