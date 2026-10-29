import { NextRequest, NextResponse } from 'next/server'
import { isUnsafeCrossOriginRequest } from '@/lib/request-origin'
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Apply browser security controls centrally, before any API route executes.
 * The app is intended to run as a local POS, so cross-origin browser writes
 * are never required.
 */
export function proxy(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith('/api/')
  const method = req.method.toUpperCase()
  const unsafeWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  if (isApi && unsafeWrite && isUnsafeCrossOriginRequest(req)) {
    return NextResponse.json(
      { error: 'تم رفض الطلب لأنه صادر من مصدر مختلف عن البرنامج' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // Enforce a write limit even for routes that use getCurrentUser() directly
  // rather than the shared authenticate() helper. Specific endpoints retain
  // their tighter login/setup/PIN limits in addition to this global ceiling.
  if (isApi && unsafeWrite) {
    const limited = applyRateLimit(req, 'proxy-api-write', RATE_LIMITS.api_write.max, RATE_LIMITS.api_write.window)
    if (limited) {
      limited.headers.set('Cache-Control', 'no-store')
      limited.headers.set('X-Content-Type-Options', 'nosniff')
      return limited
    }
  }

  const response = NextResponse.next()
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  if (isApi) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|logo.svg).*)',
  ],
}
