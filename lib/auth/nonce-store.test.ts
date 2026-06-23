import { describe, it, expect, beforeEach } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'
import { createNonce, consumeNonce } from './nonce-store'

let kv: MockKv

beforeEach(() => {
  kv = new MockKv()
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
})
