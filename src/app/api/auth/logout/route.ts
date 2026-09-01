import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

export async function POST() {
  const user = await getCurrentUser()
  if (user) {
    await auditLog({ user, action: 'logout', entity: 'user', entityId: user.id })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE_NAME)
  return res
}
