import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const settings = await db.setting.findMany()
  const obj: Record<string, string> = {}
  for (const s of settings) obj[s.key] = s.value
  // Mask the private key for security in GET response
  if (obj.googlePrivateKey) {
    obj.googlePrivateKeyMasked = obj.googlePrivateKey.slice(0, 20) + '...[hidden]'
    delete obj.googlePrivateKey
  }
  // Never send the raw Apps Script token back to the client — only a flag + short mask.
  if (obj.appsScriptToken) {
    obj.appsScriptTokenSet = 'true'
    obj.appsScriptTokenMasked = obj.appsScriptToken.slice(0, 4) + '...[hidden]'
    delete obj.appsScriptToken
  }
  return NextResponse.json(obj)
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const settings = body.settings || body
    for (const [key, value] of Object.entries(settings)) {
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
