/**
 * Combined auth + rate limit helper for API routes.
 * Use this at the start of every API handler.
 */
import { NextRequest } from 'next/server'
import { getCurrentUser, type SessionUser } from './auth'
import { applyRateLimit, RATE_LIMITS } from './rate-limit'

type Role = 'admin' | 'manager' | 'cashier'

interface AuthOptions {
  /** Required roles. If omitted, any authenticated user is allowed. */
  roles?: Role[]
  /** Rate limit scope. Default: 'api_general'. */
  rateLimitScope?: keyof typeof RATE_LIMITS
  /** Skip rate limiting (e.g. for GET-only routes). */
  skipRateLimit?: boolean
}

interface AuthResult {
  user: SessionUser
}

/**
 * Authenticate user + apply rate limit.
 * Throws Response (Next.js) on failure — return it directly to the client.
 *
 * Usage:
 *   try {
 *     const { user } = await authenticate(req, { roles: ['admin'] })
 *     // ... handler logic
 *   } catch (e) {
 *     return e as Response  // already a Next.js Response
 *   }
 *
 * Or simpler:
 *   const auth = await authenticate(req, { roles: ['admin'] })
 *   if (auth instanceof Response) return auth
 *   const user = auth.user
 */
export async function authenticate(
  req: NextRequest,
  options: AuthOptions = {}
): Promise<AuthResult | Response> {
  // Apply rate limit first (before any DB query)
  if (!options.skipRateLimit) {
    const scope = options.rateLimitScope || 'api_general'
    const cfg = RATE_LIMITS[scope]
    const limited = applyRateLimit(req, scope, cfg.max, cfg.window)
    if (limited) return limited
  }

  // Authenticate
  const user = await getCurrentUser()
  if (!user) {
    return new Response(
      JSON.stringify({ error: 'غير مصرح — الرجاء تسجيل الدخول' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // Check roles
  if (options.roles && !options.roles.includes(user.role as Role)) {
    return new Response(
      JSON.stringify({ error: 'لا تملك صلاحية لهذا الإجراء' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  return { user }
}
