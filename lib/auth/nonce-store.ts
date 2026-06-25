import type { KvClient } from '@/lib/kv'
import { MemoryKv } from '@/lib/kv-memory'
import { NONCE_TTL_SEC } from '@/lib/constants'
import { createHmac, timingSafeEqual } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const STATELESS_RANDOM_LEN = 16
const STATELESS_ISSUED_LEN = 10
const STATELESS_SIG_LEN = 24
const STATELESS_NONCE_LEN = STATELESS_RANDOM_LEN + STATELESS_ISSUED_LEN + STATELESS_SIG_LEN

function genNonce(len = 16): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

const key = (nonce: string) => `siwe:nonce:${nonce}`
const consumedKey = (nonce: string) => `siwe:nonce-consumed:${nonce}`

function isProductionMemoryFallback(kv: KvClient): kv is MemoryKv {
  return process.env.NODE_ENV === 'production' && kv instanceof MemoryKv
}

function nonceSecret() {
  return process.env.JWT_SECRET ?? 'development-only-nonce-secret'
}

function nonceSignature(random: string, issued: string): string {
  return createHmac('sha256', nonceSecret()).update(`${random}:${issued}`).digest('hex').slice(0, STATELESS_SIG_LEN)
}

function createStatelessNonce(): string {
  const random = genNonce(STATELESS_RANDOM_LEN)
  const issued = Date.now().toString(36).padStart(STATELESS_ISSUED_LEN, '0')
  return `${random}${issued}${nonceSignature(random, issued)}`
}

function isValidStatelessNonce(nonce: string): boolean {
  if (!new RegExp(`^[A-Za-z0-9]{${STATELESS_NONCE_LEN}}$`).test(nonce)) return false

  const random = nonce.slice(0, STATELESS_RANDOM_LEN)
  const issued = nonce.slice(STATELESS_RANDOM_LEN, STATELESS_RANDOM_LEN + STATELESS_ISSUED_LEN)
  const signature = nonce.slice(STATELESS_RANDOM_LEN + STATELESS_ISSUED_LEN)
  const issuedAt = Number.parseInt(issued, 36)

  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > NONCE_TTL_SEC * 1000) {
    return false
  }

  const expected = nonceSignature(random, issued)
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export async function createNonce(kv: KvClient): Promise<string> {
  const nonce = isProductionMemoryFallback(kv) ? createStatelessNonce() : genNonce()
  await kv.set(key(nonce), '1', { ex: NONCE_TTL_SEC })
  return nonce
}

export async function consumeNonce(kv: KvClient, nonce: string): Promise<boolean> {
  const v = await kv.getdel(key(nonce))
  if (!isProductionMemoryFallback(kv)) return v !== null

  if (v !== null) {
    await kv.set(consumedKey(nonce), '1', { ex: NONCE_TTL_SEC })
    return true
  }

  if ((await kv.get(consumedKey(nonce))) !== null) return false
  if (!isValidStatelessNonce(nonce)) return false

  await kv.set(consumedKey(nonce), '1', { ex: NONCE_TTL_SEC })
  return true
}
