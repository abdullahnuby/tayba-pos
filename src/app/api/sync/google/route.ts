import { NextRequest, NextResponse } from 'next/server'
import { syncAllSheets } from '@/lib/sync'
import { authenticate } from '@/lib/auth-middleware'

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticate(req, { roles: ['admin', 'manager'], rateLimitScope: 'sync' })
    if (auth instanceof Response) return auth

    const result = await syncAllSheets()
    return NextResponse.json(result)
  } catch (e: unknown) {
    const err = e as { message?: string; code?: number | string }
    const msg = err.message || 'خطأ غير متوقع'
    if (msg.includes('invalid_grant') || msg.includes('private key') || msg.includes('JWT')) {
      return NextResponse.json(
        { error: 'بيانات اعتماد Google غير صالحة. تأكد من البريد الإلكتروني والمفتاح الخاص.' },
        { status: 400 }
      )
    }
    if (msg.includes('404') || msg.includes('not found')) {
      return NextResponse.json(
        { error: 'لم يتم العثور على ملف Google Sheets. تأكد من معرّف الملف ومشاركته مع حساب الخدمة.' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
