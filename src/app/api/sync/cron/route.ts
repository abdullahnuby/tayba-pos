import { NextRequest, NextResponse } from 'next/server'

/** Cloud archive jobs are intentionally disabled in the local-only build. */
export async function POST(req: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET
  if (!configuredSecret) {
    return NextResponse.json({ error: 'النسخ المجدول الخارجي معطل في النسخة المحلية.' }, { status: 410 })
  }
  const providedSecret = req.headers.get('x-cron-secret')
  if (!providedSecret || providedSecret !== configuredSecret) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  }
  return NextResponse.json({ error: 'لا يوجد أرشيف سحابي في النسخة المحلية.' }, { status: 410 })
}
