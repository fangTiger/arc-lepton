import { describe, it, expect, beforeAll } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

describe('GET /api/auth/session', () => {
  it('returns user when cookie valid', async () => {
    const token = await signSessionJwt('0xAbC')
    const { GET } = await import('./session/route')
    const res = await GET(
      new Request('http://localhost/api/auth/session', {
        headers: { cookie: `arc_session=${token}` },
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.user.address).toBe('0xabc')
  })

  it('returns null user when no cookie', async () => {
    const { GET } = await import('./session/route')
    const res = await GET(new Request('http://localhost/api/auth/session'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.user).toBeNull()
  })
})
