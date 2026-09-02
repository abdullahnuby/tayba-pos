import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { retryOnConflict } from '@/lib/pricing'

const paymentSchema = z.object({
  customerId: z.string().min(1),
  saleId: z.string().optional().nullable(),
  amount: z.number().positive('المبلغ يجب أن يكون موجبًا'),
  method: z.string().default('cash'),
  notes: z.string().optional().nullable(),
})

export async function GET(req: NextRequest) {
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

    // BLOCKER #3 fix: prevent overpayment
    const customer = await db.customer.findUnique({
      where: { id: data.customerId },
      select: { balance: true, name: true },
    })
    if (!customer) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 })

    if (data.amount > customer.balance + 0.01) {
      return NextResponse.json(
        {
          error: `المبلغ (${data.amount} ج.م) يتجاوز المستحق على العميل "${customer.name}" (${customer.balance.toFixed(2)} ج.م). لا يمكن تحصيل أكثر من المستحق.`,
          currentBalance: customer.balance,
        },
        { status: 400 }
      )
    }

    // Cloudflare D1 doesn't support interactive transactions — build the
    // operations up front and run them together as one batch transaction.
    const ops = [
      db.customerPayment.create({
        data: {
          customerId: data.customerId,
          saleId: data.saleId || null,
          amount: data.amount,
          method: data.method,
          notes: data.notes,
        },
      }),
      db.customer.update({
        where: { id: data.customerId },
        data: { balance: { decrement: data.amount } },
      }),
      ...(data.saleId
        ? [
            db.sale.update({
              where: { id: data.saleId },
              data: { paid: { increment: data.amount } },
            }),
          ]
        : []),
    ]
    const payment = await retryOnConflict(async () => {
      const [created] = await db.$transaction(ops)
      return created
    })

    await auditLog({ user, action: 'payment', entity: 'customer', entityId: data.customerId, after: { amount: data.amount } })

    // Auto-sync to Google Sheets (best-effort)
    try {
      const { syncAfterCustomerPayment } = await import('@/lib/sync')
      await syncAfterCustomerPayment()
    } catch (syncErr) {
      console.error('Auto-sync failed (customer payment):', syncErr)
    }

    return NextResponse.json(payment, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
