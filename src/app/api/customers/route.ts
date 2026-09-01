import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

  const customers = await db.customer.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { sales: true } } },
  })
  const result = await Promise.all(
    customers.map(async (c) => {
      const [agg, paidAgg] = await Promise.all([
        db.sale.aggregate({
          where: { customerId: c.id, status: { not: 'voided' } },
          _sum: { total: true },
        }),
        db.customerPayment.aggregate({
          where: { customerId: c.id },
          _sum: { amount: true },
        }),
      ])
      return {
        ...c,
        totalPurchases: agg._sum.total || 0,
        totalPaid: paidAgg._sum.amount || 0,
      }
    })
  )
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const { name, phone, address, notes } = body
    if (!name) return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 })
    const customer = await db.customer.create({
      data: { name, phone: phone || null, address: address || null, notes: notes || null },
    })
    return NextResponse.json(customer, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
