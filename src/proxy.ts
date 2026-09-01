import { NextRequest, NextResponse } from 'next/server'

/**
 * Next.js middleware — applies security headers to all responses.
 *
 * Headers added:
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY (prevents clickjacking)
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - X-XSS-Protection: 1; mode=block (legacy, but doesn't hurt)
 *
 * Note: HSTS is handled by Caddy/HTTPS proxy in production.
 */
export function proxy(_req: NextRequest) {
  const response = NextResponse.next()

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  // Cache control for API responses (no caching of sensitive data)
  if (_req.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, robots.txt, logo.svg
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|logo.svg).*)',
  ],
}
