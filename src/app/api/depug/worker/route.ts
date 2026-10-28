import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { db, getLocalDatabasePath } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Local diagnostics only; never reports secrets, file paths, or cloud integrations. */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'تشخيص البنية متاح للمدير العام فقط' }, { status: 403 })
  }

  const started = Date.now()
  try {
    const userCount = await db.user.count()
    const databasePathConfigured = Boolean(getLocalDatabasePath())
    const checks = {
      runtime: { ok: true, kind: 'nodejs' },
      database: { ok: true, source: 'local-sqlite', userCount, databasePathConfigured },
      authentication: { ok: Boolean(process.env.AUTH_SECRET), secretConfigured: Boolean(process.env.AUTH_SECRET) },
    }
    const ok = Object.values(checks).every((check) => check.ok)
    return NextResponse.json({
      ok,
      timestamp: new Date().toISOString(),
      mode: 'local-only',
      checks,
      latencyMs: Date.now() - started,
    }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } })
  } catch {
    return NextResponse.json({
      ok: false,
      mode: 'local-only',
      checks: { database: { ok: false } },
      latencyMs: Date.now() - started,
    }, { status: 503, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } })
  }
}
