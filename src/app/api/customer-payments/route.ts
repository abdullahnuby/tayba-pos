import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const paymentSchema = z.object({
  idempotencyKey: z.string().min(8).max(120).optional(),
  customerId: z.string().min(1),
  saleId: z.string().optional().nullable(),
  amount: z.number().positive('المبلغ يجب أن يكون موجبًا'),
  method: z.string().default('cash'),
  notes: z.string().optional().nullable(),
})

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role === 'cashier') return NextResponse.json({ error: 'الكاشير لا يملك صلاحية عرض تحصيلات العملاء' }, { status: 403 })

  const url = new URL(req.url)
  const customerId = url.searchParams.get('customerId')
  const where = customerId ? { customerId } : {}
  const payments = await db.customerPayment.findMany({
    where,
    include: { customer: { select: { name: true } }, sale: { select: { invoiceNo: true } } },
    orderBy: { date: 'desc' },
    take: 200,
  })
  return NextResponse.json({ items: payments })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const body = await req.json()
    const parsed = paymentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    }
    const data = parsed.data
    const rawIdempotencyKey = data.idempotencyKey || req.headers.get('Idempotency-Key') || undefined
    if (rawIdempotencyKey && (rawIdempotencyKey.length < 8 || rawIdempotencyKey.length > 120)) {
      return NextResponse.json({ error: 'مفتاح منع التكرار يجب أن يكون بين 8 و120 حرفًا' }, { status: 400 })
    }
    const idempotencyKey = rawIdempotencyKey ? `${user.id}:${rawIdempotencyKey}` : undefined

    const payment = await db.$transaction(async (tx: any) => {
      if (idempotencyKey) {
        const existing = await tx.customerPayment.findUnique({ where: { idempotencyKey } })
        if (existing) return existing
      }
      const customer = await tx.customer.findUnique({
        where: { id: data.customerId },
        select: { id: true, name: true, balance: true },
      })
      if (!customer) throw new Error('العميل غير موجود')
      if (data.amount > customer.balance + 0.001) {
        throw new Error(`المبلغ يتجاوز المستحق على العميل "${customer.name}" (${customer.balance.toFixed(2)} ج.م)`)
      }

      if (data.saleId) {
        const sale = await tx.sale.findUnique({
          where: { id: data.saleId },
          select: { id: true, customerId: true, total: true, paid: true, status: true },
        })
        if (!sale || sale.customerId !== data.customerId) throw new Error('الفاتورة لا تخص هذا العميل')
        if (!['completed', 'partial_return'].includes(sale.status)) throw new Error('لا يمكن تحصيل مبلغ على هذه الفاتورة')
        if (data.amount > Math.max(0, sale.total - sale.paid) + 0.001) throw new Error('المبلغ يتجاوز المتبقي على الفاتورة')
      }

      const deducted = await tx.customer.updateMany({
        where: { id: data.customerId, balance: { gte: data.amount } },
        data: { balance: { decrement: data.amount }, updatedAt: new Date() },
      })
      if (deducted.count !== 1) throw new Error('تغير رصيد العميل أثناء التحصيل؛ حدّث الصفحة وحاول مرة أخرى')

      if (data.saleId) {
        await tx.sale.update({ where: { id: data.saleId }, data: { paid: { increment: data.amount } } })
      }

      return tx.customerPayment.create({
        data: {
          userId: user.id,
          idempotencyKey: idempotencyKey || null,
          customerId: data.customerId,
          saleId: data.saleId || null,
          amount: data.amount,
          method: data.method,
          notes: data.notes || null,
        },
      })
    })

    await auditLog({ user, action: 'payment', entity: 'customer', entityId: data.customerId, after: { amount: data.amount } })

    return NextResponse.json(payment, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    const message = err.message || 'خطأ'
    return NextResponse.json({ error: message }, { status: /غير موجود|لا تخص|يتجاوز|تغير رصيد|لا يمكن تحصيل/i.test(message) ? 400 : 500 })
  }
}
