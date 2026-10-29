import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import {
  requireUser,
  hashPassword,
  validatePasswordPolicy,
   hashPin,
  validatePinPolicy,
} from '@/lib/auth'
import { auditLog } from '@/lib/audit'

// Update a user: active status, role, name, or reset password.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireUser(['admin'])
    const { id } = await params

    const target = await db.user.findUnique({ where: { id } })
    if (!target) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
    }

    if (target.id === me.id && target.role === 'admin') {
      // Admin editing their own account: allow name/password changes,
      // but block self-demotion or self-deactivation to avoid lockout.
    }

    const body = await req.json()
    const data: Record<string, unknown> = {}

    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim()
    }

    if (typeof body.role === 'string') {
      if (!['admin', 'manager', 'cashier'].includes(body.role)) {
        return NextResponse.json({ error: 'صلاحية غير صحيحة' }, { status: 400 })
      }
      if (target.id === me.id && body.role !== 'admin') {
        return NextResponse.json({ error: 'لا يمكنك تغيير صلاحيتك الخاصة' }, { status: 400 })
      }
      data.role = body.role
    }

    if (typeof body.active === 'boolean') {
      if (target.id === me.id && body.active === false) {
        return NextResponse.json({ error: 'لا يمكنك تعطيل حسابك الخاص' }, { status: 400 })
      }
      data.active = body.active
    }

    let passwordReset = false
    if (typeof body.password === 'string' && body.password.length > 0) {
      const policy = validatePasswordPolicy(body.password)
      if (!policy.ok) {
        return NextResponse.json({ error: policy.error }, { status: 400 })
      }
      data.passwordHash = hashPassword(body.password)
      passwordReset = true
    }

    if (typeof body.pin === 'string' && body.pin.length > 0) {
      const pinPolicy = validatePinPolicy(body.pin)
      if (!pinPolicy.ok) {
        return NextResponse.json({ error: pinPolicy.error }, { status: 400 })
      }
      data.pinHash = hashPin(body.pin)
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'لا يوجد تعديل' }, { status: 400 })
    }

    const removingActiveAdmin = target.role === 'admin' && target.active && (
      (typeof data.role === 'string' && data.role !== 'admin') || data.active === false
    )
    if (removingActiveAdmin) {
      const activeAdminCount = await db.user.count({ where: { role: 'admin', active: true } })
      if (activeAdminCount <= 1) {
        return NextResponse.json({ error: 'لا يمكن تعطيل أو تغيير صلاحية آخر مدير نشط في النظام' }, { status: 409 })
      }
    }

    const revokeSessions = passwordReset || data.active !== undefined ||
      (typeof data.role === 'string' && data.role !== target.role)
    const nextEpoch = revokeSessions ? randomUUID() : null
    const updated = await db.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: { id },
        data,
        select: { id: true, username: true, name: true, role: true, active: true },
      })
      if (passwordReset) {
        await tx.setting.upsert({
          where: { key: `mustChangePw:${nextUser.id}` },
          create: { key: `mustChangePw:${nextUser.id}`, value: '1' },
          update: { value: '1' },
        })
      }
      if (nextEpoch) {
        await tx.setting.upsert({
          where: { key: `sessionEpoch:${nextUser.id}` },
          create: { key: `sessionEpoch:${nextUser.id}`, value: nextEpoch },
          update: { value: nextEpoch },
        })
      }
      return nextUser
    })

    await auditLog({
      user: me,
      action: 'update',
      entity: 'user',
      entityId: updated.id,
      after: { ...updated, passwordReset },
    })

    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'خطأ' }, { status: 500 })
  }
}

// Permanently delete a user (only if never used elsewhere — deactivate is preferred).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const me = await requireUser(['admin'])
    const { id } = await params

    if (id === me.id) {
      return NextResponse.json({ error: 'لا يمكنك حذف حسابك الخاص' }, { status: 400 })
    }

    const target = await db.user.findUnique({ where: { id } })
    if (!target) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
    }

    if (target.role === 'admin' && target.active) {
      const activeAdminCount = await db.user.count({ where: { role: 'admin', active: true } })
      if (activeAdminCount <= 1) {
        return NextResponse.json({ error: 'لا يمكن حذف آخر مدير نشط في النظام' }, { status: 409 })
      }
    }

    await db.user.delete({ where: { id } })

    await auditLog({
      user: me,
      action: 'delete',
      entity: 'user',
      entityId: id,
      before: { username: target.username, role: target.role },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'خطأ' }, { status: 500 })
  }
}
