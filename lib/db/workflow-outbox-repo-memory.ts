import { randomUUID } from 'node:crypto'
import type {
  WorkflowBroadcastPatch,
  WorkflowCheckpointPatch,
  WorkflowCompletePatch,
  WorkflowDueQuery,
  WorkflowFailurePatch,
  WorkflowLeaseRenewInput,
  WorkflowManualRecoveryPatch,
  WorkflowOperation,
  WorkflowOperationClaimInput,
  WorkflowOperationClaimResult,
  WorkflowOutboxRepo,
} from './workflow-outbox-repo'
import { isTerminalWorkflowPhase, normalizeWorkflowOperationKey } from './workflow-outbox-repo'

export class MemoryWorkflowOutboxRepo implements WorkflowOutboxRepo {
  private operations = new Map<string, WorkflowOperation>()
  private operationKeyIndex = new Map<string, string>()
  private protectedPayloads = new Map<string, string>()

  private clone(operation: WorkflowOperation): WorkflowOperation {
    return {
      ...operation,
      leaseExpiresAt: operation.leaseExpiresAt ? new Date(operation.leaseExpiresAt) : null,
      nextAttemptAt: new Date(operation.nextAttemptAt),
      createdAt: new Date(operation.createdAt),
      updatedAt: new Date(operation.updatedAt),
    }
  }

  async claimOperation(input: WorkflowOperationClaimInput): Promise<WorkflowOperationClaimResult> {
    const operationKey = normalizeWorkflowOperationKey(input.operationKey)
    const now = new Date()
    const existing = this.operationForKey(operationKey)
    if (existing) {
      if (isTerminalWorkflowPhase(existing.phase) || !this.canClaim(existing, now)) {
        return { status: 'existing', operation: this.clone(existing) }
      }

      const reclaimed: WorkflowOperation = {
        ...existing,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
        fencingToken: existing.fencingToken + 1,
        attempts: existing.attempts + 1,
        lastError: null,
        updatedAt: now,
      }
      this.operations.set(reclaimed.id, reclaimed)
      return { status: 'claimed', operation: this.clone(reclaimed) }
    }

    const operation: WorkflowOperation = {
      id: randomUUID(),
      operationKey,
      type: input.type,
      researchId: input.researchId,
      escrowAddress: input.escrowAddress ?? null,
      phase: input.phase ?? 'queued',
      payloadHash: input.payloadHash,
      protectedPayloadDigest: input.protectedPayloadDigest,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
      fencingToken: 1,
      attempts: 1,
      nextAttemptAt: input.nextAttemptAt ? new Date(input.nextAttemptAt) : now,
      txHash: null,
      chainId: null,
      blockNumber: null,
      blockHash: null,
      logIndex: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }
    this.operations.set(operation.id, operation)
    this.operationKeyIndex.set(operationKey, operation.id)
    if (input.protectedPayload) {
      this.protectedPayloads.set(operationKey, input.protectedPayload)
    }
    return { status: 'claimed', operation: this.clone(operation) }
  }

  async getProtectedPayload(operationKey: string): Promise<string | null> {
    return this.protectedPayloads.get(normalizeWorkflowOperationKey(operationKey)) ?? null
  }

  async renewLease(
    id: string,
    fencingToken: number,
    input: WorkflowLeaseRenewInput,
  ): Promise<WorkflowOperation | null> {
    const existing = this.operations.get(id)
    const now = new Date()
    if (!existing || !this.canMutate(existing, fencingToken, now)) return null
    if (existing.leaseOwner !== input.leaseOwner) return null

    const renewed: WorkflowOperation = {
      ...existing,
      leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
      updatedAt: now,
    }
    this.operations.set(id, renewed)
    return this.clone(renewed)
  }

  async recordCheckpoint(id: string, fencingToken: number, patch: WorkflowCheckpointPatch): Promise<boolean> {
    const existing = this.operations.get(id)
    if (!existing || !this.canMutate(existing, fencingToken, new Date())) return false

    this.operations.set(id, {
      ...existing,
      phase: patch.phase ?? existing.phase,
      payloadHash: patch.payloadHash ?? existing.payloadHash,
      protectedPayloadDigest: patch.protectedPayloadDigest ?? existing.protectedPayloadDigest,
      updatedAt: new Date(),
    })
    return true
  }

