/**
 * Resolve a client identity from request headers.
 *
 * Local installations must not trust forwarded headers supplied by a client.
 * Forwarded identity is enabled only when the operator explicitly configures
 * a trusted reverse proxy in front of the application.
 */
export function getClientIpFromHeaders(headers: Headers): string {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return 'local'

  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  )
}
