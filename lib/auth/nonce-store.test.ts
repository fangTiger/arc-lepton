import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryKv } from '@/lib/kv-memory'
import { MockKv } from '@/test/fixtures/mock-kv'
import { createNonce, consumeNonce } from './nonce-store'

let kv: MockKv

beforeEach(() => {
  kv = new MockKv()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('nonce-store', () => {
  it('creates a unique nonce and stores in KV', async () => {
    const n1 = await createNonce(kv)
    const n2 = await createNonce(kv)
    expect(n1).not.toBe(n2)
    expect(n1).toMatch(/^[A-Za-z0-9]{16}$/)
  })

  it('consume returns true once, then false', async () => {
    const n = await createNonce(kv)
    expect(await consumeNonce(kv, n)).toBe(true)
    expect(await consumeNonce(kv, n)).toBe(false)
  })

  it('consume returns false for unknown nonce', async () => {
    expect(await consumeNonce(kv, 'unknown-nonce-xxxx')).toBe(false)
  })

  it('validates production memory fallback nonces across isolated stores', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32))

    const issuedBy = new MemoryKv()
    const verifiedBy = new MemoryKv()

    const nonce = await createNonce(issuedBy)

    expect(nonce).toMatch(/^[A-Za-z0-9]{50}$/)
    expect(await consumeNonce(verifiedBy, nonce)).toBe(true)
  })

  it('consumes production memory fallback nonces once per store', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32))

    const kv = new MemoryKv()
    const nonce = await createNonce(kv)

    expect(await consumeNonce(kv, nonce)).toBe(true)
    expect(await consumeNonce(kv, nonce)).toBe(false)
  })
})
