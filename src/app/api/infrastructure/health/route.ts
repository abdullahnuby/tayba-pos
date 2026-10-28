import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

/** Private diagnostic: checks the configured application database only. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (!['admin', 'manager'].includes(user.role)) {
    return NextResponse.json({ error: 'لا تملك صلاحية فحص البنية' }, { status: 403 })
  }

  const started = Date.now()
  try {
    await db.user.count()
    return NextResponse.json({
      ok: true,
      sourceOfTruth: 'application-database',
      database: { ok: true },
      latencyMs: Date.now() - started,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({
      ok: false,
      sourceOfTruth: 'application-database',
      database: { ok: false },
      latencyMs: Date.now() - started,
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
