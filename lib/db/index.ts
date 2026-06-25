import { drizzle } from 'drizzle-orm/vercel-postgres'
import { sql } from '@vercel/postgres'
import * as schema from './schema'
import type { TxLogRepo } from './tx-log-repo'
import { MemoryTxLogRepo } from './tx-log-repo-memory'
import { PgTxLogRepo } from './tx-log-repo-pg'
import type { UsersRepo } from './users-repo'
import { MemoryUsersRepo } from './users-repo-memory'
import { PgUsersRepo } from './users-repo-pg'

const usersMemoryFallbackMessage = '⚠ Using in-memory users repo (dev fallback). Data lost on restart.'
const txLogMemoryFallbackMessage = '⚠ Using in-memory tx_log repo (dev fallback). Data lost on restart.'

const memoryRepoGlobal = globalThis as typeof globalThis & {
  __arcLeptonUsersRepo?: UsersRepo
  __arcLeptonTxLogRepo?: TxLogRepo
  __arcLeptonUsersRepoWarned?: boolean
  __arcLeptonTxLogRepoWarned?: boolean
}

function envValue(name: string) {
  const value = process.env[name]?.trim()
  if (!value || value === 'undefined') return ''
  return value
}

function hasDbEnv() {
  return Boolean(envValue('DATABASE_URL') || envValue('POSTGRES_URL'))
}

function isNextProductionBuild() {
  return process.env.NEXT_PHASE === 'phase-production-build'
}

function syncVercelPostgresEnv() {
  if (!envValue('POSTGRES_URL') && envValue('DATABASE_URL')) {
    process.env.POSTGRES_URL = envValue('DATABASE_URL')
  }
}

syncVercelPostgresEnv()
export const db = drizzle(sql, { schema })

function createUsersRepo(): UsersRepo {
  if (hasDbEnv()) return new PgUsersRepo(db)

  if (process.env.NODE_ENV === 'production' && !isNextProductionBuild()) {
    throw new Error('DB env required in production')
  }

  if (!memoryRepoGlobal.__arcLeptonUsersRepoWarned) {
    console.warn(usersMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonUsersRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonUsersRepo ??= new MemoryUsersRepo()
  return memoryRepoGlobal.__arcLeptonUsersRepo
}

export const usersRepo: UsersRepo = createUsersRepo()

function createTxLogRepo(): TxLogRepo {
  if (hasDbEnv()) return new PgTxLogRepo(db)

  if (process.env.NODE_ENV === 'production' && !isNextProductionBuild()) {
    throw new Error('DB env required in production')
  }

  if (!memoryRepoGlobal.__arcLeptonTxLogRepoWarned) {
    console.warn(txLogMemoryFallbackMessage)
    memoryRepoGlobal.__arcLeptonTxLogRepoWarned = true
  }
  memoryRepoGlobal.__arcLeptonTxLogRepo ??= new MemoryTxLogRepo()
  return memoryRepoGlobal.__arcLeptonTxLogRepo
}

export const txLogRepo: TxLogRepo = createTxLogRepo()
