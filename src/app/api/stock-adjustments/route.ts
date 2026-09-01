import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const adjustmentSchema = z.object({
  variantId: z.string().min(1),
  type: z.enum(['damage', 'theft', 'stocktake', 'sample', 'transfer_in', 'transfer_out', 'adjustment']),
  quantityChange: z.number().int(),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export async function GET() {
  const adjustments = await db.stockAdjustment.findMany({
    include: {
      variant: { include: { product: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ items: adjustments })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    const body = await req.json()
    const parsed = adjustmentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    }
    const data = parsed.data

    const adjustment = await atomicAction<{ id: string; variantId: string; type: string; quantityChange: number }>('commit_stock_adjustment', {
      payload: {
        variantId: data.variantId,
        userId: user?.id || null,
        type: data.type,
        quantityChange: data.quantityChange,
        reason: data.reason || null,
        notes: data.notes || null,
      },
    })
    await auditLog({ user, action: 'stock_adjust', entity: 'variant', entityId: data.variantId, after: { type: data.type, change: data.quantityChange } })

    // Auto-sync to Google Sheets (best-effort)
    try {
      const { syncAfterAdjustment } = await import('@/lib/sync')
      await syncAfterAdjustment()
    } catch (syncErr) {
      console.error('Auto-sync failed (stock adjustment):', syncErr)
    }

    return NextResponse.json(adjustment, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
