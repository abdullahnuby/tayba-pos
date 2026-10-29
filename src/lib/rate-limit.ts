/**
 * Simple in-memory rate limiter (no external dependencies).
 * Suitable for the current single-process local application.
 */

import { NextResponse } from 'next/server'
import { getClientIpFromHeaders } from './client-ip'
export { getClientIpFromHeaders } from './client-ip'

interface RateBucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateBucket>()

interface RateLimitResult {
  ok: boolean
  retryAfter: number  // seconds
  remaining: number
}

/**
 * Check rate limit for a key (e.g. IP + endpoint).
 * Returns ok=false if limit exceeded.
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  maybeCleanupBuckets(now)
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt < now) {
    // Create new bucket
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0, remaining: maxRequests - 1 }
  }

  bucket.count += 1
  if (bucket.count > maxRequests) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
    return { ok: false, retryAfter, remaining: 0 }
  }

  return {
    ok: true,
    retryAfter: 0,
    remaining: maxRequests - bucket.count,
  }
}

/**
 * Apply rate limit and return Response if exceeded, else null.
 * Usage:
 *   const limited = applyRateLimit(req, 'login', 5, 60_000)
 *   if (limited) return limited
 */
export function applyRateLimit(
  req: Request,
  scope: string,
  maxRequests: number,
  windowMs: number
): NextResponse | null {
  const ip = getClientIpFromHeaders(req.headers)
  const key = `${scope}:${ip}`
  const result = rateLimit(key, maxRequests, windowMs)

  if (!result.ok) {
    return new NextResponse(
      JSON.stringify({
        error: `تم تجاوز الحد المسموح من المحاولات. حاول مرة أخرى بعد ${result.retryAfter} ثانية.`,
        retryAfter: result.retryAfter,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(result.retryAfter),
        },
      }
    )
  }
  return null
}

// Cleanup old buckets lazily without relying on a background timer.
let lastCleanup = Date.now()
function maybeCleanupBuckets(now: number) {
  if (now - lastCleanup < 5 * 60 * 1000) return
  lastCleanup = now
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt < now) {
      buckets.delete(key)
    }
  }
}

/**
 * Pre-configured rate limit profiles.
 */
export const RATE_LIMITS = {
  login: { max: 5, window: 5 * 60 * 1000 },        // 5 attempts per 5 min
  setup: { max: 3, window: 60 * 1000 },             // 3 setup attempts per min
  api_general: { max: 100, window: 60 * 1000 },     // 100 req/min general
  api_write: { max: 30, window: 60 * 1000 },        // 30 writes/min
  export: { max: 5, window: 5 * 60 * 1000 },        // 5 exports per 5 min
  sync: { max: 3, window: 5 * 60 * 1000 },          // 3 syncs per 5 min
} as const
