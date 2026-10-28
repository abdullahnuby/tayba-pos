import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

function normalize(value: unknown) { return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar-EG') }

export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth
  const customers = await db.customer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { sales: true } } } })
  const result = await Promise.all(customers.map(async (customer) => {
    const [sales, returns, paidAgg] = await Promise.all([
      db.sale.findMany({
        where: { customerId: customer.id, status: { in: ['completed', 'partial_return', 'returned'] } },
        select: {
          total: true, paid: true, initialPaid: true,
          customerPayments: { select: { amount: true } },
        },
      }),
      db.saleReturn.findMany({
        where: { customerId: customer.id, status: 'completed' },
        select: { total: true, refundAmount: true },
      }),
      db.customerPayment.aggregate({
        where: { customerId: customer.id },
        _sum: { amount: true },
      }),
    ])
    const grossSales = sales.reduce((sum, sale) => sum + sale.total, 0)
    const returnTotal = returns.reduce((sum, returned) => sum + returned.total, 0)
    const originalReceipts = sales.reduce((sum, sale) => {
      const linkedCollections = sale.customerPayments.reduce((paid, payment) => paid + payment.amount, 0)
      return sum + (sale.initialPaid ?? Math.max(0, sale.paid - linkedCollections))
    }, 0)
    const refunds = returns.reduce((sum, returned) => sum + (returned.refundAmount ?? returned.total), 0)
    const totalCollected = Math.max(0, originalReceipts + (paidAgg._sum.amount || 0) - refunds)
    return {
      ...customer,
      totalPurchases: Math.round((grossSales - returnTotal + Number.EPSILON) * 100) / 100,
      totalPaid: Math.round((totalCollected + Number.EPSILON) * 100) / 100,
    }
  }))
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth
  try {
    const body = await req.json()
    const name = String(body.name || '').trim()
    const phone = String(body.phone || '').trim()
    if (!name) return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 })
    const existing = await db.customer.findMany({ where: { name: { equals: name } }, take: 20 })
    const normalizedPhone = normalize(phone)
    const duplicate = existing.find(c => normalize(c.name) === normalize(name) && normalize(c.phone) === normalizedPhone)
    if (duplicate) return NextResponse.json({ error: 'العميل موجود بالفعل — لم يتم إنشاء نسخة مكررة', customer: duplicate }, { status: 409 })
    const customer = await db.customer.create({ data: { name, phone: phone || null, address: body.address || null, notes: body.notes || null } })
    return NextResponse.json(customer, { status: 201 })
  } catch (e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 }) }
}
