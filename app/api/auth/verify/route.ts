import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { signSessionJwt } from '@/lib/auth/jwt'
import { buildSessionCookie } from '@/lib/auth/session'
import { verifySiweLogin } from '@/lib/auth/siwe'
import { RATE_LIMIT_VERIFY } from '@/lib/constants'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema/users'
import { kv } from '@/lib/kv'

const BodySchema = z.object({
  message: z.string().min(20),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const allowed = await checkRateLimit(kv, ip, 'verify', RATE_LIMIT_VERIFY.max, RATE_LIMIT_VERIFY.windowSec)
  if (!allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 })

  const result = await verifySiweLogin(kv, {
    message: parsed.data.message,
    signature: parsed.data.signature as `0x${string}`,
    address: parsed.data.address,
  })
  if (!result.ok) return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })

  await db
    .insert(users)
    .values({ address: result.address })
    .onConflictDoUpdate({ target: users.address, set: { lastLoginAt: new Date() } })

  const jwt = await signSessionJwt(result.address)
  return NextResponse.json(
    { user: { address: result.address } },
    { headers: { 'Set-Cookie': buildSessionCookie(jwt) } },
  )
}
