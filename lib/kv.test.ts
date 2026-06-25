import { afterEach, describe, expect, it, vi } from 'vitest'

const redisMock = vi.hoisted(() => ({
  constructor: vi.fn(),
}))

vi.mock('@upstash/redis', () => ({
  Redis: class Redis {
    constructor(opts: { url: string; token: string }) {
      redisMock.constructor(opts)
    }
  },
}))

describe('kv dev fallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    redisMock.constructor.mockClear()
  })

  it('reuses the same in-memory store across module reloads', async () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.resetModules()

    const first = await import('./kv')
    ;(first.kv as { clear?: () => void }).clear?.()
    await first.kv.set('siwe:nonce:cold-start', '1')

    vi.resetModules()
    const second = await import('./kv')

    expect(await second.kv.get('siwe:nonce:cold-start')).toBe('1')
  })

  it('uses Upstash env aliases in production when KV env names are absent', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.example.com')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'upstash-token')
    vi.resetModules()

    await import('./kv')

    expect(redisMock.constructor).toHaveBeenCalledWith({
      url: 'https://upstash.example.com',
      token: 'upstash-token',
    })
  })

  it('falls back to in-memory KV in production when Redis env vars are absent', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    vi.resetModules()

    const first = await import('./kv')
    ;(first.kv as { clear?: () => void }).clear?.()
    await first.kv.set('siwe:nonce:production-memory', '1')

    vi.resetModules()
    const second = await import('./kv')

    expect(redisMock.constructor).not.toHaveBeenCalled()
    expect(await second.kv.get('siwe:nonce:production-memory')).toBe('1')
  })
})
