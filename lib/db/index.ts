import type { ResearchRepo } from './research-repo'
import type {
  CompleteFundingExpiryInput,
  CreateFundingQuotaReservationInput,
  CreateFundingResearchInput,
  CreateFundingWithQuotaReservationResult,
  Research,
  ResearchLifecycle,
  ResearchLifecyclePatch,
  ResearchStatus,
} from './research-repo'
import { MemoryResearchRepo } from './research-repo-memory'
import type { ResearchFollowUp, ResearchFollowUpRepo } from './research-follow-up-repo'
import { MemoryResearchFollowUpRepo } from './research-follow-up-repo-memory'
import type {
  PaymentSettlement,
  PaymentSettlementClaimInput,
  PaymentSettlementClaimResult,
  PaymentSettlementConfirmedReconcileQuery,
  PaymentSettlementFailurePatch,
  PaymentSettlementReceiptPatch,
  PaymentSettlementRepo,
  PaymentSettlementRetryClaimInput,
  PaymentSettlementRetryQuery,
} from './payment-settlement-repo'
import { MemoryPaymentSettlementRepo } from './payment-settlement-repo-memory'
import type { TxLogClaimInput, TxLogClaimResult, TxLogEntry, TxLogReceiptPatch, TxLogRecordInput, TxLogRepo, TxLogResearchPaymentIntentInput, TxLogScopedEntry } from './tx-log-repo'
import { MemoryTxLogRepo } from './tx-log-repo-memory'
import type { WorkflowOutboxRepo } from './workflow-outbox-repo'
import { MemoryWorkflowOutboxRepo } from './workflow-outbox-repo-memory'
import type { WorkflowManualRecoveryAuditRepo } from './workflow-manual-recovery-audit-repo'
import { MemoryWorkflowManualRecoveryAuditRepo } from './workflow-manual-recovery-audit-repo-memory'
import type { ResearchEventRepo } from './research-event-repo'
import { MemoryResearchEventRepo } from './research-event-repo-memory'
import type { ResearchQuotaRepo } from './research-quota-repo'
import { MemoryResearchQuotaRepo, MemoryResearchQuotaStore } from './research-quota-repo-memory'
import type { UsersRepo } from './users-repo'
import type { UserRecord } from './users-repo'
import { MemoryUsersRepo } from './users-repo-memory'
import { getResearchBackendConfig } from '../research/backend-config'

const usersMemoryFallbackMessage = '⚠ Using in-memory users repo (dev fallback). Data lost on restart.'
const txLogMemoryFallbackMessage = '⚠ Using in-memory tx_log repo (dev fallback). Data lost on restart.'
const paymentSettlementMemoryFallbackMessage = '⚠ Using in-memory payment_settlement repo (dev fallback). Data lost on restart.'
const researchMemoryFallbackMessage = '⚠ Using in-memory research repo (dev fallback). Data lost on restart.'
const researchFollowUpMemoryFallbackMessage = '⚠ Using in-memory research_follow_up repo (dev fallback). Data lost on restart.'
const workflowOutboxMemoryFallbackMessage = '⚠ Using in-memory workflow_outbox repo (dev fallback). Data lost on restart.'
const workflowManualRecoveryAuditMemoryFallbackMessage = '⚠ Using in-memory workflow_manual_recovery_audit repo (dev fallback). Data lost on restart.'
const researchEventMemoryFallbackMessage = '⚠ Using in-memory research_event repo (dev fallback). Data lost on restart.'
const researchQuotaMemoryFallbackMessage = '⚠ Using in-memory research_quota repo (dev fallback). Data lost on restart.'

