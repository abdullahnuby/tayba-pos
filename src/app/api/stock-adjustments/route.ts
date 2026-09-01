import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const itemSchema = z.object({ variantId: z.string().min(1), quantityChange: z.number().int(), reason: z.string().optional().nullable(), notes: z.string().optional().nullable(), type: z.enum(['damage','theft','stocktake','sample','transfer_in','transfer_out','adjustment']).default('stocktake') })
const schema = z.object({ variantId: z.string().optional(), quantityChange: z.number().int().optional(), reason: z.string().optional().nullable(), notes: z.string().optional().nullable(), type: z.enum(['damage','theft','stocktake','sample','transfer_in','transfer_out','adjustment']).optional(), bulk: z.boolean().optional(), mode: z.enum(['stocktake','opening']).optional(), items: z.array(itemSchema).optional() })

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role === 'cashier') return NextResponse.json({ error: 'الكاشير لا يملك صلاحية الجرد' }, { status: 403 })
  const adjustments = await db.stockAdjustment.findMany({ include: { variant: { include: { product: true } }, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 300 })
  return NextResponse.json({ items: adjustments })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['admin','manager'].includes(user.role)) return NextResponse.json({ error: 'لا تملك صلاحية تعديل المخزون' }, { status: 403 })
    const data = schema.parse(await req.json())
    const items = data.bulk && data.items?.length ? data.items : (data.variantId ? [{ variantId: data.variantId, quantityChange: data.quantityChange || 0, reason: data.reason, notes: data.notes, type: data.type || 'adjustment' }] : [])
    if (!items.length) return NextResponse.json({ error: 'لم يتم إرسال أصناف' }, { status: 400 })
    const applied: unknown[] = []
    for (const item of items) {
      if (!item.quantityChange) continue
      const result = await atomicAction('commit_stock_adjustment', { payload: { variantId: item.variantId, userId: user.id, type: item.type || (data.mode === 'opening' ? 'adjustment' : 'stocktake'), quantityChange: item.quantityChange, reason: item.reason || (data.mode === 'opening' ? 'رصيد افتتاحي' : 'جرد'), notes: item.notes || null } })
      applied.push(result)
      await auditLog({ user, action: 'stock_adjust', entity: 'variant', entityId: item.variantId, after: { type: item.type || 'stocktake', change: item.quantityChange } })
    }
    try { const { syncAfterAdjustment } = await import('@/lib/sync'); await syncAfterAdjustment() } catch {}
    return NextResponse.json({ ok: true, applied: applied.length, items: applied }, { status: 201 })
  } catch (e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 }) }
}
