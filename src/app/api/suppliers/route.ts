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
  const result = await Promise.all(suppliers.map(async (supplier) => {
    const [purchases, returns, paymentsAgg] = await Promise.all([
      db.purchase.findMany({
        where: { supplierId: supplier.id, status: 'completed' },
        select: {
          total: true, paid: true, initialPaid: true,
          supplierPayments: { select: { amount: true } },
        },
      }),
      db.purchaseReturn.findMany({
        where: { supplierId: supplier.id, status: 'completed' },
        select: { total: true, refundAmount: true, refundMethod: true },
      }),
      db.supplierPayment.aggregate({
        where: { supplierId: supplier.id },
        _sum: { amount: true },
      }),
    ])
    const grossPurchases = purchases.reduce((sum, purchase) => sum + purchase.total, 0)
    const returnTotal = returns.reduce((sum, returned) => sum + returned.total, 0)
    const initialPayments = purchases.reduce((sum, purchase) => {
      const linkedPayments = purchase.supplierPayments.reduce((paid, payment) => paid + payment.amount, 0)
      return sum + (purchase.initialPaid ?? Math.max(0, purchase.paid - linkedPayments))
    }, 0)
    const supplierRefunds = returns.reduce((sum, returned) => {
      return sum + (returned.refundAmount ?? (returned.refundMethod === 'cash' ? returned.total : 0))
    }, 0)
    const totalPaid = Math.max(0, initialPayments + (paymentsAgg._sum.amount || 0) - supplierRefunds)
    return {
      ...supplier,
      totalPurchases: Math.round((grossPurchases - returnTotal + Number.EPSILON) * 100) / 100,
      totalPaid: Math.round((totalPaid + Number.EPSILON) * 100) / 100,
    }
  }))
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
