import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const item = z.object({ saleItemId: z.string().min(1), variantId: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().min(0) })
const schema = z.object({ saleId: z.string().min(1), idempotencyKey: z.string().min(8).max(120).optional(), reason: z.string().optional().nullable(), notes: z.string().optional().nullable(), refundMethod: z.enum(['cash','card','credit']).default('cash'), items: z.array(item).min(1) })

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role === 'cashier') return NextResponse.json({ error: 'الكاشير لا يملك صلاحية المرتجعات' }, { status: 403 })
  const returns = await db.saleReturn.findMany({ include: { sale: { select: { invoiceNo: true } }, customer: { select: { name: true } }, items: { include: { variant: { include: { product: true } } } } }, orderBy: { date: 'desc' }, take: 300 })
  return NextResponse.json({ items: returns })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['admin','manager'].includes(user.role)) return NextResponse.json({ error: 'لا تملك صلاحية المرتجعات' }, { status: 403 })
    const data = schema.parse(await req.json())
    const rawIdempotencyKey = data.idempotencyKey || req.headers.get('Idempotency-Key') || undefined
    if (rawIdempotencyKey && (rawIdempotencyKey.length < 8 || rawIdempotencyKey.length > 120)) {
      return NextResponse.json({ error: 'مفتاح منع التكرار يجب أن يكون بين 8 و120 حرفًا' }, { status: 400 })
    }
    const idempotencyKey = rawIdempotencyKey ? `${user.id}:${rawIdempotencyKey}` : undefined
    const result = await atomicAction('commit_sale_return', { payload: { saleId: data.saleId, userId: user.id, idempotencyKey, reason: data.reason || null, notes: data.notes || null, refundMethod: data.refundMethod, items: data.items } })
    await auditLog({ user, action: 'return', entity: 'sale', entityId: data.saleId, after: { returnNo: (result as any).returnNo, total: (result as any).total, refundMethod: data.refundMethod } })
    return NextResponse.json(result, { status: 201 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'خطأ في تسجيل المرتجع'
    const clientError = /غير موجود|غير صحيح|تجاوز|المخزون|مرتجع|إرجاع|إرجاع|كمية|فاتورة|إتمام|لا يمكن/i.test(message)
    return NextResponse.json({ error: message }, { status: clientError ? 400 : 500 })
  }
}
