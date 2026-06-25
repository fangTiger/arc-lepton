import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PHASE: process.env.NEXT_PHASE,
}

const memoryRepoGlobal = globalThis as typeof globalThis & {
  __arcLeptonUsersRepo?: unknown
  __arcLeptonTxLogRepo?: unknown
  __arcLeptonUsersRepoWarned?: boolean
  __arcLeptonTxLogRepoWarned?: boolean
}
const mutableEnv = process.env as Record<string, string | undefined>

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name]
  if (value === undefined) {
    delete mutableEnv[name]
    return
  }

  mutableEnv[name] = value
}

function clearMemoryRepoGlobals() {
  delete memoryRepoGlobal.__arcLeptonUsersRepo
  delete memoryRepoGlobal.__arcLeptonTxLogRepo
  delete memoryRepoGlobal.__arcLeptonUsersRepoWarned
  delete memoryRepoGlobal.__arcLeptonTxLogRepoWarned
}

describe('db dev fallback repos', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    delete mutableEnv.DATABASE_URL
    delete mutableEnv.POSTGRES_URL
    delete mutableEnv.NEXT_PHASE
    mutableEnv.NODE_ENV = 'test'
    clearMemoryRepoGlobals()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    restoreEnv('DATABASE_URL')
    restoreEnv('POSTGRES_URL')
    restoreEnv('NODE_ENV')
    restoreEnv('NEXT_PHASE')
    clearMemoryRepoGlobals()
  })

  it('shares the in-memory tx_log fallback across module reloads', async () => {
    const first = await import('./index')
    await first.txLogRepo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
    })

    vi.resetModules()
    const second = await import('./index')

    expect(await second.txLogRepo.totalSpentByAddress('0xabc')).toBe('0.0001')
  })
})
