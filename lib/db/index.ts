import { drizzle } from 'drizzle-orm/vercel-postgres'
import { sql } from '@vercel/postgres'
import * as schema from './schema/users'
import type { UsersRepo } from './users-repo'
import { MemoryUsersRepo } from './users-repo-memory'
import { PgUsersRepo } from './users-repo-pg'

const memoryFallbackMessage = '⚠ Using in-memory users repo (dev fallback). Data lost on restart.'

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

  console.warn(memoryFallbackMessage)
  return new MemoryUsersRepo()
}

export const usersRepo: UsersRepo = createUsersRepo()
