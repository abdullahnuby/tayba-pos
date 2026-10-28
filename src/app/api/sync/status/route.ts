import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: Request) {
  const auth = await authenticate(req as any, { roles: ['admin', 'manager'], skipRateLimit: true })
  if (auth instanceof Response) return auth
  return NextResponse.json({
    source: 'local-sqlite',
    configured: false,
    syncEnabled: false,
    autoSyncEnabled: false,
    lastSyncAt: null,
    message: 'التشغيل محلي فقط؛ لا توجد مزامنة خارجية.',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
