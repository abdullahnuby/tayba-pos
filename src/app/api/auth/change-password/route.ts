import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, verifyPassword, verifyPin, hashPassword, validatePasswordPolicy, clearMustChangePassword, rotateSessionEpoch, createSessionToken, getSessionEpoch, SESSION_COOKIE_NAME, SESSION_MAX_AGE, type SessionUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { z } from 'zod'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const limited = applyRateLimit(req, 'password-change', RATE_LIMITS.login.max, RATE_LIMITS.login.window)
    if (limited) return limited

    const user = await getCurrentUser({ allowMustChangePassword: true })
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'بيانات غير صحيحة' }, { status: 400 })
    }
    const { currentPassword, newPassword } = parsed.data

    const dbUser = await db.user.findUnique({ where: { id: user.id } })
    if (!dbUser) return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
    const currentCredentialValid = dbUser.passwordHash
      ? verifyPassword(currentPassword, dbUser.passwordHash)
      : Boolean(user.mustChangePassword && dbUser.pinHash && verifyPin(currentPassword, dbUser.pinHash))
    if (!currentCredentialValid) {
      return NextResponse.json({ error: 'كلمة المرور الحالية أو رقم PIN القديم غير صحيح' }, { status: 400 })
    }

    // Enforce password policy on new password
    const policy = validatePasswordPolicy(newPassword)
    if (!policy.ok) {
      return NextResponse.json({ error: policy.error }, { status: 400 })
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: 'كلمة المرور الجديدة يجب أن تكون مختلفة' }, { status: 400 })
    }

    const updatedUser = await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword) },
      select: { id: true, username: true, name: true, role: true },
    })
    await clearMustChangePassword(user.id)
    await rotateSessionEpoch(user.id)

    const refreshedUser: SessionUser = {
      id: updatedUser.id,
      username: updatedUser.username,
      name: updatedUser.name,
      role: updatedUser.role as SessionUser['role'],
    }
    const refreshedToken = createSessionToken(refreshedUser, await getSessionEpoch(user.id))

    await auditLog({ user, action: 'password_change', entity: 'user', entityId: user.id })

    const response = NextResponse.json({ ok: true, message: 'تم تغيير كلمة المرور بنجاح' })
    const hostname = new URL(req.url).hostname.toLowerCase()
    const localHttp = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
    response.cookies.set(SESSION_COOKIE_NAME, refreshedToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: !localHttp,
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })
    return response
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
