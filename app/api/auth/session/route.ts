import { NextResponse } from 'next/server'
import { verifySessionJwt } from '@/lib/auth/jwt'
import { parseSessionCookie } from '@/lib/auth/session'

export async function GET(req: Request) {
  const jwt = parseSessionCookie(req.headers.get('cookie'))
  if (!jwt) return NextResponse.json({ user: null })
  try {
    const { sub } = await verifySessionJwt(jwt)
    return NextResponse.json({ user: { address: sub } })
  } catch {
    return NextResponse.json({ user: null })
  }
}
