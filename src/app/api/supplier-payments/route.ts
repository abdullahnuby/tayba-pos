import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { retryOnConflict } from '@/lib/pricing'

const paymentSchema = z.object({
  supplierId: z.string().min(1),
  purchaseId: z.string().optional().nullable(),
  amount: z.number().positive('المبلغ يجب أن يكون موجبًا'),
  method: z.string().default('cash'),
  notes: z.string().optional().nullable(),
})

export async function GET(req: NextRequest) {
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

    // BLOCKER #3 fix: prevent overpayment
    const supplier = await db.supplier.findUnique({
      where: { id: data.supplierId },
      select: { balance: true, name: true },
    })
    if (!supplier) return NextResponse.json({ error: 'المورد غير موجود' }, { status: 404 })

    if (data.amount > supplier.balance + 0.01) {
      return NextResponse.json(
        {
          error: `المبلغ (${data.amount} ج.م) يتجاوز المستحق للمورد "${supplier.name}" (${supplier.balance.toFixed(2)} ج.م). لا يمكن سداد أكثر من المستحق.`,
          currentBalance: supplier.balance,
        },
        { status: 400 }
      )
    }

    // Cloudflare D1 doesn't support interactive transactions — build the
    // operations up front and run them together as one batch transaction.
    const ops = [
      db.supplierPayment.create({
        data: {
          supplierId: data.supplierId,
          purchaseId: data.purchaseId || null,
          amount: data.amount,
          method: data.method,
          notes: data.notes,
        },
      }),
      db.supplier.update({
        where: { id: data.supplierId },
        data: { balance: { decrement: data.amount } },
      }),
      ...(data.purchaseId
        ? [
            db.purchase.update({
              where: { id: data.purchaseId },
              data: { paid: { increment: data.amount } },
            }),
          ]
        : []),
    ]
    const payment = await retryOnConflict(async () => {
      const [created] = await db.$transaction(ops)
      return created
    })

    await auditLog({ user, action: 'payment', entity: 'supplier', entityId: data.supplierId, after: { amount: data.amount } })

    // Auto-sync to Google Sheets (best-effort)
    try {
      const { syncAfterSupplierPayment } = await import('@/lib/sync')
      await syncAfterSupplierPayment()
    } catch (syncErr) {
      console.error('Auto-sync failed (supplier payment):', syncErr)
    }

    return NextResponse.json(payment, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
