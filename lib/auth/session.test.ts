import { describe, it, expect, beforeAll } from 'vitest'
import { signSessionJwt } from './jwt'
import { requireAuth } from './middleware'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

function makeReq(cookie?: string): Request {
  return new Request('http://localhost/api/test', {
    headers: cookie ? { cookie } : {},
  })
}

describe('requireAuth', () => {
  it('returns address from valid cookie', async () => {
    const token = await signSessionJwt('0xAbC')
    const res = await requireAuth(makeReq(`arc_session=${token}`))
    expect(res.address).toBe('0xabc')
    expect(res.userId).toBe('0xabc')
  })

  it('throws 401 when no cookie', async () => {
    await expect(requireAuth(makeReq())).rejects.toMatchObject({ status: 401 })
  })

  it('throws 401 when cookie token invalid', async () => {
    await expect(requireAuth(makeReq('arc_session=not.a.real.jwt'))).rejects.toMatchObject({ status: 401 })
  })
})
