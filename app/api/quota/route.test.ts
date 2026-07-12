import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockQuota = vi.hoisted(() => ({
  getQuotaStatus: vi.fn(),
}))

vi.mock('@/lib/rate-limit/research-quota', () => ({
  getQuotaStatus: mockQuota.getQuotaStatus,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  vi.clearAllMocks()
  mockQuota.getQuotaStatus.mockResolvedValue({
    wallet: { consumed: 3, reserved: 1, used: 4, limit: 10, remaining: 6, resetAt: '2026-06-26T00:00:00.000Z' },
    global: { consumed: 60, reserved: 7, used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
    backend: 'postgres',
  })
})

async function authedRequest() {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request('http://localhost/api/quota', {
    headers: { cookie: `arc_session=${jwt}` },
  })
}

describe('GET /api/quota', () => {
  it('requires auth', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request('http://localhost/api/quota'))

    expect(res.status).toBe(401)
  })

  it('returns quota status for the current user', async () => {
    const { GET } = await import('./route')

    const res = await GET(await authedRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockQuota.getQuotaStatus).toHaveBeenCalledWith('0xabcdef000000000000000000000000000000c1d3')
    expect(body).toEqual({
      wallet: { consumed: 3, reserved: 1, used: 4, limit: 10, remaining: 6, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { consumed: 60, reserved: 7, used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
      backend: 'postgres',
    })
  })
})
