import { describe, it, expect, beforeEach } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'
import { checkRateLimit } from './rate-limit'

let kv: MockKv

beforeEach(() => {
  kv = new MockKv()
})

describe('rate-limit', () => {
  it('allows requests under the limit', async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await checkRateLimit(kv, '1.2.3.4', 'verify', 5, 60)
      expect(ok).toBe(true)
    }
  })

  it('blocks requests over the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(kv, '1.2.3.4', 'verify', 5, 60)
    }
    expect(await checkRateLimit(kv, '1.2.3.4', 'verify', 5, 60)).toBe(false)
  })

  it('isolates buckets by IP', async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(kv, '1.2.3.4', 'verify', 5, 60)
    }
    expect(await checkRateLimit(kv, '5.6.7.8', 'verify', 5, 60)).toBe(true)
  })
})
