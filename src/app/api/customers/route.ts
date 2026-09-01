import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

function normalize(value: unknown) { return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ar-EG') }

export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth
  const customers = await db.customer.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { sales: true } } } })
  const result = await Promise.all(customers.map(async c => {
    const [agg, paidAgg] = await Promise.all([
      db.sale.aggregate({ where: { customerId: c.id, status: { not: 'voided' } }, _sum: { total: true } }),
      db.customerPayment.aggregate({ where: { customerId: c.id }, _sum: { amount: true } }),
    ])
    return { ...c, totalPurchases: agg._sum.total || 0, totalPaid: paidAgg._sum.amount || 0 }
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
