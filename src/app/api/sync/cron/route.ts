import { NextRequest, NextResponse } from 'next/server'
import { archiveLocalDatabase } from '@/lib/archive'

/**
 * Scheduled (cron) full sync to Google Sheets.
 *
 * This is deliberately separate from /api/sync/archive:
 * that one requires an admin/manager to be logged in (a real browser
 * session with a cookie), which an external scheduler doesn't have.
 * This route is authenticated instead with a single shared secret
 * (CRON_SECRET), meant to be called once a day by an external
 * scheduler (e.g. a GitHub Actions cron job) — never by the app UI.
 *
 * Set CRON_SECRET as an environment variable/secret in Cloudflare
 * (same value the scheduler sends), and keep it out of the repo.
 */
export async function POST(req: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret) {
    return NextResponse.json({ error: 'CRON_SECRET غير مضبوط على السيرفر' }, { status: 500 })
  }

  const providedSecret = req.headers.get('x-cron-secret')
  if (!providedSecret || providedSecret !== configuredSecret) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  }

  try {
    const result = await archiveLocalDatabase()
    return NextResponse.json(result)
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'فشل أرشفة قاعدة البيانات' },
      { status: 500 }
    )
  }
}
