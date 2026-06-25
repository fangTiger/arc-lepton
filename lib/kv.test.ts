import { afterEach, describe, expect, it, vi } from 'vitest'

describe('kv dev fallback', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
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
})
