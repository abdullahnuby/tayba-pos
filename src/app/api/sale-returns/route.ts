import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const returnItemSchema = z.object({
  saleItemId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().min(0),
})

const returnSchema = z.object({
  saleId: z.string().min(1),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(returnItemSchema).min(1, 'المرتجع يجب أن يحتوي على بند واحد على الأقل'),
})

export async function GET() {
  const returns = await db.saleReturn.findMany({
    include: {
      sale: { select: { invoiceNo: true } },
      customer: { select: { name: true } },
      items: { include: { variant: { include: { product: true } } } },
    },
    orderBy: { date: 'desc' },
  })
  return NextResponse.json({ items: returns })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const body = await req.json()
    const parsed = returnSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    }
    const data = parsed.data

    const saleReturn = await atomicAction<{
      id: string
      returnNo: string
      saleId: string
      customerId?: string | null
      total: number
    }>('commit_sale_return', {
      payload: {
        saleId: data.saleId,
        reason: data.reason || null,
        notes: data.notes || null,
        items: data.items,
      },
    })

    await auditLog({ user, action: 'return', entity: 'sale', entityId: data.saleId, after: { returnNo: saleReturn.returnNo, total: saleReturn.total } })

    // Auto-sync to Google Sheets (best-effort)
    try {
      const { syncAfterReturn } = await import('@/lib/sync')
      await syncAfterReturn(saleReturn.customerId || null)
    } catch (syncErr) {
      console.error('Auto-sync failed (return):', syncErr)
    }

    return NextResponse.json(saleReturn, { status: 201 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
