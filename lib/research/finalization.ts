import { createHash } from 'node:crypto'
import {
  finalLiabilityHash,
  finalLiabilityHashForRequests,
  settlementResultDigest,
  TERMINAL_STATE_PAID,
  TERMINAL_STATE_UNPAYABLE_MANUAL,
  TERMINAL_STATE_VOID_BEFORE_SIDE_EFFECT,
  type CanonicalLiabilityItem,
} from '@/lib/chain/canonical'
import type { Research, ResearchRepo } from '@/lib/db/research-repo'
import type { TxLogRepo, TxLogEntry } from '@/lib/db/tx-log-repo'
import type { WorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo'
import { canonicalSettlementIdFromOperationKey } from './settlement-worker'
import { settlementKey, itemsHash } from '@/lib/chain/canonical'

export const EMPTY_FINAL_LIABILITY_HASH = finalLiabilityHash([])

export type FinalizeResearchReportInput = {
  researchId: string
  reportMd: string
  workerId?: string
}

export type FinalizeResearchReportDeps = {
  researchRepo: Pick<ResearchRepo, 'findById' | 'requestFinalization'>
  txLogRepo: Pick<TxLogRepo, 'listByResearchId'>
  workflowOutboxRepo: Pick<WorkflowOutboxRepo, 'claimOperation'>
}

export type FinalizeResearchReportResult =
  | { status: 'completed'; settlementRequired: boolean; closeOperationKey: string }
  | { status: 'ignored'; reason: 'NOT_FOUND' | 'NOT_RUNNING_OPEN' | 'MISSING_ESCROW_FIELDS' }
  | { status: 'race_lost' }

export type PaidLiabilityEvidence = {
  requestId: string
  settlementKey: string
  itemsHash: string
  total: bigint | number | string
  itemCount: bigint | number | string
}

export type ManualLiabilityApproval = {
  requestId: string
  evidenceDigest: string
}

export function buildFinalLiabilitySnapshot(input: {
  intents: TxLogEntry[]
  paidEvidence?: PaidLiabilityEvidence[]
  manualApprovals?: ManualLiabilityApproval[]
}) {
  const paidByRequestId = new Map((input.paidEvidence ?? []).map((entry) => [entry.requestId, entry]))
  const manualByRequestId = new Map((input.manualApprovals ?? []).map((entry) => [entry.requestId, entry]))
  const expectedRequestKeys = input.intents.map((intent) => requiredHex(intent.requestKey, `intent ${intent.requestId} requestKey`)).sort()
  const liabilities: CanonicalLiabilityItem[] = input.intents.map((intent) => {
    if (!intent.requestId) throw new Error('INTENT_REQUEST_ID_MISSING')
    const requestKey = requiredHex(intent.requestKey, `intent ${intent.requestId} requestKey`)
    const paid = paidByRequestId.get(intent.requestId)
    if (paid) {
      const digest = settlementResultDigest(paid.settlementKey, paid.itemsHash, paid.total, paid.itemCount)
      return {
        requestKey,
        amount: requiredAmountUnits(intent),
        terminalState: TERMINAL_STATE_PAID,
        settlementKey: paid.settlementKey,
        terminalEvidenceHash: digest,
      }
    }
    const manual = manualByRequestId.get(intent.requestId)
    if (manual) {
      return {
        requestKey,
        amount: 0,
        terminalState: TERMINAL_STATE_UNPAYABLE_MANUAL,
        settlementKey: zeroHash(),
        terminalEvidenceHash: manual.evidenceDigest,
      }
    }
    return {
      requestKey,
      amount: 0,
      terminalState: TERMINAL_STATE_VOID_BEFORE_SIDE_EFFECT,
      settlementKey: zeroHash(),
      terminalEvidenceHash: digestJson({ reason: 'void_before_side_effect', requestId: intent.requestId }),
    }
  }).sort((left, right) => left.requestKey.localeCompare(right.requestKey))
  const spent = liabilities.reduce((sum, liability) => (
    Number(liability.terminalState) === TERMINAL_STATE_PAID ? sum + BigInt(liability.amount) : sum
  ), 0n)

  return {
    liabilities,
    expectedRequestKeys,
    spent: spent.toString(),
    finalLiabilityHash: finalLiabilityHashForRequests(liabilities, expectedRequestKeys, spent),
  }
}

export function buildCloseAuthorizationPayload(input: {
  research: Pick<Research, 'escrowAddress' | 'researchKey' | 'chainId'>
  closeReason: number
  finalLiabilityHash: string
  spent: bigint | number | string
  nonce: bigint | number | string
  issuedAt: bigint | number | string
  deadline: bigint | number | string
}) {
  if (!input.research.escrowAddress || !input.research.researchKey || !input.research.chainId) {
    throw new Error('CLOSE_AUTHORIZATION_RESEARCH_FIELDS_MISSING')
  }
  return {
    escrow: input.research.escrowAddress,
    researchKey: input.research.researchKey,
    closeReason: input.closeReason,
    finalLiabilityHash: input.finalLiabilityHash,
    spent: BigInt(input.spent).toString(),
    nonce: BigInt(input.nonce).toString(),
    issuedAt: BigInt(input.issuedAt).toString(),
    deadline: BigInt(input.deadline).toString(),
    chainId: input.research.chainId,
  }
}

export async function finalizeResearchReport(
  input: FinalizeResearchReportInput,
  deps: FinalizeResearchReportDeps,
): Promise<FinalizeResearchReportResult> {
  const research = await deps.researchRepo.findById(input.researchId)
  if (!research) return { status: 'ignored', reason: 'NOT_FOUND' }
  if (
    research.status !== 'running'
    || research.activationPhase !== 'active'
    || research.finalizationState !== 'open'
    || research.quotaReservationState !== 'consumed'
  ) {
    return { status: 'ignored', reason: 'NOT_RUNNING_OPEN' }
  }
  if (!research.researchKey || !research.escrowAddress || !research.chainId) {
    return { status: 'ignored', reason: 'MISSING_ESCROW_FIELDS' }
  }

  const intents = (await deps.txLogRepo.listByResearchId(research.address, research.id, 500))
    .filter((entry) => entry.backend === 'escrow' && Boolean(entry.paymentIntentId))
    .sort((left, right) => (left.requestKey ?? '').localeCompare(right.requestKey ?? ''))
  const escrowResearch = {
    ...research,
    researchKey: research.researchKey,
    escrowAddress: research.escrowAddress,
  }
  const closeOperationKey = `CLOSE:${research.id}`
  const closePayloadHash = digestJson({
    type: 'CLOSE',
    researchId: research.id,
    reason: 'report_finalized',
    reportHash: digestJson(input.reportMd),
    expectedRequestKeys: intents.map((intent) => intent.requestKey),
    finalLiabilityHash: intents.length === 0 ? EMPTY_FINAL_LIABILITY_HASH : null,
  })
  const settleOperation = intents.length > 0 ? settlementOperation(escrowResearch, intents, input.workerId) : undefined
  const reconcileOperation = intents.length > 0 ? {
    operationKey: `RECONCILE:${research.id}`,
    type: 'RECONCILE' as const,
    researchId: research.id,
    escrowAddress: research.escrowAddress,
    phase: 'queued' as const,
    payloadHash: settleOperation!.payloadHash,
    protectedPayloadDigest: settleOperation!.protectedPayloadDigest,
    leaseOwner: input.workerId ?? 'finalization-worker',
    leaseDurationMs: 30_000,
  } : undefined

  const completed = await deps.researchRepo.requestFinalization({
    id: research.id,
    expected: {
      status: research.status,
      activationPhase: research.activationPhase,
      finalizationState: research.finalizationState,
      quotaReservationState: research.quotaReservationState,
    },
    next: { status: 'completed', finalizationState: 'closing' },
    settleOperation,
    reconcileOperation,
    closeOperation: {
      operationKey: closeOperationKey,
      type: 'CLOSE',
      researchId: research.id,
      escrowAddress: research.escrowAddress,
      phase: 'queued',
      payloadHash: closePayloadHash,
      protectedPayloadDigest: closePayloadHash,
      leaseOwner: input.workerId ?? 'finalization-worker',
      leaseDurationMs: 30_000,
    },
    errorMessage: null,
    reportMd: input.reportMd,
    workflowOutboxRepo: deps.workflowOutboxRepo,
  })

  if (!completed) return { status: 'race_lost' }
  return { status: 'completed', settlementRequired: intents.length > 0, closeOperationKey }
}

function settlementOperation(research: Research & { researchKey: string; escrowAddress: string }, intents: TxLogEntry[], workerId?: string) {
  const operationKey = `SETTLE:${research.id}`
  const canonicalSettlementId = canonicalSettlementIdFromOperationKey(operationKey)
  const derivedSettlementKey = settlementKey(research.researchKey, canonicalSettlementId)
  const canonicalItems = intents.map((intent) => ({
    requestKey: requiredHex(intent.requestKey, `intent ${intent.requestId} requestKey`),
    sourceId: requiredHex(intent.sourceId, `intent ${intent.requestId} sourceId`),
    registryRevision: intent.registryRevision ?? '0',
    expectedPayout: intent.expectedPayout ?? zeroAddress(),
    maxUnitPrice: intent.maxUnitPrice ?? '0',
    amount: requiredAmountUnits(intent),
  })).sort((left, right) => left.requestKey.localeCompare(right.requestKey))
  const payloadHash = digestJson({
    type: 'SETTLE',
    researchId: research.id,
    settlementId: canonicalSettlementId,
    settlementKey: derivedSettlementKey,
    itemsHash: itemsHash(canonicalItems),
    requestIds: intents.map((intent) => intent.requestId),
  })
  return {
    operationKey,
    type: 'SETTLE' as const,
    researchId: research.id,
    escrowAddress: research.escrowAddress,
    phase: 'queued' as const,
    payloadHash,
    protectedPayloadDigest: payloadHash,
    leaseOwner: workerId ?? 'finalization-worker',
    leaseDurationMs: 30_000,
  }
}

function requiredAmountUnits(intent: TxLogEntry) {
  if (!intent.amountUnits) throw new Error(`INTENT_AMOUNT_UNITS_MISSING:${intent.requestId}`)
  return intent.amountUnits
}

function requiredHex(value: string | null | undefined, label: string) {
  if (!value) throw new Error(`HEX_MISSING:${label}`)
  return value
}

function digestJson(value: unknown) {
  return `0x${createHash('sha256').update(stableJson(value)).digest('hex')}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function zeroHash() {
  return '0x0000000000000000000000000000000000000000000000000000000000000000'
}

function zeroAddress() {
  return '0x0000000000000000000000000000000000000000'
}
