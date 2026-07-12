import { createHash } from 'node:crypto'
import { itemsHash as deriveItemsHash, settlementKey, type CanonicalSettlementItem } from '@/lib/chain/canonical'
import type { ResearchRepo } from '@/lib/db/research-repo'
import type { TxLogEntry, TxLogRepo, TxLogScopedEntry } from '@/lib/db/tx-log-repo'
import type { WorkflowOperation, WorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo'

export type SettlementRecoveryEvidence = {
  status: 'processed'
  txHash: string
  chainId: number | null
  blockNumber: string
  blockHash?: string | null
  logIndex?: number | null
  settlementKey: string
  itemsHash: string
  total: string
  itemCount: number
}

export type SettlementRecoveryResult =
  | SettlementRecoveryEvidence
  | { status: 'not_processed' }
  | { status: 'unknown' }

export type SettlementRecoveryProbeInput = {
  operationKey: string
  settlementId: string
  settlementKey: string
  researchId: string
  escrowAddress: string
  txHash: string | null
  deploymentBlock?: bigint
}

export type SettlementRecoveryProbe = (input: SettlementRecoveryProbeInput) => Promise<SettlementRecoveryResult>

export type SettlementSubmissionResult = {
  status: 'confirmed'
  settlementId: string
  settlementKey: string
  itemsHash: string
  total: string
  itemCount: number
  txHash: string
  blockNumber: string
}

export type ProcessSettlementOperationInput = {
  researchRepo: Pick<ResearchRepo, 'findById'>
  txLogRepo: Pick<TxLogRepo, 'listByResearchId' | 'listPendingByResearchId' | 'markResearchSettlementConfirmed'>
  workflowOutboxRepo: Pick<WorkflowOutboxRepo, 'recordBroadcast' | 'complete' | 'claimOperation'>
  officialUsdc: string
  submitSettlement: () => Promise<SettlementSubmissionResult>
  recoverSettlement: SettlementRecoveryProbe
  deploymentBlock?: bigint
  now?: Date
}

export type ProcessSettlementOperationResult =
  | { status: 'submitted' }
  | { status: 'recovered' }

export async function processSettlementOperation(
  operation: WorkflowOperation,
  input: ProcessSettlementOperationInput,
): Promise<ProcessSettlementOperationResult> {
  const research = await input.researchRepo.findById(operation.researchId)
  if (!research) throw new Error(`Research missing for ${operation.type} operation ${operation.researchId}`)
  if (!research.researchKey || !research.escrowAddress || !research.chainId) {
    throw new Error(`Research ${research.id} is missing escrow settlement fields`)
  }
  if (operation.escrowAddress && lower(operation.escrowAddress) !== lower(research.escrowAddress)) {
    throw new Error(`${operation.type} operation escrow mismatch for research ${research.id}`)
  }
  assertSettlementBeforeExpiry(research, input.now ?? new Date())

  const settlementId = canonicalSettlementIdFromOperationKey(operation.operationKey)
  const derivedSettlementKey = settlementKey(research.researchKey, settlementId)
  const recovery = await input.recoverSettlement({
    operationKey: operation.operationKey,
    settlementId,
    settlementKey: derivedSettlementKey,
    researchId: research.id,
    escrowAddress: research.escrowAddress,
    txHash: operation.txHash,
    deploymentBlock: input.deploymentBlock,
  })

  if (recovery.status === 'unknown') {
    throw new Error('SETTLEMENT_RECOVERY_UNKNOWN')
  }

  if (recovery.status === 'processed') {
    assertRecoveryEvidenceMatches(recovery, derivedSettlementKey)
    await confirmPendingIntents({
      txLogRepo: input.txLogRepo,
      address: research.address,
      researchId: research.id,
      researchKey: research.researchKey,
      escrowAddress: research.escrowAddress,
      settlementId,
      txHash: recovery.txHash,
      chainId: recovery.chainId,
      blockNumber: recovery.blockNumber,
      evidence: recovery,
    })
    const recorded = await input.workflowOutboxRepo.recordBroadcast(operation.id, operation.fencingToken, {
      phase: 'broadcasting',
      txHash: recovery.txHash,
      chainId: recovery.chainId,
      blockNumber: recovery.blockNumber,
      blockHash: recovery.blockHash ?? null,
      logIndex: recovery.logIndex ?? null,
    })
    if (!recorded) throw new Error(`SETTLEMENT_RECOVERY_LOST_LEASE:${operation.operationKey}`)
    await completeAndEnqueueClose({ operation, input, blockNumber: recovery.blockNumber, blockHash: recovery.blockHash, logIndex: recovery.logIndex })
    return { status: 'recovered' }
  }

  if (operation.type === 'RECONCILE') {
    throw new Error('SETTLEMENT_RECOVERY_UNKNOWN')
  }

  const submitted = await input.submitSettlement()
  const recorded = await input.workflowOutboxRepo.recordBroadcast(operation.id, operation.fencingToken, {
    phase: 'broadcasting',
    txHash: submitted.txHash,
    chainId: research.chainId,
    blockNumber: submitted.blockNumber,
  })
  if (!recorded) throw new Error(`SETTLEMENT_SUBMIT_LOST_LEASE:${operation.operationKey}`)
  await completeAndEnqueueClose({ operation, input, blockNumber: submitted.blockNumber })
  return { status: 'submitted' }
}

function assertSettlementBeforeExpiry(research: { id: string; expectedExpiresAt?: Date | null }, now: Date) {
  if (!research.expectedExpiresAt || research.expectedExpiresAt.getTime() <= now.getTime()) {
    throw new Error('ESCROW_EXPIRED_BEFORE_FINALIZATION: serious operational alert; provider payment missed expiry and requires manual handling')
  }
}

async function confirmPendingIntents(input: {
  txLogRepo: Pick<TxLogRepo, 'listByResearchId' | 'listPendingByResearchId' | 'markResearchSettlementConfirmed'>
  address: string
  researchId: string
  researchKey: string
  escrowAddress: string
  settlementId: string
  txHash: string
  chainId: number | null
  blockNumber: string
  evidence: Pick<SettlementRecoveryEvidence, 'itemsHash' | 'total' | 'itemCount'>
}) {
  const pending = filterEscrowIntents(
    await input.txLogRepo.listPendingByResearchId(input.address, input.researchId, 500),
    input,
  )
  const allResearchEntries = await input.txLogRepo.listByResearchId(input.address, input.researchId, 1000)
  const alreadyConfirmed = filterEscrowIntents(allResearchEntries, input)
    .filter((entry) => (
      entry.txStatus === 'confirmed'
      && entry.settlementId === input.settlementId
      && lower(entry.txHash ?? '') === lower(input.txHash)
    ))
  const intendedBatch = uniqueByRequestId([...pending, ...alreadyConfirmed])
    .sort((a, b) => compareHex(a.requestKey ?? a.requestId, b.requestKey ?? b.requestId))

  assertRecoveredBatchMatchesEvidence(intendedBatch, input.evidence)

  const requestIds = pending.map((entry: TxLogScopedEntry) => entry.requestId)
  if (requestIds.length === 0) return
  await input.txLogRepo.markResearchSettlementConfirmed({
    address: input.address,
    researchId: input.researchId,
    requestIds,
    settlementId: input.settlementId,
    txHash: input.txHash,
    txStatus: 'confirmed',
    chainId: input.chainId,
    blockNumber: input.blockNumber,
  })
}

async function completeAndEnqueueClose(input: {
  operation: WorkflowOperation
  input: Pick<ProcessSettlementOperationInput, 'workflowOutboxRepo'>
  blockNumber: string
  blockHash?: string | null
  logIndex?: number | null
}) {
  await input.input.workflowOutboxRepo.claimOperation({
    operationKey: `CLOSE:${input.operation.researchId}`,
    type: 'CLOSE',
    researchId: input.operation.researchId,
    escrowAddress: input.operation.escrowAddress,
    phase: 'queued',
    payloadHash: input.operation.payloadHash,
    protectedPayloadDigest: input.operation.protectedPayloadDigest,
    leaseOwner: input.operation.leaseOwner ?? 'settlement-worker',
    leaseDurationMs: 30_000,
  })

  const completed = await input.input.workflowOutboxRepo.complete(input.operation.id, input.operation.fencingToken, {
    phase: 'succeeded',
    blockNumber: input.blockNumber,
    blockHash: input.blockHash ?? null,
    logIndex: input.logIndex ?? null,
  })
  if (!completed) throw new Error(`SETTLEMENT_COMPLETE_LOST_LEASE:${input.operation.operationKey}`)
}

function assertRecoveryEvidenceMatches(evidence: SettlementRecoveryEvidence, expectedSettlementKey: string) {
  if (lower(evidence.settlementKey) !== lower(expectedSettlementKey)) {
    throw new Error('SETTLEMENT_RECOVERY_KEY_MISMATCH')
  }
}

function assertRecoveredBatchMatchesEvidence(
  entries: TxLogScopedEntry[],
  evidence: Pick<SettlementRecoveryEvidence, 'itemsHash' | 'total' | 'itemCount'>,
) {
  const items = entries.map(settlementItemFromIntent)
  const total = items.reduce((sum, item) => sum + BigInt(item.amount), 0n)
  if (
    entries.length !== evidence.itemCount
    || total !== BigInt(evidence.total)
    || lower(deriveItemsHash(items)) !== lower(evidence.itemsHash)
  ) {
    throw new Error('SETTLEMENT_RECOVERY_ITEMS_MISMATCH')
  }
}

function filterEscrowIntents<T extends TxLogEntry>(
  entries: T[],
  input: { researchKey: string; escrowAddress: string },
): Array<T & TxLogScopedEntry> {
  return entries.filter((entry): entry is T & TxLogScopedEntry => (
    entry.backend === 'escrow'
    && lower(entry.researchKey ?? '') === lower(input.researchKey)
    && lower(entry.escrowAddress ?? '') === lower(input.escrowAddress)
    && Boolean(entry.requestId)
    && Boolean(entry.requestKey)
    && Boolean(entry.sourceId)
    && Boolean(entry.registryRevision)
    && Boolean(entry.expectedPayout)
    && Boolean(entry.maxUnitPrice)
    && Boolean(entry.amountUnits)
  ))
}

function settlementItemFromIntent(entry: TxLogScopedEntry): CanonicalSettlementItem {
  return {
    requestKey: entry.requestKey ?? entry.requestId,
    sourceId: entry.sourceId ?? '',
    registryRevision: entry.registryRevision ?? '0',
    expectedPayout: entry.expectedPayout ?? '',
    maxUnitPrice: entry.maxUnitPrice ?? '0',
    amount: entry.amountUnits ?? '0',
  }
}

function uniqueByRequestId(entries: TxLogScopedEntry[]) {
  const byRequestId = new Map<string, TxLogScopedEntry>()
  for (const entry of entries) byRequestId.set(entry.requestId, entry)
  return [...byRequestId.values()]
}

export function canonicalSettlementIdFromOperationKey(operationKey: string) {
  const canonicalUuid = operationKey.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
  if (canonicalUuid) return canonicalUuid.toLowerCase()

  const hex = createHash('sha256').update(operationKey).digest('hex')
  const versioned = `${hex.slice(0, 12)}4${hex.slice(13, 16)}`
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')
  return [
    versioned.slice(0, 8),
    versioned.slice(8, 12),
    versioned.slice(12, 16),
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

function lower(value: string) {
  return value.toLowerCase()
}

function compareHex(left: string, right: string) {
  const a = BigInt(left)
  const b = BigInt(right)
  return a < b ? -1 : a > b ? 1 : 0
}
