import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE, ensureSeedAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 5 login attempts per 5 minutes per IP
    const limited = applyRateLimit(req, 'login', RATE_LIMITS.login.max, RATE_LIMITS.login.window)
    if (limited) return limited

    await ensureSeedAdmin()
    const { username, password } = await req.json()
    if (!username || !password) {
      return NextResponse.json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' }, { status: 400 })
    }
    const user = await db.user.findUnique({ where: { username } })
    if (!user || !user.active) {
      return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 })
    }
    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 })
    }
    const sessionUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role as 'admin' | 'manager' | 'cashier',
    }
    const token = createSessionToken(sessionUser)
    await auditLog({ user: sessionUser, action: 'login', entity: 'user', entityId: user.id, ip: req.headers.get('x-forwarded-for') || undefined })
    const res = NextResponse.json(sessionUser)
    // secure=true requires HTTPS — allow HTTP only for localhost dev (preview)
    const isLocalhost = req.headers.get('host')?.includes('localhost') || req.headers.get('host')?.includes('127.0.0.1')
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: isLocalhost ? 'lax' : 'strict',
      secure: !isLocalhost,
      maxAge: SESSION_MAX_AGE,
      path: '/',
    })
    return res
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ في تسجيل الدخول' }, { status: 500 })
  }
}
