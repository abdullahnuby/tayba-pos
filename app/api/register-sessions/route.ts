import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser, verifyPassword } from '@/lib/auth'
import { verifyCashierPin } from '@/lib/cashier-pin'
import { auditLog } from '@/lib/audit'

const openSchema = z.object({
  openingFloat: z.number().min(0),
  password: z.string().optional().nullable(),
  pin: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

const closeSchema = z.object({
  sessionId: z.string().min(1),
  closingFloat: z.number().min(0),
  password: z.string().optional().nullable(),
  pin: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

async function verifyRegisterCredential(userId: string, role: string, password?: string | null, pin?: string | null) {
  if (role === 'cashier') {
    if (!pin) return { ok: false, code: 'PIN_REQUIRED' as const }
    const ok = await verifyCashierPin(userId, pin)
    return { ok, code: ok ? null : ('INVALID_PIN' as const) }
  }

  if (!password) return { ok: false, code: 'PASSWORD_REQUIRED' as const }
  const row = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
  const ok = !!row && verifyPassword(password, row.passwordHash)
  return { ok, code: ok ? null : ('INVALID_PASSWORD' as const) }
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  const where = user.role === 'cashier' ? { userId: user.id } : {}
  const sessions = await db.registerSession.findMany({
    where,
    include: { user: { select: { name: true, username: true } } },
    orderBy: { openedAt: 'desc' },
    take: user.role === 'cashier' ? 20 : 100,
  })
  return NextResponse.json({ items: sessions })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const parsed = openSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })

    const credential = await verifyRegisterCredential(user.id, user.role, parsed.data.password, parsed.data.pin)
    if (!credential.ok) {
      if (credential.code === 'PIN_REQUIRED') {
        return NextResponse.json({ error: 'يجب إعداد PIN الوردية أولاً', code: credential.code }, { status: 409 })
      }
      if (credential.code === 'PASSWORD_REQUIRED') {
        return NextResponse.json({ error: 'كلمة المرور مطلوبة', code: credential.code }, { status: 400 })
      }
      return NextResponse.json({
        error: user.role === 'cashier' ? 'PIN الوردية غير صحيح' : 'كلمة المرور غير صحيحة',
        code: credential.code,
      }, { status: 403 })
    }

    const existing = await db.registerSession.findFirst({ where: { userId: user.id, status: 'open' } })
    if (existing) return NextResponse.json({ error: 'لديك وردية مفتوحة بالفعل' }, { status: 409 })

    const session = await db.registerSession.create({
      data: {
        userId: user.id,
        openingFloat: parsed.data.openingFloat,
        notes: parsed.data.notes || null,
        status: 'open',
      },
    })
    await auditLog({ user, action: 'register_open', entity: 'registerSession', entityId: session.id, after: { openingFloat: session.openingFloat } })
    return NextResponse.json(session, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const parsed = closeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })

    const credential = await verifyRegisterCredential(user.id, user.role, parsed.data.password, parsed.data.pin)
    if (!credential.ok) {
      if (credential.code === 'PIN_REQUIRED') {
        return NextResponse.json({ error: 'يجب إعداد PIN الوردية أولاً', code: credential.code }, { status: 409 })
      }
      if (credential.code === 'PASSWORD_REQUIRED') {
        return NextResponse.json({ error: 'كلمة المرور مطلوبة', code: credential.code }, { status: 400 })
      }
      return NextResponse.json({
        error: user.role === 'cashier' ? 'PIN الوردية غير صحيح' : 'كلمة المرور غير صحيحة',
        code: credential.code,
      }, { status: 403 })
    }

    const session = await db.registerSession.findUnique({ where: { id: parsed.data.sessionId } })
    if (!session) return NextResponse.json({ error: 'الوردية غير موجودة' }, { status: 404 })
    if (user.role === 'cashier' && session.userId !== user.id) return NextResponse.json({ error: 'لا تملك هذه الوردية' }, { status: 403 })
    if (session.status === 'closed') return NextResponse.json({ error: 'الوردية مغلقة بالفعل' }, { status: 409 })

    const now = new Date()
    const sales = await db.sale.findMany({
      where: { date: { gte: session.openedAt, lte: now }, status: 'completed', userId: session.userId },
      select: { invoiceNo: true, total: true, paymentMethod: true },
    })
    const cashSales = sales.filter(s => s.paymentMethod === 'cash').reduce((s, x) => s + x.total, 0)
    const cardSales = sales.filter(s => s.paymentMethod === 'card').reduce((s, x) => s + x.total, 0)
    const transferSales = sales.filter(s => s.paymentMethod === 'transfer').reduce((s, x) => s + x.total, 0)
    const creditSales = sales.filter(s => s.paymentMethod === 'credit').reduce((s, x) => s + x.total, 0)
    const customerCash = (await db.customerPayment.aggregate({
      where: { date: { gte: session.openedAt, lte: now }, method: 'cash' },
      _sum: { amount: true },
    }))._sum.amount || 0
    const returns = await db.saleReturn.findMany({
      where: { date: { gte: session.openedAt, lte: now }, status: 'completed', sale: { userId: session.userId } },
      select: { total: true },
    })
    const cashRefunds = returns.reduce((s, r) => s + r.total, 0)
    const expectedCash = session.openingFloat + cashSales + customerCash - cashRefunds
    const difference = parsed.data.closingFloat - expectedCash

    const updated = await db.registerSession.update({
      where: { id: session.id },
      data: {
        closedAt: now,
        closingFloat: parsed.data.closingFloat,
        expectedCash,
        difference,
        cashSales,
        cardSales,
        transferSales,
        notes: parsed.data.notes || null,
        status: 'closed',
      },
    })

    const report = {
      invoiceCount: sales.length,
      cashSales,
      cardSales,
      transferSales,
      creditSales,
      customerCash,
      cashRefunds,
      openingFloat: session.openingFloat,
      expectedCash,
      closingFloat: parsed.data.closingFloat,
      difference,
      totalSales: sales.reduce((s, x) => s + x.total, 0),
      closedAt: now.toISOString(),
    }
    await auditLog({ user, action: 'register_close', entity: 'registerSession', entityId: session.id, after: report })
    return NextResponse.json({ ...updated, report })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 })
  }
}
