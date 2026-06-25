import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { signSessionJwt } from '@/lib/auth/jwt'
import { buildSessionCookie } from '@/lib/auth/session'
import { verifySiweLogin } from '@/lib/auth/siwe'
import { RATE_LIMIT_VERIFY } from '@/lib/constants'
import { usersRepo } from '@/lib/db'
import { kv } from '@/lib/kv'

const BodySchema = z.object({
  message: z.string().min(20),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

function parseSiweDiagnostics(message: string) {
  const lines = message.split('\n')
  const get = (key: string) => lines.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2) ?? null
  const chainId = Number.parseInt(get('Chain ID') ?? '', 10)

  return {
    domain: lines[0]?.split(' wants you to sign in')[0] ?? null,
    chainId: Number.isNaN(chainId) ? null : chainId,
    issuedAt: get('Issued At'),
  }
}

function expectedSiweDiagnostics() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return {
    appHost: new URL(appUrl).host,
    arcChainId: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '0'),
    now: new Date().toISOString(),
  }
}

function logSiweFailure(reason: string, message: string) {
  if (process.env.NODE_ENV === 'production') return

  console.error('[auth.verify] SIWE validation failed', {
    reason,
    parsed: parseSiweDiagnostics(message),
    expected: expectedSiweDiagnostics(),
  })
}

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
  if (!result.ok) {
    logSiweFailure(result.reason, parsed.data.message)
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 })
  }

  await usersRepo.upsertOnLogin(result.address)

  const jwt = await signSessionJwt(result.address)
  return NextResponse.json(
    { user: { address: result.address } },
    { headers: { 'Set-Cookie': buildSessionCookie(jwt) } },
  )
}
