import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth-middleware'

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'], rateLimitScope: 'sync' })
  if (auth instanceof Response) return auth
  return NextResponse.json({
    ok: false,
    message: 'تم حذف تكامل Google Apps Script من وضع التشغيل المحلي.',
    source: 'local-sqlite',
  }, { status: 410 })
}
