import { randomUUID } from 'node:crypto'

export type WorkflowManualRecoveryAction = 'requeue' | 'mark_closed'

export type WorkflowManualRecoveryAudit = {
  id: string
  operationKey: string
  action: WorkflowManualRecoveryAction
  operator: string
  reason: string
  evidenceDigest: string
  previousPhase: string
  nextPhase: string
  createdAt: Date
}

export type WorkflowManualRecoveryAuditInput = Omit<WorkflowManualRecoveryAudit, 'id'>

export interface WorkflowManualRecoveryAuditRepo {
  record(input: WorkflowManualRecoveryAuditInput): Promise<WorkflowManualRecoveryAudit>
  listByOperationKey(operationKey: string): Promise<WorkflowManualRecoveryAudit[]>
}

export function createWorkflowManualRecoveryAudit(input: WorkflowManualRecoveryAuditInput): WorkflowManualRecoveryAudit {
  return {
    id: randomUUID(),
    ...input,
    createdAt: new Date(input.createdAt),
  }
}