  async recordBroadcast(id: string, fencingToken: number, patch: WorkflowBroadcastPatch): Promise<boolean> {
    const existing = this.operations.get(id)
    if (!existing || !this.canMutate(existing, fencingToken, new Date())) return false

    this.operations.set(id, {
      ...existing,
      phase: patch.phase ?? 'broadcasting',
      txHash: patch.txHash,
      chainId: patch.chainId,
      blockNumber: patch.blockNumber,
      blockHash: patch.blockHash ?? existing.blockHash,
      logIndex: patch.logIndex ?? existing.logIndex,
      updatedAt: new Date(),
    })
    return true
  }

  async failAndRelease(id: string, fencingToken: number, patch: WorkflowFailurePatch): Promise<boolean> {
    const existing = this.operations.get(id)
    if (!existing || !this.canMutate(existing, fencingToken, new Date())) return false

    this.operations.set(id, {
      ...existing,
      phase: patch.phase ?? 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: patch.lastError,
      nextAttemptAt: new Date(patch.nextAttemptAt),
      updatedAt: new Date(),
    })
    return true
  }

  async complete(id: string, fencingToken: number, patch: WorkflowCompletePatch = {}): Promise<boolean> {
    const existing = this.operations.get(id)
    if (!existing || !this.canMutate(existing, fencingToken, new Date())) return false

    this.operations.set(id, {
      ...existing,
      phase: patch.phase ?? 'succeeded',
      leaseOwner: null,
      leaseExpiresAt: null,
      blockNumber: patch.blockNumber !== undefined ? patch.blockNumber : existing.blockNumber,
      blockHash: patch.blockHash !== undefined ? patch.blockHash : existing.blockHash,
      logIndex: patch.logIndex !== undefined ? patch.logIndex : existing.logIndex,
      updatedAt: new Date(),
    })
    return true
  }

  async recoverManualOperation(operationKey: string, patch: WorkflowManualRecoveryPatch): Promise<WorkflowOperation | null> {
    const existing = this.operationForKey(normalizeWorkflowOperationKey(operationKey))
    if (!existing || existing.phase !== 'manual') return null
    const recovered: WorkflowOperation = {
      ...existing,
      phase: patch.phase,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: patch.nextAttemptAt ? new Date(patch.nextAttemptAt) : existing.nextAttemptAt,
      lastError: patch.lastError !== undefined ? patch.lastError : existing.lastError,
      updatedAt: new Date(),
    }
    this.operations.set(recovered.id, recovered)
    return this.clone(recovered)
  }

  async findByOperationKey(operationKey: string): Promise<WorkflowOperation | null> {
    const operation = this.operationForKey(normalizeWorkflowOperationKey(operationKey))
    return operation ? this.clone(operation) : null
  }

  async listDueOperations(query: WorkflowDueQuery = {}): Promise<WorkflowOperation[]> {
    const now = query.now ?? new Date()
    const limit = query.limit ?? 50
    return [...this.operations.values()]
      .filter((operation) => !isTerminalWorkflowPhase(operation.phase))
      .filter((operation) => operation.nextAttemptAt <= now)
      .filter((operation) => !operation.leaseExpiresAt || operation.leaseExpiresAt <= now)
      .sort((a, b) => {
        const timeDiff = a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime()
        if (timeDiff !== 0) return timeDiff
        return a.operationKey.localeCompare(b.operationKey)
      })
      .slice(0, limit)
      .map((operation) => this.clone(operation))
  }

  async count(): Promise<number> {
    return this.operations.size
  }

  private operationForKey(operationKey: string) {
    const id = this.operationKeyIndex.get(operationKey)
    return id ? this.operations.get(id) ?? null : null
  }

  private canClaim(operation: WorkflowOperation, now: Date) {
    if (operation.nextAttemptAt > now) return false
    return !operation.leaseExpiresAt || operation.leaseExpiresAt <= now
  }

  private canMutate(operation: WorkflowOperation, fencingToken: number, now: Date) {
    if (operation.fencingToken !== fencingToken || isTerminalWorkflowPhase(operation.phase)) return false
    return Boolean(operation.leaseExpiresAt && operation.leaseExpiresAt > now)
  }
}