const memoryRepoGlobal = globalThis as typeof globalThis & {
  __arcLeptonUsersRepo?: UsersRepo
  __arcLeptonTxLogRepo?: TxLogRepo
  __arcLeptonPaymentSettlementRepo?: PaymentSettlementRepo
  __arcLeptonResearchRepo?: ResearchRepo
  __arcLeptonResearchFollowUpRepo?: ResearchFollowUpRepo
  __arcLeptonWorkflowOutboxRepo?: WorkflowOutboxRepo
  __arcLeptonWorkflowManualRecoveryAuditRepo?: WorkflowManualRecoveryAuditRepo
  __arcLeptonResearchEventRepo?: ResearchEventRepo
  __arcLeptonResearchQuotaRepo?: ResearchQuotaRepo
  __arcLeptonResearchQuotaStore?: MemoryResearchQuotaStore
  __arcLeptonPgDb?: Promise<unknown>
  __arcLeptonPgUsersRepo?: Promise<UsersRepo>
  __arcLeptonPgTxLogRepo?: Promise<TxLogRepo>
  __arcLeptonPgPaymentSettlementRepo?: Promise<PaymentSettlementRepo>
  __arcLeptonPgResearchRepo?: Promise<ResearchRepo>
  __arcLeptonPgResearchFollowUpRepo?: Promise<ResearchFollowUpRepo>
  __arcLeptonPgWorkflowOutboxRepo?: Promise<WorkflowOutboxRepo>
  __arcLeptonPgWorkflowManualRecoveryAuditRepo?: Promise<WorkflowManualRecoveryAuditRepo>
  __arcLeptonPgResearchEventRepo?: Promise<ResearchEventRepo>
  __arcLeptonPgResearchQuotaRepo?: Promise<ResearchQuotaRepo>
  __arcLeptonUsersRepoWarned?: boolean
  __arcLeptonTxLogRepoWarned?: boolean
  __arcLeptonPaymentSettlementRepoWarned?: boolean
  __arcLeptonResearchRepoWarned?: boolean
  __arcLeptonResearchFollowUpRepoWarned?: boolean
  __arcLeptonWorkflowOutboxRepoWarned?: boolean
  __arcLeptonWorkflowManualRecoveryAuditRepoWarned?: boolean
  __arcLeptonResearchEventRepoWarned?: boolean
  __arcLeptonResearchQuotaRepoWarned?: boolean
}

function envValue(name: string) {
  const value = process.env[name]?.trim()
  if (!value || value === 'undefined') return ''
  return value
}

function hasDbEnv() {
  return Boolean(envValue('DATABASE_URL') || envValue('POSTGRES_URL'))
}

export class DurableDbRequiredError extends Error {
  readonly code = 'DURABLE_DB_REQUIRED'

  constructor(readonly context: string) {
    super(`Durable Postgres is required for ${context}`)
    this.name = 'DurableDbRequiredError'
  }
}

export function researchSettlementBackend() {
  return getResearchBackendConfig().settlementBackend
}

export function isEscrowSettlementBackend() {
  return researchSettlementBackend() === 'escrow'
}

export function assertDurableDbAvailable(context = 'durable research workflow') {
  if (hasDbEnv()) return
  if (process.env.NODE_ENV === 'test') return
  throw new DurableDbRequiredError(context)
}

export function assertDurableDbAvailableForEscrow(context = 'escrow research') {
  if (!isEscrowSettlementBackend()) return
  assertDurableDbAvailable(context)
}

export function isProductionMemoryDbFallback() {
  return process.env.NODE_ENV === 'production' && !hasDbEnv() && !isNextProductionBuild()
}

function isNextProductionBuild() {
  return process.env.NEXT_PHASE === 'phase-production-build'
}

function syncVercelPostgresEnv() {
  if (!envValue('POSTGRES_URL') && envValue('DATABASE_URL')) {
    process.env.POSTGRES_URL = envValue('DATABASE_URL')
  }
}

async function getPgDb() {
  memoryRepoGlobal.__arcLeptonPgDb ??= (async () => {
    syncVercelPostgresEnv()
    const [{ drizzle }, { sql }, schema] = await Promise.all([
      import('drizzle-orm/vercel-postgres'),
      import('@vercel/postgres'),
      import('./schema'),
    ])
    return drizzle(sql, { schema })
  })()
  return memoryRepoGlobal.__arcLeptonPgDb
}

