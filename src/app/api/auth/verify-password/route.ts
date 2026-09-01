import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, verifyPassword } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  try {
    const body = await req.json()
    const password = String(body.password || '')
    const row = await db.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })
    if (!row || !verifyPassword(password, row.passwordHash)) return NextResponse.json({ ok: false, error: 'كلمة المرور غير صحيحة' }, { status: 403 })
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ ok: false, error: 'بيانات غير صحيحة' }, { status: 400 }) }
}
