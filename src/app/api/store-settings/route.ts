import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAllSettings, setSettings, clearSettingsCache } from '@/lib/settings'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

export async function GET() {
  const settings = await getAllSettings()
  // Mask private key
  if (settings.googlePrivateKey) {
    settings.googlePrivateKeyMasked = `${settings.googlePrivateKey.slice(0, 20)}...${settings.googlePrivateKey.slice(-20)}`
    delete settings.googlePrivateKey
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
    // If private key is empty or redacted, skip updating it
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(settings)) {
      if (k === 'googlePrivateKey' && (!v || v.includes('...'))) continue
      cleaned[k] = v
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
