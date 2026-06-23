import { CompactSign, jwtVerify } from 'jose'
import { COOKIE_MAX_AGE_SEC } from '@/lib/constants'

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET missing or too short')
  return Uint8Array.from(new TextEncoder().encode(secret))
}

export async function signSessionJwt(address: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = Uint8Array.from(new TextEncoder().encode(
    JSON.stringify({
      sub: address.toLowerCase(),
      iat: now,
      exp: now + COOKIE_MAX_AGE_SEC,
    }),
  ))
  return new CompactSign(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(getSecret())
}

export async function verifySessionJwt(token: string): Promise<{ sub: string; iat: number; exp: number }> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
  return payload as { sub: string; iat: number; exp: number }
}
