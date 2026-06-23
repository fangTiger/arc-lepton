import { NextResponse } from 'next/server'
import { buildLogoutCookie } from '@/lib/auth/session'

export async function POST() {
  return NextResponse.json(
    { ok: true },
    {
      headers: { 'Set-Cookie': buildLogoutCookie() },
    },
  )
}
