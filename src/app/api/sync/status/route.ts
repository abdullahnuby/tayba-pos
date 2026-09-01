import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth-middleware'
import { getLastSyncAt, isGoogleConfigured } from '@/lib/sync'
import { getSetting } from '@/lib/google'

export async function GET(req: Request) {
  const auth = await authenticate(req as any, { skipRateLimit: true })
  if (auth instanceof Response) return auth

  const [lastSyncAt, configured, autoSyncEnabled] = await Promise.all([
    getLastSyncAt(),
    isGoogleConfigured(),
    getSetting('autoSyncEnabled'),
  ])

  return NextResponse.json({
    configured,
    lastSyncAt,
    autoSyncEnabled: autoSyncEnabled !== 'false', // default true
  })
}
