import type { KvClient } from '@/lib/kv'
import { NONCE_TTL_SEC } from '@/lib/constants'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function genNonce(len = 16): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

const key = (nonce: string) => `siwe:nonce:${nonce}`

export async function createNonce(kv: KvClient): Promise<string> {
  const nonce = genNonce()
  await kv.set(key(nonce), '1', { ex: NONCE_TTL_SEC })
  return nonce
}

export async function consumeNonce(kv: KvClient, nonce: string): Promise<boolean> {
  const v = await kv.getdel(key(nonce))
  return v !== null
}
