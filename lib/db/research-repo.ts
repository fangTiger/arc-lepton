import type { WorkflowOperationClaimInput, WorkflowOutboxRepo } from './workflow-outbox-repo'

export type ResearchStatus = 'funding' | 'funding_expired' | 'running' | 'completed' | 'failed' | 'cancelled'
export type ResearchActivationPhase = 'none' | 'funded' | 'activating' | 'active' | 'expired' | 'cancelled'
export type ResearchFinalizationState = 'none' | 'open' | 'closing' | 'closed' | 'manual'
export type QuotaReservationState = 'none' | 'reserved' | 'activating' | 'consumed' | 'released'

export type ResearchLifecycle = {
  status: ResearchStatus
  activationPhase: ResearchActivationPhase
  finalizationState: ResearchFinalizationState
  quotaReservationState: QuotaReservationState
}

export type ResearchLifecyclePatch = Partial<ResearchLifecycle>

export type Research = {
  id: string
  address: string
  prepareRequestId: string | null
  buyer: string | null
  topic: string
  budgetUsdc: string
  budgetUnits: string | null
  spentUsdc: string
  status: ResearchStatus
  activationPhase: ResearchActivationPhase
  finalizationState: ResearchFinalizationState
  quotaReservationState: QuotaReservationState
  researchKey: string | null
  expectedEscrowAddress: string | null
  escrowAddress: string | null
  reportMd: string | null
  errorMessage: string | null
  createdAt: Date
  preparedAt: Date | null
  fundingExpiresAt: Date | null
  expectedExpiresAt: Date | null
  fundingDeadline: Date | null
  intentSigner: string | null
  voucherNonce: string | null
  quotaDate: string | null
  cancelRequestedAt: Date | null
  chainId: number | null
  startedAt: Date | null
  completedAt: Date | null
}

export type CreateFundingResearchInput = {
  id?: string
  address: string
  prepareRequestId?: string | null
  buyer?: string | null
  topic: string
  budgetUsdc: string
  budgetUnits?: string | null
  researchKey?: string | null
  expectedEscrowAddress?: string | null
  escrowAddress?: string | null
  fundingExpiresAt: Date
  expectedExpiresAt?: Date | null
  fundingDeadline?: Date | null
  intentSigner?: string | null
  voucherNonce?: string | null
  quotaDate?: string | null
  cancelRequestedAt?: Date | null
  chainId?: number | null
}

export type QuotaLimitFailureReason = 'WALLET_LIMIT' | 'GLOBAL_LIMIT'

export type CreateFundingQuotaReservationInput = {
  day: string
  resetAt: Date
  walletLimit: number
  globalLimit: number
}

export type CreateFundingWithQuotaReservationResult =
  | { ok: true; research: Research }
  | { ok: false; reason: QuotaLimitFailureReason }

export type CompleteFundingExpiryInput = {
  id: string
  expected: ResearchLifecycle
  next: ResearchLifecyclePatch
  runOperation?: WorkflowOperationClaimInput
  workflowOutboxRepo?: Pick<WorkflowOutboxRepo, 'claimOperation'>
}

export type BeginActivationInput = {
  id: string
  expected: ResearchLifecycle
  next: ResearchLifecyclePatch
  activateOperation: WorkflowOperationClaimInput
  workflowOutboxRepo?: Pick<WorkflowOutboxRepo, 'claimOperation'>
}

export type RequestCancellationInput = {
  id: string
  expected: ResearchLifecycle
  next: ResearchLifecyclePatch
  closeOperation: WorkflowOperationClaimInput
  workflowOutboxRepo?: Pick<WorkflowOutboxRepo, 'claimOperation'>
}

export type RequestFinalizationInput = {
  id: string
  expected: ResearchLifecycle
  next: ResearchLifecyclePatch
  settleOperation?: WorkflowOperationClaimInput
  reconcileOperation?: WorkflowOperationClaimInput
  closeOperation: WorkflowOperationClaimInput
  reportMd?: string | null
  errorMessage: string | null
  workflowOutboxRepo?: Pick<WorkflowOutboxRepo, 'claimOperation'>
}

