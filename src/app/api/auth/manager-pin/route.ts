import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, requireUser, verifyPassword } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN موافقة المدير يجب أن يتكون من 4 إلى 6 أرقام'),
})

export async function GET() {
  try {
    await requireUser(['admin'])
    const row = await db.setting.findUnique({ where: { key: 'managerPin' }, select: { id: true } })
    return NextResponse.json({ configured: Boolean(row) }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  } catch (error) {
    if (error instanceof Response) return error
    return NextResponse.json({ error: 'تعذر قراءة حالة PIN المدير' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const limited = applyRateLimit(req, 'manager-pin', RATE_LIMITS.login.max, RATE_LIMITS.login.window)
    if (limited) return limited

    const user = await requireUser(['admin'])
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    }

    const admin = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, active: true, role: true },
    })
    if (!admin?.active || admin.role !== 'admin' || !admin.passwordHash ||
        !verifyPassword(parsed.data.currentPassword, admin.passwordHash)) {
      return NextResponse.json({ error: 'كلمة مرور المدير الحالية غير صحيحة' }, { status: 403 })
    }

    const hashedPin = hashPassword(parsed.data.pin)
    await db.setting.upsert({
      where: { key: 'managerPin' },
      create: { key: 'managerPin', value: hashedPin },
      update: { value: hashedPin },
    })

    await auditLog({
      user,
      action: 'security_setting_update',
      entity: 'settings',
      entityId: 'managerPin',
      after: { managerPinConfigured: true },
    })

    return NextResponse.json({ ok: true, configured: true })
  } catch (error) {
    if (error instanceof Response) return error
    return NextResponse.json({ error: 'تعذر حفظ PIN المدير' }, { status: 500 })
  }
}