class LazyPgUsersRepo implements UsersRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgUsersRepo ??= (async () => {
      const [{ PgUsersRepo }, db] = await Promise.all([import('./users-repo-pg'), getPgDb()])
      return new PgUsersRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgUsersRepo
  }

  async upsertOnLogin(address: string): Promise<void> {
    return (await this.getRepo()).upsertOnLogin(address)
  }

  async getByAddress(address: string): Promise<UserRecord | null> {
    return (await this.getRepo()).getByAddress(address)
  }

  async count(): Promise<number> {
    return (await this.getRepo()).count()
  }
}

class LazyPgTxLogRepo implements TxLogRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgTxLogRepo ??= (async () => {
      const [{ PgTxLogRepo }, db] = await Promise.all([import('./tx-log-repo-pg'), getPgDb()])
      return new PgTxLogRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgTxLogRepo
  }

  async record(entry: TxLogRecordInput): Promise<TxLogEntry> {
    return (await this.getRepo()).record(entry)
  }

  async claimRequest(input: TxLogClaimInput): Promise<TxLogClaimResult> {
    return (await this.getRepo()).claimRequest(input)
  }

  async claimResearchPaymentIntent(input: TxLogResearchPaymentIntentInput): Promise<TxLogClaimResult> {
    return (await this.getRepo()).claimResearchPaymentIntent(input)
  }

  async updateReceipt(id: string, patch: TxLogReceiptPatch): Promise<TxLogEntry> {
    return (await this.getRepo()).updateReceipt(id, patch)
  }

  async findByRequestId(address: string, requestId: string): Promise<TxLogScopedEntry | null> {
    return (await this.getRepo()).findByRequestId(address, requestId)
  }

  async listByAddress(address: string, limit = 50): Promise<TxLogEntry[]> {
    return (await this.getRepo()).listByAddress(address, limit)
  }

  async listByResearchId(address: string, researchId: string, limit = 50): Promise<TxLogEntry[]> {
    return (await this.getRepo()).listByResearchId(address, researchId, limit)
  }

  async listPendingByResearchId(address: string, researchId: string, limit = 50): Promise<TxLogScopedEntry[]> {
    return (await this.getRepo()).listPendingByResearchId(address, researchId, limit)
  }

  async markResearchSettlementConfirmed(input: Parameters<TxLogRepo['markResearchSettlementConfirmed']>[0]): Promise<TxLogScopedEntry[]> {
    return (await this.getRepo()).markResearchSettlementConfirmed(input)
  }

  async markResearchSettlementFailed(input: Parameters<TxLogRepo['markResearchSettlementFailed']>[0]): Promise<TxLogScopedEntry[]> {
    return (await this.getRepo()).markResearchSettlementFailed(input)
  }

  async totalSpentByAddress(address: string): Promise<string> {
    return (await this.getRepo()).totalSpentByAddress(address)
  }

  async count(): Promise<number> {
    return (await this.getRepo()).count()
  }

  async totalSpent(): Promise<string> {
    return (await this.getRepo()).totalSpent()
  }
}

