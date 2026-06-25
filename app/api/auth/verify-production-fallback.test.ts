import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
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

function clearOptionalStorageEnv() {
  delete process.env.DATABASE_URL
  delete process.env.POSTGRES_URL
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
}

describe('POST /api/auth/verify production fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    restoreEnv()
    clearOptionalStorageEnv()
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    restoreEnv()
  })

  it('loads without DB or Redis env and still validates malformed bodies', async () => {
    const { POST } = await import('./verify/route')

    const res = await POST(
      new Request('https://arc-signal-ledger.vercel.app/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'x' }),
      }),
    )

    expect(res.status).toBe(400)
  })
})
