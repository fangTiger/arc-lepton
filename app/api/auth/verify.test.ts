import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { MockKv } from '@/test/fixtures/mock-kv'
import { testAccount, signTestMessage } from '@/test/fixtures/test-wallet'
import { buildSiweMessage } from '@/test/fixtures/valid-siwe-message'
import { createNonce } from '@/lib/auth/nonce-store'

const mockKv = new MockKv()
vi.mock('@/lib/kv', () => ({ kv: mockKv }))

const upsertSpy = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: () => {
          upsertSpy(v)
          return Promise.resolve()
        },
      }),
    }),
  },
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
  process.env.NEXT_PUBLIC_ARC_CHAIN_ID = '9999'
})

beforeEach(() => {
  mockKv._clear()
  upsertSpy.mockClear()
})

async function postVerify(body: object): Promise<Response> {
  const { POST } = await import('./verify/route')
  return POST(
    new Request('http://localhost:3000/api/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

async function buildValidBody() {
  const nonce = await createNonce(mockKv)
  const message = buildSiweMessage({
    domain: 'localhost:3000',
    address: testAccount.address,
    uri: 'http://localhost:3000',
    chainId: 9999,
    nonce,
  })
  const signature = await signTestMessage(message)
  return { message, signature, address: testAccount.address }
}

describe('POST /api/auth/verify', () => {
  it('returns 200 + Set-Cookie + user on valid signature', async () => {
    const res = await postVerify(await buildValidBody())
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('arc_session=')
    expect(upsertSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 401 on tampered message', async () => {
    const body = await buildValidBody()
    body.message = body.message.replace('Sign in to', 'Drain wallet:')
    const res = await postVerify(body)
    expect(res.status).toBe(401)
  })

  it('returns 401 when nonce already consumed', async () => {
    const body = await buildValidBody()
    expect((await postVerify(body)).status).toBe(200)
    expect((await postVerify(body)).status).toBe(401)
  })

  it('returns 400 on malformed body', async () => {
    const res = await postVerify({ message: 'x' })
    expect(res.status).toBe(400)
  })
})
