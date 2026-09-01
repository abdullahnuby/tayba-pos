import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const suppliers = await db.supplier.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { purchases: true } } },
  })
  const result = await Promise.all(
    suppliers.map(async (s) => {
      const agg = await db.purchase.aggregate({
        where: { supplierId: s.id, status: 'completed' },
        _sum: { total: true },
      })
      const paidAgg = await db.supplierPayment.aggregate({
        where: { supplierId: s.id },
        _sum: { amount: true },
      })
      return {
        ...s,
        totalPurchases: agg._sum.total || 0,
        totalPaid: paidAgg._sum.amount || 0,
      }
    })
  )
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const { name, phone, address, notes } = body
    if (!name) return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 })
    const supplier = await db.supplier.create({
      data: { name, phone: phone || null, address: address || null, notes: notes || null },
    })
    return NextResponse.json(supplier, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
