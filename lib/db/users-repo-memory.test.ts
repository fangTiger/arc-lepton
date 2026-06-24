import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryUsersRepo } from './users-repo-memory'

const fallbackMessage = '⚠ Using in-memory users repo (dev fallback). Data lost on restart.'

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  NEXT_PHASE: process.env.NEXT_PHASE,
  NODE_ENV: process.env.NODE_ENV,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function clearDbEnv() {
  delete process.env.DATABASE_URL
  delete process.env.POSTGRES_URL
  delete process.env.NEXT_PHASE
}

describe('MemoryUsersRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates users on first login and updates lastLoginAt on later logins', async () => {
    const repo = new MemoryUsersRepo()
    const address = '0xAbCdEf000000000000000000000000000000C1d3'

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    await repo.upsertOnLogin(address)

    vi.setSystemTime(new Date('2026-01-01T00:05:00.000Z'))
    await repo.upsertOnLogin(address)

    const user = await repo.getByAddress(address)
    expect(await repo.count()).toBe(1)
    expect(user).toEqual({
      address,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: new Date('2026-01-01T00:05:00.000Z'),
    })
  })
})

describe('usersRepo selection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    restoreEnv()
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    restoreEnv()
  })

  it('uses memory users repo in local dev when DB env is missing', async () => {
    clearDbEnv()
    vi.stubEnv('NODE_ENV', 'development')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { usersRepo } = await import('./index')

    await usersRepo.upsertOnLogin('0xAbCdEf000000000000000000000000000000C1d3')
    expect(await usersRepo.count()).toBe(1)
    expect(warn).toHaveBeenCalledWith(fallbackMessage)
  })

  it('fails fast in production runtime when DB env is missing', async () => {
    clearDbEnv()
    vi.stubEnv('NODE_ENV', 'production')

    await expect(import('./index')).rejects.toThrow('DB env required in production')
  })
})
