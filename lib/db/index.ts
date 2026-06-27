import type { ResearchRepo } from './research-repo'
import type { Research, ResearchStatus } from './research-repo'
import { MemoryResearchRepo } from './research-repo-memory'
import type { ResearchFollowUp, ResearchFollowUpRepo } from './research-follow-up-repo'
import { MemoryResearchFollowUpRepo } from './research-follow-up-repo-memory'
import type { TxLogClaimInput, TxLogClaimResult, TxLogEntry, TxLogReceiptPatch, TxLogRecordInput, TxLogRepo, TxLogScopedEntry } from './tx-log-repo'
import { MemoryTxLogRepo } from './tx-log-repo-memory'
import type { UsersRepo } from './users-repo'
import type { UserRecord } from './users-repo'
import { MemoryUsersRepo } from './users-repo-memory'

const usersMemoryFallbackMessage = '⚠ Using in-memory users repo (dev fallback). Data lost on restart.'
const txLogMemoryFallbackMessage = '⚠ Using in-memory tx_log repo (dev fallback). Data lost on restart.'
const researchMemoryFallbackMessage = '⚠ Using in-memory research repo (dev fallback). Data lost on restart.'
const researchFollowUpMemoryFallbackMessage = '⚠ Using in-memory research_follow_up repo (dev fallback). Data lost on restart.'

const memoryRepoGlobal = globalThis as typeof globalThis & {
  __arcLeptonUsersRepo?: UsersRepo
  __arcLeptonTxLogRepo?: TxLogRepo
  __arcLeptonResearchRepo?: ResearchRepo
  __arcLeptonResearchFollowUpRepo?: ResearchFollowUpRepo
  __arcLeptonPgDb?: Promise<unknown>
  __arcLeptonPgUsersRepo?: Promise<UsersRepo>
  __arcLeptonPgTxLogRepo?: Promise<TxLogRepo>
  __arcLeptonPgResearchRepo?: Promise<ResearchRepo>
  __arcLeptonPgResearchFollowUpRepo?: Promise<ResearchFollowUpRepo>
  __arcLeptonUsersRepoWarned?: boolean
  __arcLeptonTxLogRepoWarned?: boolean
  __arcLeptonResearchRepoWarned?: boolean
  __arcLeptonResearchFollowUpRepoWarned?: boolean
}

function envValue(name: string) {
  const value = process.env[name]?.trim()
  if (!value || value === 'undefined') return ''
  return value
}

function hasDbEnv() {
  return Boolean(envValue('DATABASE_URL') || envValue('POSTGRES_URL'))
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

function createResearchRepo(): ResearchRepo {
  if (hasDbEnv()) return new LazyPgResearchRepo()

  if (!memoryRepoGlobal.__arcLeptonResearchRepoWarned) {
    console.warn(researchMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonResearchRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonResearchRepo ??= new MemoryResearchRepo()
  return memoryRepoGlobal.__arcLeptonResearchRepo
}

export const researchRepo: ResearchRepo = createResearchRepo()

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
