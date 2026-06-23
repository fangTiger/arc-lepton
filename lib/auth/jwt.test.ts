import { describe, it, expect, beforeAll } from 'vitest'
import { signSessionJwt, verifySessionJwt } from './jwt'

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

describe('jwt', () => {
  it('signs and verifies a session token', async () => {
    const token = await signSessionJwt('0xabc')
    const payload = await verifySessionJwt(token)
    expect(payload.sub).toBe('0xabc')
  })

  it('rejects a tampered token', async () => {
    const token = await signSessionJwt('0xabc')
    const tampered = token.slice(0, -1) + 'X'
    await expect(verifySessionJwt(tampered)).rejects.toThrow()
  })

  it('rejects when secret is different', async () => {
    const token = await signSessionJwt('0xabc')
    process.env.JWT_SECRET = 'different-different-different-different32'
    await expect(verifySessionJwt(token)).rejects.toThrow()
    process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
  })
})
