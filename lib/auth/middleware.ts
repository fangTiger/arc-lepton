import type { Address } from 'viem'
import { verifySessionJwt } from './jwt'
import { parseSessionCookie } from './session'

export interface AuthContext {
  userId: Address
  address: Address
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const jwt = parseSessionCookie(req.headers.get('cookie'))
  if (!jwt) throw new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  try {
    const { sub } = await verifySessionJwt(jwt)
    return { userId: sub as Address, address: sub as Address }
  } catch {
    throw new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 })
  }
}
