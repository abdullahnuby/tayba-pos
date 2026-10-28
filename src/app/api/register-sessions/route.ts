import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser, verifyPin } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const pinField = z.string().regex(/^[0-9]{2,6}$/, 'الرقم السري غير صحيح')
const openSchema = z.object({ openingFloat: z.number().min(0), pin: pinField, notes: z.string().optional().nullable() })
const closeSchema = z.object({ sessionId: z.string().min(1), closingFloat: z.number().min(0), pin: pinField, notes: z.string().optional().nullable() })

async function verifyUserPin(userId: string, pin: string): Promise<'ok' | 'no-pin' | 'wrong'> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { pinHash: true } })
  if (!row?.pinHash) return 'no-pin'
  return verifyPin(pin, row.pinHash) ? 'ok' : 'wrong'
}

async function summarizeShift(session: { userId: string; openedAt: Date; openingFloat: number }, now: Date) {
  const range = { gte: session.openedAt, lte: now }
  const [sales, purchases, customerCashAgg, supplierCashAgg, saleRefunds, purchaseRefunds] = await Promise.all([
    db.sale.findMany({
      where: {
        createdAt: range,
        status: { in: ['completed', 'partial_return', 'returned'] },
        userId: session.userId,
      },
      select: {
        total: true, paid: true, initialPaid: true, paymentMethod: true,
        customerPayments: { select: { amount: true } },
      },
    }),
    db.purchase.findMany({
      where: { createdAt: range, status: 'completed', userId: session.userId },
      select: {
        total: true, paid: true, initialPaid: true, paymentMethod: true,
        supplierPayments: { select: { amount: true } },
      },
    }),
    db.customerPayment.aggregate({
      where: { createdAt: range, method: 'cash', userId: session.userId },
      _sum: { amount: true },
    }),
    db.supplierPayment.aggregate({
      where: { createdAt: range, method: 'cash', userId: session.userId },
      _sum: { amount: true },
    }),
    db.saleReturn.findMany({
      where: { createdAt: range, status: 'completed', refundMethod: 'cash', userId: session.userId },
      select: { total: true, refundAmount: true },
    }),
    db.purchaseReturn.findMany({
      where: { createdAt: range, status: 'completed', refundMethod: 'cash', userId: session.userId },
      select: { refundAmount: true, total: true },
    }),
  ])

  // "paid" is cumulative and increases when a debt is collected later. Prefer
  // the immutable original receipt field; for legacy rows, subtract recorded
  // invoice-linked collections so they aren't counted twice.
  const initialSalePayment = (sale: (typeof sales)[number]) =>
    sale.initialPaid ?? Math.max(0, sale.paid - sale.customerPayments.reduce((sum, payment) => sum + payment.amount, 0))
  const initialPurchasePayment = (purchase: (typeof purchases)[number]) =>
    purchase.initialPaid ?? Math.max(0, purchase.paid - purchase.supplierPayments.reduce((sum, payment) => sum + payment.amount, 0))

  const cashSales = sales.filter((sale) => sale.paymentMethod === 'cash').reduce((sum, sale) => sum + initialSalePayment(sale), 0)
  const cardSales = sales.filter((sale) => sale.paymentMethod === 'card').reduce((sum, sale) => sum + initialSalePayment(sale), 0)
  const transferSales = sales.filter((sale) => sale.paymentMethod === 'transfer').reduce((sum, sale) => sum + initialSalePayment(sale), 0)
  const creditSales = sales.filter((sale) => sale.paymentMethod === 'credit').reduce((sum, sale) => sum + sale.total, 0)
  const cashPurchases = purchases.filter((purchase) => purchase.paymentMethod === 'cash').reduce((sum, purchase) => sum + initialPurchasePayment(purchase), 0)
  const unclassifiedPurchasePayments = purchases.filter((purchase) => !purchase.paymentMethod).reduce((sum, purchase) => sum + initialPurchasePayment(purchase), 0)
  const customerCash = customerCashAgg._sum.amount || 0
  const supplierCashPayments = supplierCashAgg._sum.amount || 0
  const cashRefunds = saleRefunds.reduce((sum, returned) => sum + (returned.refundAmount ?? returned.total), 0)
  const supplierCashRefunds = purchaseRefunds.reduce((sum, returned) => sum + (returned.refundAmount ?? returned.total), 0)
  const expectedCash = session.openingFloat + cashSales + customerCash + supplierCashRefunds - cashRefunds - cashPurchases - supplierCashPayments

  return {
    invoiceCount: sales.length,
    totalSales: sales.reduce((sum, sale) => sum + sale.total, 0),
    cashSales, cardSales, transferSales, creditSales,
    cashPurchases, supplierCashPayments, customerCash,
    cashRefunds, supplierCashRefunds, unclassifiedPurchasePayments,
    openingFloat: session.openingFloat,
    expectedCash,
    note: 'احتُسبت الحركات النقدية المسجلة على المستخدم والوردية فقط. المدفوعات التاريخية للمشتريات التي لا تحتوي على طريقة دفع محفوظة تظهر منفصلة ولا تُفترض نقدًا.',
  }
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
  const now = new Date()
  const items = await Promise.all(sessions.map(async (session) => {
    if (session.status !== 'open') return session
    return { ...session, ...(await summarizeShift(session, now)) }
  }))
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const parsed = openSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    const pinCheck = await verifyUserPin(user.id, parsed.data.pin)
    if (pinCheck === 'no-pin') return NextResponse.json({ error: 'لم يتم تحديد رقم سري لك بعد — راجع الإدارة' }, { status: 403 })
    if (pinCheck === 'wrong') return NextResponse.json({ error: 'الرقم السري غير صحيح' }, { status: 403 })

    const session = await db.$transaction(async (tx: any) => {
      const existing = await tx.registerSession.findFirst({ where: { userId: user.id, status: 'open' } })
      if (existing) throw new Error('لديك وردية مفتوحة بالفعل')
      return tx.registerSession.create({
        data: { userId: user.id, openingFloat: parsed.data.openingFloat, notes: parsed.data.notes || null, status: 'open' },
      })
    })
    await auditLog({ user, action: 'register_open', entity: 'registerSession', entityId: session.id, after: { openingFloat: session.openingFloat } })
    return NextResponse.json(session, { status: 201 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'خطأ'
    return NextResponse.json({ error: message }, { status: /وردية مفتوحة بالفعل/i.test(message) ? 409 : 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const parsed = closeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    const pinCheck = await verifyUserPin(user.id, parsed.data.pin)
    if (pinCheck === 'no-pin') return NextResponse.json({ error: 'لم يتم تحديد رقم سري لك بعد — راجع الإدارة' }, { status: 403 })
    if (pinCheck === 'wrong') return NextResponse.json({ error: 'الرقم السري غير صحيح' }, { status: 403 })

    const session = await db.registerSession.findUnique({ where: { id: parsed.data.sessionId } })
    if (!session) return NextResponse.json({ error: 'الوردية غير موجودة' }, { status: 404 })
    if (user.role === 'cashier' && session.userId !== user.id) return NextResponse.json({ error: 'لا تملك هذه الوردية' }, { status: 403 })
    if (session.status === 'closed') return NextResponse.json({ error: 'الوردية مغلقة بالفعل' }, { status: 409 })

    const now = new Date()
    const summary = await summarizeShift(session, now)
    const difference = parsed.data.closingFloat - summary.expectedCash
    const updated = await db.$transaction(async (tx: any) => {
      const closed = await tx.registerSession.updateMany({
        where: { id: session.id, status: 'open' },
        data: {
          closedAt: now,
          closingFloat: parsed.data.closingFloat,
          expectedCash: summary.expectedCash,
          difference,
          cashSales: summary.cashSales,
          cardSales: summary.cardSales,
          transferSales: summary.transferSales,
          notes: parsed.data.notes || null,
          status: 'closed',
        },
      })
      if (closed.count !== 1) throw new Error('تم إغلاق الوردية بالفعل أو تغيرت حالتها؛ حدّث الصفحة')
      return tx.registerSession.findUnique({ where: { id: session.id } })
    })
    const report = {
      ...summary,
      sessionId: session.id,
      closingFloat: parsed.data.closingFloat,
      difference,
      closedAt: now.toISOString(),
    }
    await auditLog({ user, action: 'register_close', entity: 'registerSession', entityId: session.id, after: report })
    return NextResponse.json({ ...updated, report })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'خطأ'
    return NextResponse.json({ error: message }, { status: /إغلاق الوردية بالفعل|تغيرت حالتها/i.test(message) ? 409 : 500 })
  }
}