class LazyPgPaymentSettlementRepo implements PaymentSettlementRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgPaymentSettlementRepo ??= (async () => {
      const [{ PgPaymentSettlementRepo }, db] = await Promise.all([import('./payment-settlement-repo-pg'), getPgDb()])
      return new PgPaymentSettlementRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgPaymentSettlementRepo
  }

  async claimResearchSettlement(input: PaymentSettlementClaimInput): Promise<PaymentSettlementClaimResult> {
    return (await this.getRepo()).claimResearchSettlement(input)
  }

  async claimRetryableSettlement(id: string, input: PaymentSettlementRetryClaimInput = {}): Promise<PaymentSettlementClaimResult> {
    return (await this.getRepo()).claimRetryableSettlement(id, input)
  }

  async recordSettlementReceipt(id: string, patch: PaymentSettlementReceiptPatch): Promise<PaymentSettlement> {
    return (await this.getRepo()).recordSettlementReceipt(id, patch)
  }

  async confirmSettlement(id: string, patch: PaymentSettlementReceiptPatch): Promise<PaymentSettlement> {
    return (await this.getRepo()).confirmSettlement(id, patch)
  }

  async failSettlement(id: string, patch: PaymentSettlementFailurePatch): Promise<PaymentSettlement> {
    return (await this.getRepo()).failSettlement(id, patch)
  }

  async findById(id: string): Promise<PaymentSettlement | null> {
    return (await this.getRepo()).findById(id)
  }

  async listRetryableSettlements(query: PaymentSettlementRetryQuery = {}): Promise<PaymentSettlement[]> {
    return (await this.getRepo()).listRetryableSettlements(query)
  }

  async listConfirmedSettlementsNeedingReconcile(query: PaymentSettlementConfirmedReconcileQuery = {}): Promise<PaymentSettlement[]> {
    return (await this.getRepo()).listConfirmedSettlementsNeedingReconcile(query)
  }

  async count(): Promise<number> {
    return (await this.getRepo()).count()
  }
}

class LazyPgWorkflowOutboxRepo implements WorkflowOutboxRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgWorkflowOutboxRepo ??= (async () => {
      const [{ PgWorkflowOutboxRepo }, db] = await Promise.all([import('./workflow-outbox-repo-pg'), getPgDb()])
      return new PgWorkflowOutboxRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgWorkflowOutboxRepo
  }

  async claimOperation(input: Parameters<WorkflowOutboxRepo['claimOperation']>[0]) {
    return (await this.getRepo()).claimOperation(input)
  }

  async getProtectedPayload(operationKey: string) {
    return (await this.getRepo()).getProtectedPayload(operationKey)
  }

  async renewLease(
    id: string,
    fencingToken: number,
    input: Parameters<WorkflowOutboxRepo['renewLease']>[2],
  ) {
    return (await this.getRepo()).renewLease(id, fencingToken, input)
  }

  async recordCheckpoint(
    id: string,
    fencingToken: number,
    patch: Parameters<WorkflowOutboxRepo['recordCheckpoint']>[2],
  ) {
    return (await this.getRepo()).recordCheckpoint(id, fencingToken, patch)
  }

  async recordBroadcast(
    id: string,
    fencingToken: number,
    patch: Parameters<WorkflowOutboxRepo['recordBroadcast']>[2],
  ) {
    return (await this.getRepo()).recordBroadcast(id, fencingToken, patch)
  }

  async failAndRelease(
    id: string,
    fencingToken: number,
    patch: Parameters<WorkflowOutboxRepo['failAndRelease']>[2],
  ) {
    return (await this.getRepo()).failAndRelease(id, fencingToken, patch)
  }

  async complete(
    id: string,
    fencingToken: number,
    patch?: Parameters<WorkflowOutboxRepo['complete']>[2],
  ) {
    return (await this.getRepo()).complete(id, fencingToken, patch)
  }

  async recoverManualOperation(
    operationKey: string,
    patch: Parameters<WorkflowOutboxRepo['recoverManualOperation']>[1],
  ) {
    return (await this.getRepo()).recoverManualOperation(operationKey, patch)
  }

  async findByOperationKey(operationKey: string) {
    return (await this.getRepo()).findByOperationKey(operationKey)
  }

  async listDueOperations(query?: Parameters<WorkflowOutboxRepo['listDueOperations']>[0]) {
    return (await this.getRepo()).listDueOperations(query)
  }

  async count() {
    return (await this.getRepo()).count()
  }
}

class LazyPgWorkflowManualRecoveryAuditRepo implements WorkflowManualRecoveryAuditRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgWorkflowManualRecoveryAuditRepo ??= (async () => {
      const [{ PgWorkflowManualRecoveryAuditRepo }, db] = await Promise.all([import('./workflow-manual-recovery-audit-repo-pg'), getPgDb()])
      return new PgWorkflowManualRecoveryAuditRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgWorkflowManualRecoveryAuditRepo
  }

  async record(input: Parameters<WorkflowManualRecoveryAuditRepo['record']>[0]) {
    return (await this.getRepo()).record(input)
  }

  async listByOperationKey(operationKey: string) {
    return (await this.getRepo()).listByOperationKey(operationKey)
  }
}