export interface ResearchRepo {
  create(input: { address: string; topic: string; budgetUsdc: string }): Promise<Research>
  createFunding(input: CreateFundingResearchInput): Promise<Research>
  createFundingWithQuotaReservation(
    input: CreateFundingResearchInput,
    quota: CreateFundingQuotaReservationInput,
  ): Promise<CreateFundingWithQuotaReservationResult>
  consumeQuotaReservation(id: string): Promise<boolean>
  releaseQuotaReservation(id: string): Promise<boolean>
  beginActivation(input: BeginActivationInput): Promise<boolean>
  requestCancellation(input: RequestCancellationInput): Promise<boolean>
  requestFinalization(input: RequestFinalizationInput): Promise<boolean>
  completeFundingExpiry(input: CompleteFundingExpiryInput): Promise<boolean>
  findByPrepareRequestId(prepareRequestId: string): Promise<Research | null>
  findById(id: string): Promise<Research | null>
  updateStatus(id: string, status: ResearchStatus, errorMessage?: string): Promise<void>
  updateStatusIfCurrent(id: string, expectedStatus: ResearchStatus, status: ResearchStatus, errorMessage?: string): Promise<boolean>
  transitionLifecycle(id: string, expected: ResearchLifecycle, next: ResearchLifecyclePatch): Promise<boolean>
  completeIfRunning(id: string, reportMd: string): Promise<boolean>
  appendSpent(id: string, deltaUsdc: string): Promise<void>
  setReport(id: string, reportMd: string): Promise<void>
  listByAddress(address: string, limit?: number): Promise<Research[]>
  countAll(): Promise<number>
  countRunning(): Promise<number>
}

const statusTransitions: Record<ResearchStatus, readonly ResearchStatus[]> = {
  funding: ['funding_expired', 'running', 'cancelled'],
  funding_expired: [],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

const activationTransitions: Record<ResearchActivationPhase, readonly ResearchActivationPhase[]> = {
  none: ['funded', 'expired', 'cancelled'],
  funded: ['activating', 'expired', 'cancelled'],
  activating: ['active', 'expired', 'cancelled'],
  active: [],
  expired: ['cancelled'],
  cancelled: [],
}

const finalizationTransitions: Record<ResearchFinalizationState, readonly ResearchFinalizationState[]> = {
  none: ['open', 'closing', 'closed'],
  open: ['closing'],
  closing: ['closed', 'manual'],
  closed: [],
  manual: ['closing', 'closed'],
}

const quotaTransitions: Record<QuotaReservationState, readonly QuotaReservationState[]> = {
  none: [],
  reserved: ['released', 'activating'],
  activating: ['consumed', 'released'],
  consumed: [],
  released: [],
}

function canTransition<T extends string>(current: T, next: T, transitions: Record<T, readonly T[]>) {
  return current === next || transitions[current].includes(next)
}

export function nextResearchLifecycle(current: ResearchLifecycle, patch: ResearchLifecyclePatch): ResearchLifecycle | null {
  const next: ResearchLifecycle = {
    status: patch.status ?? current.status,
    activationPhase: patch.activationPhase ?? current.activationPhase,
    finalizationState: patch.finalizationState ?? current.finalizationState,
    quotaReservationState: patch.quotaReservationState ?? current.quotaReservationState,
  }

  if (!canTransition(current.status, next.status, statusTransitions)) return null
  if (!canTransition(current.activationPhase, next.activationPhase, activationTransitions)) return null
  if (!canTransition(current.finalizationState, next.finalizationState, finalizationTransitions)) return null
  if (!canTransition(current.quotaReservationState, next.quotaReservationState, quotaTransitions)) return null

  return next
}
