import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, hashPassword, validatePasswordPolicy, flagMustChangePassword, hashPin, validatePinPolicy } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

export async function GET() {
  try {
    await requireUser(['admin'])
    const users = await db.user.findMany({
      select: { id: true, username: true, name: true, role: true, active: true, createdAt: true, pinHash: true },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(users.map(u => ({ ...u, pinHash: undefined, hasPin: !!u.pinHash })))
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'خطأ' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser(['admin'])
    const { username, password, name, role, pin } = await req.json()
    if (!username || !password || !name) {
      return NextResponse.json({ error: 'الحقول مطلوبة' }, { status: 400 })
    }
    // Password policy check
    const policy = validatePasswordPolicy(password)
    if (!policy.ok) {
      return NextResponse.json({ error: policy.error }, { status: 400 })
    }
    let pinHash: string | undefined
    if (typeof pin === 'string' && pin.length > 0) {
      const pinPolicy = validatePinPolicy(pin)
      if (!pinPolicy.ok) {
        return NextResponse.json({ error: pinPolicy.error }, { status: 400 })
      }
      pinHash = hashPin(pin)
    }
    const existing = await db.user.findUnique({ where: { username } })
    if (existing) {
      return NextResponse.json({ error: 'اسم المستخدم مأخوذ' }, { status: 400 })
    }
    if (!['admin', 'manager', 'cashier'].includes(role || 'cashier')) {
      return NextResponse.json({ error: 'صلاحية غير صحيحة' }, { status: 400 })
    }
    const user = await db.user.create({
      data: {
        username,
        passwordHash: hashPassword(password),
        pinHash,
        name,
        role: role || 'cashier',
      },
      select: { id: true, username: true, name: true, role: true, active: true },
    })
    // Force password change on first login (security best practice)
    await flagMustChangePassword(user.id)
    await auditLog({ user: me, action: 'create', entity: 'user', entityId: user.id, after: { ...user, mustChangePassword: true } })
    return NextResponse.json(user, { status: 201 })
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'خطأ' }, { status: 500 })
  }
}