class LazyPgResearchEventRepo implements ResearchEventRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgResearchEventRepo ??= (async () => {
      const [{ PgResearchEventRepo }, db] = await Promise.all([import('./research-event-repo-pg'), getPgDb()])
      return new PgResearchEventRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgResearchEventRepo
  }

  async appendEvent(input: Parameters<ResearchEventRepo['appendEvent']>[0]) {
    return (await this.getRepo()).appendEvent(input)
  }

  async listByResearch(
    researchId: string,
    query?: Parameters<ResearchEventRepo['listByResearch']>[1],
  ) {
    return (await this.getRepo()).listByResearch(researchId, query)
  }

  async recordCheckpoint(input: Parameters<ResearchEventRepo['recordCheckpoint']>[0]) {
    return (await this.getRepo()).recordCheckpoint(input)
  }

  async latestCheckpoint(researchId: string) {
    return (await this.getRepo()).latestCheckpoint(researchId)
  }
}

class LazyPgResearchQuotaRepo implements ResearchQuotaRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgResearchQuotaRepo ??= (async () => {
      const [{ PgResearchQuotaRepo }, db] = await Promise.all([import('./research-quota-repo-pg'), getPgDb()])
      return new PgResearchQuotaRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgResearchQuotaRepo
  }

  async consume(input: Parameters<ResearchQuotaRepo['consume']>[0]) {
    return (await this.getRepo()).consume(input)
  }

  async release(input: Parameters<ResearchQuotaRepo['release']>[0]) {
    return (await this.getRepo()).release(input)
  }

  async status(input: Parameters<ResearchQuotaRepo['status']>[0]) {
    return (await this.getRepo()).status(input)
  }
}

class LazyPgResearchRepo implements ResearchRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgResearchRepo ??= (async () => {
      const [{ PgResearchRepo }, db] = await Promise.all([import('./research-repo-pg'), getPgDb()])
      return new PgResearchRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgResearchRepo
  }

  async create(input: { address: string; topic: string; budgetUsdc: string }): Promise<Research> {
    return (await this.getRepo()).create(input)
  }

  async createFunding(input: CreateFundingResearchInput): Promise<Research> {
    return (await this.getRepo()).createFunding(input)
  }

  async createFundingWithQuotaReservation(
    input: CreateFundingResearchInput,
    quota: CreateFundingQuotaReservationInput,
  ): Promise<CreateFundingWithQuotaReservationResult> {
    return (await this.getRepo()).createFundingWithQuotaReservation(input, quota)
  }

  async consumeQuotaReservation(id: string): Promise<boolean> {
    return (await this.getRepo()).consumeQuotaReservation(id)
  }

  async releaseQuotaReservation(id: string): Promise<boolean> {
    return (await this.getRepo()).releaseQuotaReservation(id)
  }

  async beginActivation(input: Parameters<ResearchRepo['beginActivation']>[0]): Promise<boolean> {
    return (await this.getRepo()).beginActivation(input)
  }

  async requestCancellation(input: Parameters<ResearchRepo['requestCancellation']>[0]): Promise<boolean> {
    return (await this.getRepo()).requestCancellation(input)
  }

  async requestFinalization(input: Parameters<ResearchRepo['requestFinalization']>[0]): Promise<boolean> {
    return (await this.getRepo()).requestFinalization(input)
  }

  async completeFundingExpiry(input: CompleteFundingExpiryInput): Promise<boolean> {
    return (await this.getRepo()).completeFundingExpiry(input)
  }

  async findByPrepareRequestId(prepareRequestId: string): Promise<Research | null> {
    return (await this.getRepo()).findByPrepareRequestId(prepareRequestId)
  }

  async findById(id: string): Promise<Research | null> {
    return (await this.getRepo()).findById(id)
  }

  async updateStatus(id: string, status: ResearchStatus, errorMessage?: string): Promise<void> {
    return (await this.getRepo()).updateStatus(id, status, errorMessage)
  }

  async updateStatusIfCurrent(
    id: string,
    expectedStatus: ResearchStatus,
    status: ResearchStatus,
    errorMessage?: string,
  ): Promise<boolean> {
    return (await this.getRepo()).updateStatusIfCurrent(id, expectedStatus, status, errorMessage)
  }

  async transitionLifecycle(id: string, expected: ResearchLifecycle, next: ResearchLifecyclePatch): Promise<boolean> {
    return (await this.getRepo()).transitionLifecycle(id, expected, next)
  }

  async completeIfRunning(id: string, reportMd: string): Promise<boolean> {
    return (await this.getRepo()).completeIfRunning(id, reportMd)
  }

  async appendSpent(id: string, deltaUsdc: string): Promise<void> {
    return (await this.getRepo()).appendSpent(id, deltaUsdc)
  }

  async setReport(id: string, reportMd: string): Promise<void> {
    return (await this.getRepo()).setReport(id, reportMd)
  }

  async listByAddress(address: string, limit = 50): Promise<Research[]> {
    return (await this.getRepo()).listByAddress(address, limit)
  }

  async countAll(): Promise<number> {
    return (await this.getRepo()).countAll()
  }

  async countRunning(): Promise<number> {
    return (await this.getRepo()).countRunning()
  }
}

