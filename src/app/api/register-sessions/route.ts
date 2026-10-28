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
  if (!row?.pinHash) return 'no-pin' // no PIN set yet — admin must set one first
  return verifyPin(pin, row.pinHash) ? 'ok' : 'wrong'
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  const where = user.role === 'cashier' ? { userId: user.id } : {}
  const sessions = await db.registerSession.findMany({ where, include: { user: { select: { name: true, username: true } } }, orderBy: { openedAt: 'desc' }, take: user.role === 'cashier' ? 20 : 100 })

  // Closed sessions already have their final numbers stored — only open
  // sessions need a live (right-now) total, computed the same way the
  // close-shift report computes it, so the card on screen isn't stuck at 0.
  const now = new Date()
  const items = await Promise.all(
    sessions.map(async (s) => {
      if (s.status !== 'open') return s
      const sales = await db.sale.findMany({
        where: { date: { gte: s.openedAt, lte: now }, status: 'completed', userId: s.userId },
        select: { total: true, paid: true, paymentMethod: true },
      })
      const cashSales = sales.filter((x) => x.paymentMethod === 'cash').reduce((sum, x) => sum + x.paid, 0)
      const cardSales = sales.filter((x) => x.paymentMethod === 'card').reduce((sum, x) => sum + x.paid, 0)
      const transferSales = sales.filter((x) => x.paymentMethod === 'transfer').reduce((sum, x) => sum + x.paid, 0)
      const creditSales = sales.filter((x) => x.paymentMethod === 'credit').reduce((sum, x) => sum + x.total, 0)
      return { ...s, cashSales, cardSales, transferSales, creditSales }
    })
  )

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
      return tx.registerSession.create({ data: { userId: user.id, openingFloat: parsed.data.openingFloat, notes: parsed.data.notes || null, status: 'open' } })
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
    const pinCheck2 = await verifyUserPin(user.id, parsed.data.pin)
    if (pinCheck2 === 'no-pin') return NextResponse.json({ error: 'لم يتم تحديد رقم سري لك بعد — راجع الإدارة' }, { status: 403 })
    if (pinCheck2 === 'wrong') return NextResponse.json({ error: 'الرقم السري غير صحيح' }, { status: 403 })

    const session = await db.registerSession.findUnique({ where: { id: parsed.data.sessionId } })
    if (!session) return NextResponse.json({ error: 'الوردية غير موجودة' }, { status: 404 })
    if (user.role === 'cashier' && session.userId !== user.id) return NextResponse.json({ error: 'لا تملك هذه الوردية' }, { status: 403 })
    if (session.status === 'closed') return NextResponse.json({ error: 'الوردية مغلقة بالفعل' }, { status: 409 })

    const now = new Date()
    const sales = await db.sale.findMany({
      where: { date: { gte: session.openedAt, lte: now }, status: { in: ['completed', 'partial_return', 'returned'] }, userId: session.userId },
      select: { invoiceNo: true, total: true, paid: true, paymentMethod: true },
    })
    const cashSales = sales.filter((sale) => sale.paymentMethod === 'cash').reduce((sum, sale) => sum + sale.paid, 0)
    const cardSales = sales.filter((sale) => sale.paymentMethod === 'card').reduce((sum, sale) => sum + sale.paid, 0)
    const transferSales = sales.filter((sale) => sale.paymentMethod === 'transfer').reduce((sum, sale) => sum + sale.paid, 0)
    const creditSales = sales.filter((sale) => sale.paymentMethod === 'credit').reduce((sum, sale) => sum + sale.total, 0)

    // Only cash collections made by this operator count toward this drawer.
    // Legacy rows without userId remain in the ledger but are not guessed onto a shift.
    const customerCash = (await db.customerPayment.aggregate({
      where: { date: { gte: session.openedAt, lte: now }, method: 'cash', userId: session.userId },
      _sum: { amount: true },
    }))._sum.amount || 0
    const saleCashRefunds = await db.saleReturn.findMany({
      where: { date: { gte: session.openedAt, lte: now }, status: 'completed', refundMethod: 'cash', userId: session.userId },
      select: { total: true },
    })
    const purchaseCashRefunds = await db.purchaseReturn.findMany({
      where: { date: { gte: session.openedAt, lte: now }, status: 'completed', refundMethod: 'cash', userId: session.userId },
      select: { refundAmount: true },
    })
    const cashRefunds = saleCashRefunds.reduce((sum, returned) => sum + returned.total, 0)
    const supplierCashRefunds = purchaseCashRefunds.reduce((sum, returned) => sum + returned.refundAmount, 0)
    const expectedCash = session.openingFloat + cashSales + customerCash + supplierCashRefunds - cashRefunds
    const difference = parsed.data.closingFloat - expectedCash
    const updated = await db.$transaction(async (tx: any) => {
      const closed = await tx.registerSession.updateMany({
        where: { id: session.id, status: 'open' },
        data: { closedAt: now, closingFloat: parsed.data.closingFloat, expectedCash, difference, cashSales, cardSales, transferSales, notes: parsed.data.notes || null, status: 'closed' },
      })
      if (closed.count !== 1) throw new Error('تم إغلاق الوردية بالفعل أو تغيرت حالتها؛ حدّث الصفحة')
      return tx.registerSession.findUnique({ where: { id: session.id } })
    })
    const report = { invoiceCount: sales.length, cashSales, cardSales, transferSales, creditSales, customerCash, cashRefunds, supplierCashRefunds, openingFloat: session.openingFloat, expectedCash, closingFloat: parsed.data.closingFloat, difference, totalSales: sales.reduce((sum, sale) => sum + sale.total, 0), closedAt: now.toISOString(), note: 'التحصيلات النقدية المنسوبة للمستخدم فقط تدخل في درج الوردية؛ التحصيلات القديمة غير المنسوبة لا تُحمّل على وردية بعينها.' }
    await auditLog({ user, action: 'register_close', entity: 'registerSession', entityId: session.id, after: report })
    return NextResponse.json({ ...updated, report })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'خطأ'
    return NextResponse.json({ error: message }, { status: /إغلاق الوردية بالفعل|تغيرت حالتها/i.test(message) ? 409 : 500 })
  }
}
