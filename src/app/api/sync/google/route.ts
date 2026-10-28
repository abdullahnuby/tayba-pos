import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth-middleware'

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'], rateLimitScope: 'sync' })
  if (auth instanceof Response) return auth
  return NextResponse.json({
    error: 'تم تعطيل مزامنة Google Sheets؛ البرنامج يحفظ البيانات محليًا فقط.',
    source: 'local-sqlite',
  }, { status: 410 })
}
