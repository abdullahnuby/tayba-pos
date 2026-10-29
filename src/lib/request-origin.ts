const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Reject browser-originated unsafe API requests when their origin differs
 * from the requested app origin, or Fetch Metadata explicitly marks them as
 * cross-site. Requests with no Origin and no cross-site metadata remain
 * available for local CLI/automation clients.
 */
export function isUnsafeCrossOriginRequest(request: Pick<Request, 'method' | 'url' | 'headers'>): boolean {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return false

  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (fetchSite === 'cross-site') return true

  const origin = request.headers.get('origin')
  if (!origin) return false

  try {
    return new URL(origin).origin !== new URL(request.url).origin
  } catch {
    return true
  }
}
