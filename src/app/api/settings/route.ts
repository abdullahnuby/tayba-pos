import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const settings = await db.setting.findMany()
  const obj: Record<string, string> = {}
  for (const s of settings) obj[s.key] = s.value
  // Do not expose retired third-party integration settings to the client.
  for (const key of Object.keys(obj)) {
    if (/^(google|appsScript|autoSyncEnabled|lastGoogle|lastArchive|lastRestore|sync|mustChangePw:|managerPin$|saleCounter$|purchaseCounter$|returnCounter$|purchaseReturnCounter$)/i.test(key)) delete obj[key]
  }
  return NextResponse.json(obj)
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const settings = body.settings || body
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return NextResponse.json({ error: 'بيانات الإعدادات غير صحيحة' }, { status: 400 })
    }
    const forbidden = Object.keys(settings).find((key) => /^(google|appsScript|autoSyncEnabled|lastGoogle|lastArchive|lastRestore|sync|mustChangePw:|managerPin$|saleCounter$|purchaseCounter$|returnCounter$|purchaseReturnCounter$)/i.test(key))
    if (forbidden) {
      return NextResponse.json({ error: 'إعدادات المزامنة الخارجية غير متاحة في النسخة المحلية' }, { status: 400 })
    }
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return NextResponse.json({ error: `قيمة الإعداد "${key}" غير صحيحة` }, { status: 400 })
      }
      const strValue = String(value)
      await db.setting.upsert({
        where: { key },
        create: { key, value: strValue },
        update: { value: strValue },
      })
    }
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ في حفظ الإعدادات' }, { status: 500 })
  }
}
