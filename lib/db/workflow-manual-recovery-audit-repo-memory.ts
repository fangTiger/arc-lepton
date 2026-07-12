import {
  createWorkflowManualRecoveryAudit,
  type WorkflowManualRecoveryAudit,
  type WorkflowManualRecoveryAuditInput,
  type WorkflowManualRecoveryAuditRepo,
} from './workflow-manual-recovery-audit-repo'
import { normalizeWorkflowOperationKey } from './workflow-outbox-repo'

export class MemoryWorkflowManualRecoveryAuditRepo implements WorkflowManualRecoveryAuditRepo {
  private records: WorkflowManualRecoveryAudit[] = []

  async record(input: WorkflowManualRecoveryAuditInput): Promise<WorkflowManualRecoveryAudit> {
    const record = createWorkflowManualRecoveryAudit({
      ...input,
      operationKey: normalizeWorkflowOperationKey(input.operationKey),
    })
    this.records.push(record)
    return this.clone(record)
  }

  async listByOperationKey(operationKey: string): Promise<WorkflowManualRecoveryAudit[]> {
    const normalized = normalizeWorkflowOperationKey(operationKey)
    return this.records
      .filter((record) => record.operationKey === normalized)
      .map((record) => this.clone(record))
  }

  private clone(record: WorkflowManualRecoveryAudit): WorkflowManualRecoveryAudit {
    return { ...record, createdAt: new Date(record.createdAt) }
  }
}
