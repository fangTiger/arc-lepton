import { NextResponse } from 'next/server'
import { createNonce } from '@/lib/auth/nonce-store'
import { checkRateLimit } from '@/lib/auth/rate-limit'
import { RATE_LIMIT_NONCE } from '@/lib/constants'
import { kv } from '@/lib/kv'

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const ok = await checkRateLimit(kv, ip, 'nonce', RATE_LIMIT_NONCE.max, RATE_LIMIT_NONCE.windowSec)
  if (!ok) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })

  const nonce = await createNonce(kv)
  return NextResponse.json({ nonce, issuedAt: new Date().toISOString() })
}
