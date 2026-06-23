import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'

const mockKv = new MockKv()
vi.mock('@/lib/kv', () => ({ kv: mockKv }))

beforeEach(() => mockKv._clear())

describe('GET /api/auth/nonce', () => {
  it('returns a 16-char nonce', async () => {
    const { GET } = await import('./nonce/route')
    const res = await GET(new Request('http://localhost/api/auth/nonce'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.nonce).toMatch(/^[A-Za-z0-9]{16}$/)
  })
})
