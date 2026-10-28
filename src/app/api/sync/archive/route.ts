import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth-middleware'

export async function POST(req: Request) {
  const auth = await authenticate(req as any, {
    roles: ['admin', 'manager'],
    rateLimitScope: 'sync',
  })
  if (auth instanceof Response) return auth
  return NextResponse.json({
    error: 'المسار القديم لم يعد ينشئ نسخًا احتياطية. استخدم /api/backup/database لنسخ SQLite.',
  }, { status: 410 })
}
