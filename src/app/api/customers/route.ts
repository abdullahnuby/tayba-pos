import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

function normalize(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar-EG')
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

  // The POS checkout only needs basic identity fields; do not disclose customer
  // balances, addresses, notes or purchase totals to a cashier.
  if (auth.user.role === 'cashier') {
    const customers = await db.customer.findMany({
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
      take: 1000,
    })
    return NextResponse.json(customers, { headers: { 'Cache-Control': 'no-store' } })
  }

  const customers = await db.customer.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { sales: true } } },
  })
  if (!customers.length) return NextResponse.json([])

  const customerIds = customers.map((customer) => customer.id)
  const [sales, returns, payments] = await Promise.all([
    db.sale.findMany({
      where: { customerId: { in: customerIds }, status: { in: ['completed', 'partial_return', 'returned'] } },
      select: {
        customerId: true,
        total: true,
        paid: true,
        initialPaid: true,
        customerPayments: { select: { amount: true } },
      },
    }),
    db.saleReturn.findMany({
      where: { customerId: { in: customerIds }, status: 'completed' },
      select: { customerId: true, total: true, refundAmount: true, refundMethod: true },
    }),
    db.customerPayment.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, amount: true },
    }),
  ])

  const salesByCustomer = new Map<string, typeof sales>()
  for (const sale of sales) {
    if (!sale.customerId) continue
    const rows = salesByCustomer.get(sale.customerId) || []
    rows.push(sale)
    salesByCustomer.set(sale.customerId, rows)
  }
  const returnsByCustomer = new Map<string, typeof returns>()
  for (const returned of returns) {
    if (!returned.customerId) continue
    const rows = returnsByCustomer.get(returned.customerId) || []
    rows.push(returned)
    returnsByCustomer.set(returned.customerId, rows)
  }
  const paymentsByCustomer = new Map<string, number>()
  for (const payment of payments) {
    paymentsByCustomer.set(payment.customerId, (paymentsByCustomer.get(payment.customerId) || 0) + payment.amount)
  }

  const result = customers.map((customer) => {
    const customerSales = salesByCustomer.get(customer.id) || []
    const customerReturns = returnsByCustomer.get(customer.id) || []
    const grossSales = customerSales.reduce((sum, sale) => sum + sale.total, 0)
    const returnTotal = customerReturns.reduce((sum, returned) => sum + returned.total, 0)
    const originalReceipts = customerSales.reduce((sum, sale) => {
      const linkedCollections = sale.customerPayments.reduce((paid, payment) => paid + payment.amount, 0)
      return sum + (sale.initialPaid ?? Math.max(0, sale.paid - linkedCollections))
    }, 0)
    // Older return rows have no refund metadata. Do not assume they were cash refunds.
    const refunds = customerReturns.reduce((sum, returned) => {
      if (returned.refundAmount != null) return sum + returned.refundAmount
      if (returned.refundMethod && returned.refundMethod !== 'credit') return sum + returned.total
      return sum
    }, 0)
    const totalCollected = Math.max(0, originalReceipts + (paymentsByCustomer.get(customer.id) || 0) - refunds)
    return {
      ...customer,
      totalPurchases: money(grossSales - returnTotal),
      totalPaid: money(totalCollected),
    }
  })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
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
    const duplicate = existing.find((customer) => normalize(customer.name) === normalize(name) && normalize(customer.phone) === normalizedPhone)
    if (duplicate) {
      const safeDuplicate = auth.user.role === 'cashier'
        ? { id: duplicate.id, name: duplicate.name, phone: duplicate.phone }
        : duplicate
      return NextResponse.json({ error: 'العميل موجود بالفعل — لم يتم إنشاء نسخة مكررة', customer: safeDuplicate }, { status: 409 })
    }
    const customer = await db.customer.create({
      data: { name, phone: phone || null, address: auth.user.role === 'cashier' ? null : body.address || null, notes: auth.user.role === 'cashier' ? null : body.notes || null },
    })
    return NextResponse.json(customer, { status: 201 })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 })
  }
}
