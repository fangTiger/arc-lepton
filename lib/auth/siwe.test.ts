import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryKv } from '@/lib/kv-memory'
import { MockKv } from '@/test/fixtures/mock-kv'
import { testAccount, signTestMessage } from '@/test/fixtures/test-wallet'
import { buildSiweMessage } from '@/test/fixtures/valid-siwe-message'
import { createNonce } from './nonce-store'
import { verifySiweLogin } from './siwe'

const DOMAIN = 'localhost:3000'
const URI = 'http://localhost:3000'
const CHAIN_ID = 9999

let kv: MockKv

beforeEach(() => {
  kv = new MockKv()
  process.env.NEXT_PUBLIC_APP_URL = URI
  process.env.NEXT_PUBLIC_ARC_CHAIN_ID = String(CHAIN_ID)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function makeValidPayload() {
  const nonce = await createNonce(kv)
  const message = buildSiweMessage({
    domain: DOMAIN,
    address: testAccount.address,
    uri: URI,
    chainId: CHAIN_ID,
    nonce,
  })
  const signature = await signTestMessage(message)
  return { message, signature, address: testAccount.address }
}

describe('siwe.verifySiweLogin', () => {
  it('accepts a valid signature', async () => {
    const payload = await makeValidPayload()
    const result = await verifySiweLogin(kv, payload)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.address).toBe(testAccount.address.toLowerCase())
  })

  it('rejects when address mismatch', async () => {
    const payload = await makeValidPayload()
    const r = await verifySiweLogin(kv, { ...payload, address: '0x' + '0'.repeat(40) })
    expect(r.ok).toBe(false)
  })

  it('rejects when domain mismatch', async () => {
    const nonce = await createNonce(kv)
    const message = buildSiweMessage({
      domain: 'evil.com',
      address: testAccount.address,
      uri: URI,
      chainId: CHAIN_ID,
      nonce,
    })
    const signature = await signTestMessage(message)
    const r = await verifySiweLogin(kv, { message, signature, address: testAccount.address })
    expect(r.ok).toBe(false)
  })

  it('rejects when chainId mismatch', async () => {
    const nonce = await createNonce(kv)
    const message = buildSiweMessage({
      domain: DOMAIN,
      address: testAccount.address,
      uri: URI,
      chainId: 1,
      nonce,
    })
    const signature = await signTestMessage(message)
    const r = await verifySiweLogin(kv, { message, signature, address: testAccount.address })
    expect(r.ok).toBe(false)
  })

  it('accepts production memory fallback nonce across isolated stores', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('JWT_SECRET', 'x'.repeat(32))

    const issuedBy = new MemoryKv()
    const verifiedBy = new MemoryKv()
    const nonce = await createNonce(issuedBy)
    const message = buildSiweMessage({
      domain: DOMAIN,
      address: testAccount.address,
      uri: URI,
      chainId: CHAIN_ID,
      nonce,
    })
    const signature = await signTestMessage(message)

    const result = await verifySiweLogin(verifiedBy, { message, signature, address: testAccount.address })

    expect(result.ok).toBe(true)
  })

  it('rejects when nonce missing or already used', async () => {
    const payload = await makeValidPayload()
    expect((await verifySiweLogin(kv, payload)).ok).toBe(true)
    expect((await verifySiweLogin(kv, payload)).ok).toBe(false)
  })

  it('rejects when issuedAt is too old', async () => {
    const nonce = await createNonce(kv)
    const oldIssued = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const message = buildSiweMessage({
      domain: DOMAIN,
      address: testAccount.address,
      uri: URI,
      chainId: CHAIN_ID,
      nonce,
      issuedAt: oldIssued,
    })
    const signature = await signTestMessage(message)
    const r = await verifySiweLogin(kv, { message, signature, address: testAccount.address })
    expect(r.ok).toBe(false)
  })

  it('rejects a tampered signature', async () => {
    const payload = await makeValidPayload()
    const last = payload.signature.slice(-1)
    const bad = `${payload.signature.slice(0, -1)}${last === '0' ? '1' : '0'}` as `0x${string}`
    const r = await verifySiweLogin(kv, { ...payload, signature: bad })
    expect(r.ok).toBe(false)
  })
})
