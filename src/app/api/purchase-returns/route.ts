import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const itemSchema = z.object({ purchaseItemId: z.string().min(1), quantity: z.number().int().positive() })
const schema = z.object({
  idempotencyKey: z.string().min(8).max(200).optional(),
  purchaseId: z.string().min(1),
  supplierId: z.string().optional(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  refundMethod: z.enum(['cash', 'card', 'transfer', 'credit']).default('credit'),
  refundAmount: z.number().min(0).optional(),
  items: z.array(itemSchema).min(1, 'المرتجع يجب أن يحتوي على بند واحد على الأقل'),
})

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  const purchaseId = new URL(req.url).searchParams.get('purchaseId')
  const returns = await db.purchaseReturn.findMany({
    where: purchaseId ? { purchaseId } : {},
    include: { supplier: { select: { name: true } }, purchase: { select: { invoiceNo: true } }, items: { include: { variant: { include: { product: true } } } } },
    orderBy: { date: 'desc' },
  })
  return NextResponse.json({ items: returns })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    if (user.role === 'cashier') return NextResponse.json({ error: 'الكاشير لا يملك صلاحية مرتجعات الشراء' }, { status: 403 })
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    const data = { ...parsed.data, idempotencyKey: parsed.data.idempotencyKey || req.headers.get('Idempotency-Key') || undefined }
    const result = await atomicAction<any>('commit_purchase_return', { payload: { ...data, userId: user.id } })
    await auditLog({ user, action: 'return', entity: 'purchase', entityId: data.purchaseId, after: { returnNo: result.returnNo, total: result.total, refundMethod: result.refundMethod } })
    return NextResponse.json(result, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    const message = err.message || 'خطأ في مرتجع الشراء'
    return NextResponse.json({ error: message }, { status: /المخزون|المرتجع|المورد|فاتورة|استرداد/.test(message) ? 400 : 500 })
  }
}
