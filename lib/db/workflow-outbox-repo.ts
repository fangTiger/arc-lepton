export type WorkflowOperationType = 'ACTIVATE' | 'RUN' | 'SETTLE' | 'RECONCILE' | 'CLOSE'
export type WorkflowOperationPhase =
  | 'queued'
  | 'running'
  | 'broadcasting'
  | 'reconciling'
  | 'succeeded'
  | 'failed'
  | 'manual'

export type WorkflowOperation = {
  id: string
  operationKey: string
  type: WorkflowOperationType
  researchId: string
  escrowAddress: string | null
  phase: WorkflowOperationPhase
  payloadHash: string
  protectedPayloadDigest: string
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  fencingToken: number
  attempts: number
  nextAttemptAt: Date
  txHash: string | null
  chainId: number | null
  blockNumber: string | null
  blockHash: string | null
  logIndex: number | null
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}

export type WorkflowOperationClaimInput = {
  operationKey: string
  type: WorkflowOperationType
  researchId: string
  escrowAddress?: string | null
  phase?: WorkflowOperationPhase
  payloadHash: string
  protectedPayloadDigest: string
  protectedPayload?: string | null
  leaseOwner: string
  leaseDurationMs: number
  nextAttemptAt?: Date
}

export type WorkflowOperationClaimResult =
  | { status: 'claimed'; operation: WorkflowOperation }
  | { status: 'existing'; operation: WorkflowOperation }

export type WorkflowCheckpointPatch = {
  phase?: WorkflowOperationPhase
  payloadHash?: string
  protectedPayloadDigest?: string
}

export type WorkflowBroadcastPatch = {
  phase?: WorkflowOperationPhase
  txHash: string
  chainId: number | null
  blockNumber: string | null
  blockHash?: string | null
  logIndex?: number | null
}

export type WorkflowFailurePatch = {
  phase?: WorkflowOperationPhase
  lastError: string
  nextAttemptAt: Date
}

export type WorkflowCompletePatch = {
  phase?: Extract<WorkflowOperationPhase, 'succeeded' | 'manual'>
  blockNumber?: string | null
  blockHash?: string | null
  logIndex?: number | null
}

export type WorkflowLeaseRenewInput = {
  leaseOwner: string
  leaseDurationMs: number
}

export type WorkflowManualRecoveryPatch = {
  phase: Extract<WorkflowOperationPhase, 'queued' | 'succeeded'>
  nextAttemptAt?: Date
  lastError?: string | null
}

export type WorkflowDueQuery = {
  now?: Date
  limit?: number
}

export interface WorkflowOutboxRepo {
  claimOperation(input: WorkflowOperationClaimInput): Promise<WorkflowOperationClaimResult>
  getProtectedPayload(operationKey: string): Promise<string | null>
  renewLease(id: string, fencingToken: number, input: WorkflowLeaseRenewInput): Promise<WorkflowOperation | null>
  recordCheckpoint(id: string, fencingToken: number, patch: WorkflowCheckpointPatch): Promise<boolean>
  recordBroadcast(id: string, fencingToken: number, patch: WorkflowBroadcastPatch): Promise<boolean>
  failAndRelease(id: string, fencingToken: number, patch: WorkflowFailurePatch): Promise<boolean>
  complete(id: string, fencingToken: number, patch?: WorkflowCompletePatch): Promise<boolean>
  recoverManualOperation(operationKey: string, patch: WorkflowManualRecoveryPatch): Promise<WorkflowOperation | null>
  findByOperationKey(operationKey: string): Promise<WorkflowOperation | null>
  listDueOperations(query?: WorkflowDueQuery): Promise<WorkflowOperation[]>
  count(): Promise<number>
}

export function isTerminalWorkflowPhase(phase: WorkflowOperationPhase) {
  return phase === 'succeeded' || phase === 'manual'
}

export function normalizeWorkflowOperationKey(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('operationKey is required')
  return trimmed
}