class LazyPgResearchFollowUpRepo implements ResearchFollowUpRepo {
  private getRepo() {
    memoryRepoGlobal.__arcLeptonPgResearchFollowUpRepo ??= (async () => {
      const [{ PgResearchFollowUpRepo }, db] = await Promise.all([import('./research-follow-up-repo-pg'), getPgDb()])
      return new PgResearchFollowUpRepo(db as never)
    })()
    return memoryRepoGlobal.__arcLeptonPgResearchFollowUpRepo
  }

  async create(input: { researchId: string; address: string; question: string }): Promise<ResearchFollowUp> {
    return (await this.getRepo()).create(input)
  }

  async listByResearchId(address: string, researchId: string, limit = 50): Promise<ResearchFollowUp[]> {
    return (await this.getRepo()).listByResearchId(address, researchId, limit)
  }

  async complete(id: string, input: { answerMd: string; spentUsdc: string }): Promise<ResearchFollowUp | null> {
    return (await this.getRepo()).complete(id, input)
  }

  async fail(id: string, errorMessage: string): Promise<ResearchFollowUp | null> {
    return (await this.getRepo()).fail(id, errorMessage)
  }
}

function createUsersRepo(): UsersRepo {
  if (hasDbEnv()) return new LazyPgUsersRepo()

  if (!memoryRepoGlobal.__arcLeptonUsersRepoWarned) {
    console.warn(usersMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonUsersRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonUsersRepo ??= new MemoryUsersRepo()
  return memoryRepoGlobal.__arcLeptonUsersRepo
}

export const usersRepo: UsersRepo = createUsersRepo()

function createTxLogRepo(): TxLogRepo {
  if (hasDbEnv()) return new LazyPgTxLogRepo()

  if (!memoryRepoGlobal.__arcLeptonTxLogRepoWarned) {
    console.warn(txLogMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonTxLogRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonTxLogRepo ??= new MemoryTxLogRepo()
  return memoryRepoGlobal.__arcLeptonTxLogRepo
}

export const txLogRepo: TxLogRepo = createTxLogRepo()

function createPaymentSettlementRepo(): PaymentSettlementRepo {
  if (hasDbEnv()) return new LazyPgPaymentSettlementRepo()

  if (!memoryRepoGlobal.__arcLeptonPaymentSettlementRepoWarned) {
    console.warn(paymentSettlementMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonPaymentSettlementRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonPaymentSettlementRepo ??= new MemoryPaymentSettlementRepo()
  return memoryRepoGlobal.__arcLeptonPaymentSettlementRepo
}

export const paymentSettlementRepo: PaymentSettlementRepo = createPaymentSettlementRepo()

function createWorkflowOutboxRepo(): WorkflowOutboxRepo {
  if (hasDbEnv()) return new LazyPgWorkflowOutboxRepo()

  if (!memoryRepoGlobal.__arcLeptonWorkflowOutboxRepoWarned) {
    console.warn(workflowOutboxMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonWorkflowOutboxRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonWorkflowOutboxRepo ??= new MemoryWorkflowOutboxRepo()
  return memoryRepoGlobal.__arcLeptonWorkflowOutboxRepo
}

export const workflowOutboxRepo: WorkflowOutboxRepo = createWorkflowOutboxRepo()

function createWorkflowManualRecoveryAuditRepo(): WorkflowManualRecoveryAuditRepo {
  if (hasDbEnv()) return new LazyPgWorkflowManualRecoveryAuditRepo()

  if (!memoryRepoGlobal.__arcLeptonWorkflowManualRecoveryAuditRepoWarned) {
    console.warn(workflowManualRecoveryAuditMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonWorkflowManualRecoveryAuditRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonWorkflowManualRecoveryAuditRepo ??= new MemoryWorkflowManualRecoveryAuditRepo()
  return memoryRepoGlobal.__arcLeptonWorkflowManualRecoveryAuditRepo
}

export const workflowManualRecoveryAuditRepo: WorkflowManualRecoveryAuditRepo = createWorkflowManualRecoveryAuditRepo()

function createResearchEventRepo(): ResearchEventRepo {
  if (hasDbEnv()) return new LazyPgResearchEventRepo()

  if (!memoryRepoGlobal.__arcLeptonResearchEventRepoWarned) {
    console.warn(researchEventMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonResearchEventRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonResearchEventRepo ??= new MemoryResearchEventRepo()
  return memoryRepoGlobal.__arcLeptonResearchEventRepo
}

export const researchEventRepo: ResearchEventRepo = createResearchEventRepo()

function createResearchQuotaRepo(): ResearchQuotaRepo {
  if (hasDbEnv()) return new LazyPgResearchQuotaRepo()

  if (!memoryRepoGlobal.__arcLeptonResearchQuotaRepoWarned) {
    console.warn(researchQuotaMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonResearchQuotaRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonResearchQuotaRepo ??= new MemoryResearchQuotaRepo(getMemoryResearchQuotaStore())
  return memoryRepoGlobal.__arcLeptonResearchQuotaRepo
}

export const researchQuotaRepo: ResearchQuotaRepo = createResearchQuotaRepo()

function createResearchRepo(): ResearchRepo {
  if (hasDbEnv()) return new LazyPgResearchRepo()

  if (!memoryRepoGlobal.__arcLeptonResearchRepoWarned) {
    console.warn(researchMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonResearchRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonResearchRepo ??= new MemoryResearchRepo(getMemoryResearchQuotaStore())
  return memoryRepoGlobal.__arcLeptonResearchRepo
}

export const researchRepo: ResearchRepo = createResearchRepo()

function getMemoryResearchQuotaStore() {
  memoryRepoGlobal.__arcLeptonResearchQuotaStore ??= new MemoryResearchQuotaStore()
  return memoryRepoGlobal.__arcLeptonResearchQuotaStore
}

function createResearchFollowUpRepo(): ResearchFollowUpRepo {
  if (hasDbEnv()) return new LazyPgResearchFollowUpRepo()

  if (!memoryRepoGlobal.__arcLeptonResearchFollowUpRepoWarned) {
    console.warn(researchFollowUpMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonResearchFollowUpRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonResearchFollowUpRepo ??= new MemoryResearchFollowUpRepo()
  return memoryRepoGlobal.__arcLeptonResearchFollowUpRepo
}

export const researchFollowUpRepo: ResearchFollowUpRepo = createResearchFollowUpRepo()
