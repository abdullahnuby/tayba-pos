import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAllSettings, setSettings, clearSettingsCache } from '@/lib/settings'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (!['admin', 'manager'].includes(user.role)) {
    return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 })
  }

  const settings = await getAllSettings()
  // Retired third-party integration settings are not part of the local app.
  for (const key of Object.keys(settings)) {
    if (/^(google|appsScript|autoSyncEnabled|lastGoogle|lastArchive|lastRestore|sync|mustChangePw:|managerPin$|saleCounter$|purchaseCounter$|returnCounter$|purchaseReturnCounter$)/i.test(key)) delete settings[key]
  }
  return NextResponse.json(settings)
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
      return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 })
    }
    const body = await req.json()
    const { settings } = body as { settings: Record<string, string> }
    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'بيانات غير صحيحة' }, { status: 400 })
    }
    if (Object.keys(settings).some((key) => /^(google|appsScript|autoSyncEnabled|lastGoogle|lastArchive|lastRestore|sync|mustChangePw:|managerPin$|saleCounter$|purchaseCounter$|returnCounter$|purchaseReturnCounter$)/i.test(key))) {
      return NextResponse.json({ error: 'إعدادات المزامنة الخارجية غير متاحة في النسخة المحلية' }, { status: 400 })
    }
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(settings)) {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        return NextResponse.json({ error: `قيمة الإعداد "${k}" غير صحيحة` }, { status: 400 })
      }
      cleaned[k] = String(v)
    }
    await setSettings(cleaned)
    clearSettingsCache()
    await auditLog({ user, action: 'update', entity: 'settings', after: cleaned })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
