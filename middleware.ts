import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_NAME } from '@/lib/constants'

export const config = {
  matcher: ['/dashboard/:path*', '/research/:path*'],
}

export function middleware(req: NextRequest) {
  const jwt = req.cookies.get(COOKIE_NAME)?.value
  if (!jwt) {
    const url = new URL('/login', req.url)
    url.searchParams.set('redirect', req.nextUrl.pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}
