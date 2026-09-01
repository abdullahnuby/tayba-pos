import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const openSchema = z.object({
  openingFloat: z.number().min(0),
  notes: z.string().optional().nullable(),
})

const closeSchema = z.object({
  sessionId: z.string().min(1),
  closingFloat: z.number().min(0),
  notes: z.string().optional().nullable(),
})

export async function GET() {
  const sessions = await db.registerSession.findMany({
    include: { user: { select: { name: true, username: true } } },
    orderBy: { openedAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({ items: sessions })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const parsed = openSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    }
    const data = parsed.data

    const existing = await db.registerSession.findFirst({
      where: { userId: user.id, status: 'open' },
    })
    if (existing) {
      return NextResponse.json({ error: 'لديك وردية مفتوحة بالفعل — أغلقها أولاً' }, { status: 400 })
    }

    const session = await db.registerSession.create({
      data: {
        userId: user.id,
        openingFloat: data.openingFloat,
        notes: data.notes,
        status: 'open',
      },
    })
    await auditLog({ user, action: 'register_open', entity: 'registerSession', entityId: session.id, after: { openingFloat: data.openingFloat } })
    return NextResponse.json(session, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await req.json()
    const parsed = closeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    }
    const data = parsed.data

    const session = await db.registerSession.findUnique({ where: { id: data.sessionId } })
    if (!session) return NextResponse.json({ error: 'الوردية غير موجودة' }, { status: 404 })
    if (session.status === 'closed') return NextResponse.json({ error: 'الوردية مغلقة بالفعل' }, { status: 400 })

    // CRITICAL #1 fix: aggregate sales WITHIN the session window (openedAt <= date <= NOW)
    // + filter by session.userId (only this cashier's sales)
    const now = new Date()
    const sales = await db.sale.findMany({
      where: {
        date: { gte: session.openedAt, lte: now },
        status: 'completed',
        userId: session.userId,
      },
      select: { paymentMethod: true, total: true },
    })
    const cashSales = sales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.total, 0)
    const cardSales = sales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.total, 0)
    const transferSales = sales.filter((s) => s.paymentMethod === 'transfer').reduce((sum, s) => sum + s.total, 0)

    // Add cash customer payments collected during session (تحصيل آجل بالكاش)
    const customerCashPayments = await db.customerPayment.aggregate({
      where: {
        date: { gte: session.openedAt, lte: now },
        method: 'cash',
      },
      _sum: { amount: true },
    })
    const customerCashIn = customerCashPayments._sum.amount || 0

    // Subtract cash refunds (sale returns where customer got cash back)
    const cashReturns = await db.saleReturn.findMany({
      where: {
        date: { gte: session.openedAt, lte: now },
        status: 'completed',
        sale: { paymentMethod: 'cash', userId: session.userId },
      },
      select: { total: true },
    })
    const cashReturnsOut = cashReturns.reduce((s, r) => s + r.total, 0)

    const expectedCash = session.openingFloat + cashSales + customerCashIn - cashReturnsOut
    const difference = data.closingFloat - expectedCash

    const updated = await db.registerSession.update({
      where: { id: data.sessionId },
      data: {
        closedAt: now,
        closingFloat: data.closingFloat,
        expectedCash,
        difference,
        cashSales,
        cardSales,
        transferSales,
        notes: data.notes,
        status: 'closed',
      },
    })
    await auditLog({
      user,
      action: 'register_close',
      entity: 'registerSession',
      entityId: session.id,
      after: { closingFloat: data.closingFloat, expectedCash, difference, cashSales, customerCashIn, cashReturnsOut },
    })
    return NextResponse.json(updated)
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
