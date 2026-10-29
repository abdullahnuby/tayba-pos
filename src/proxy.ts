import { NextRequest, NextResponse } from 'next/server'
import { isUnsafeCrossOriginRequest } from '@/lib/request-origin'

/**
 * Apply browser security controls centrally, before any API route executes.
 * The app is intended to run as a local POS, so cross-origin browser writes
 * are never required.
 */
export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/') && isUnsafeCrossOriginRequest(req)) {
    return NextResponse.json(
      { error: 'تم رفض الطلب لأنه صادر من مصدر مختلف عن البرنامج' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const response = NextResponse.next()
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  if (req.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|logo.svg).*)',
  ],
}
