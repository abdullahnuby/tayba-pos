import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, verifyPassword, hashPassword, validatePasswordPolicy, clearMustChangePassword } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { z } from 'zod'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'بيانات غير صحيحة' }, { status: 400 })
    }
    const { currentPassword, newPassword } = parsed.data

    const dbUser = await db.user.findUnique({ where: { id: user.id } })
    if (!dbUser) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
    if (!verifyPassword(currentPassword, dbUser.passwordHash)) {
      return NextResponse.json({ error: 'كلمة المرور الحالية غير صحيحة' }, { status: 400 })
    }

    // Enforce password policy on new password
    const policy = validatePasswordPolicy(newPassword)
    if (!policy.ok) {
      return NextResponse.json({ error: policy.error }, { status: 400 })
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: 'كلمة المرور الجديدة يجب أن تكون مختلفة' }, { status: 400 })
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword) },
    })
    await clearMustChangePassword(user.id)

    await auditLog({ user, action: 'password_change', entity: 'user', entityId: user.id })

    return NextResponse.json({ ok: true, message: 'تم تغيير كلمة المرور بنجاح' })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
