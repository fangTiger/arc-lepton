import { COOKIE_MAX_AGE_SEC, COOKIE_NAME } from '@/lib/constants'

export function buildSessionCookie(jwt: string): string {
  const isProd = process.env.NODE_ENV === 'production'
  return [
    `${COOKIE_NAME}=${jwt}`,
    'HttpOnly',
    isProd ? 'Secure' : '',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SEC}`,
    'Path=/',
  ]
    .filter(Boolean)
    .join('; ')
}

export function buildLogoutCookie(): string {
  const isProd = process.env.NODE_ENV === 'production'
  return [`${COOKIE_NAME}=`, 'HttpOnly', isProd ? 'Secure' : '', 'SameSite=Lax', 'Max-Age=0', 'Path=/']
    .filter(Boolean)
    .join('; ')
}

export function parseSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.split(/;\s*/).find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
  return match?.slice(COOKIE_NAME.length + 1) || null
}
