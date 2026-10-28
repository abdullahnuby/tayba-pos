import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const paymentSchema = z.object({
  idempotencyKey: z.string().min(8).max(120).optional(),
  supplierId: z.string().min(1),
  purchaseId: z.string().optional().nullable(),
  amount: z.number().positive('المبلغ يجب أن يكون موجبًا'),
  method: z.string().default('cash'),
  notes: z.string().optional().nullable(),
})

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role === 'cashier') return NextResponse.json({ error: 'الكاشير لا يملك صلاحية عرض مدفوعات الموردين' }, { status: 403 })

  const url = new URL(req.url)
  const supplierId = url.searchParams.get('supplierId')
  const where = supplierId ? { supplierId } : {}
  const payments = await db.supplierPayment.findMany({
    where,
    include: { supplier: { select: { name: true } }, purchase: { select: { invoiceNo: true } } },
    orderBy: { date: 'desc' },
    take: 200,
  })
  return NextResponse.json({ items: payments })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    if (user.role === 'cashier') {
      return NextResponse.json({ error: 'الكاشير لا يملك صلاحية سداد الموردين' }, { status: 403 })
    }
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
        const existing = await tx.supplierPayment.findUnique({ where: { idempotencyKey } })
        if (existing) return existing
      }
      const supplier = await tx.supplier.findUnique({
        where: { id: data.supplierId },
        select: { id: true, name: true, balance: true },
      })
      if (!supplier) throw new Error('المورد غير موجود')
      if (data.amount > supplier.balance + 0.001) {
        throw new Error(`المبلغ يتجاوز المستحق للمورد "${supplier.name}" (${supplier.balance.toFixed(2)} ج.م)`)
      }

      if (data.purchaseId) {
        const purchase = await tx.purchase.findUnique({
          where: { id: data.purchaseId },
          select: { id: true, supplierId: true, total: true, paid: true, status: true },
        })
        if (!purchase || purchase.supplierId !== data.supplierId) throw new Error('فاتورة الشراء لا تخص هذا المورد')
        if (purchase.status !== 'completed') throw new Error('لا يمكن سداد فاتورة شراء غير مكتملة')
        if (data.amount > Math.max(0, purchase.total - purchase.paid) + 0.001) throw new Error('المبلغ يتجاوز المتبقي على فاتورة الشراء')
      }

      const deducted = await tx.supplier.updateMany({
        where: { id: data.supplierId, balance: { gte: data.amount } },
        data: { balance: { decrement: data.amount }, updatedAt: new Date() },
      })
      if (deducted.count !== 1) throw new Error('تغير رصيد المورد أثناء السداد؛ حدّث الصفحة وحاول مرة أخرى')

      if (data.purchaseId) {
        await tx.purchase.update({ where: { id: data.purchaseId }, data: { paid: { increment: data.amount } } })
      }

      return tx.supplierPayment.create({
        data: {
          userId: user.id,
          idempotencyKey: idempotencyKey || null,
          supplierId: data.supplierId,
          purchaseId: data.purchaseId || null,
          amount: data.amount,
          method: data.method,
          notes: data.notes || null,
        },
      })
    })

    await auditLog({ user, action: 'payment', entity: 'supplier', entityId: data.supplierId, after: { amount: data.amount } })

    return NextResponse.json(payment, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    const message = err.message || 'خطأ'
    return NextResponse.json({ error: message }, { status: /غير موجود|لا تخص|يتجاوز|تغير رصيد|لا يمكن سداد/i.test(message) ? 400 : 500 })
  }
}
