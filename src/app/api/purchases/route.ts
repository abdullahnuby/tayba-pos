import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

const purchaseItemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: z.number().min(0.01),
  enteredQuantity: z.number().positive().optional(),
  unit: z.string().optional(),
  unitFactor: z.number().int().positive().optional(),
})

const purchaseSchema = z.object({
  supplierId: z.string().min(1),
  date: z.string().optional(),
  discount: z.number().min(0).default(0),
  paid: z.number().min(0).default(0),
  paymentMethod: z.string().default('cash'),
  notes: z.string().optional().nullable(),
  status: z.enum(['draft', 'completed']).default('completed'),
  items: z.array(purchaseItemSchema).min(1, 'الفاتورة يجب أن تحتوي على بند واحد على الأقل'),
})

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const search = url.searchParams.get('search') || ''
  const page = Number(url.searchParams.get('page') || '1')
  const pageSize = Number(url.searchParams.get('pageSize') || '50')

  const where = search ? {
    OR: [
      { invoiceNo: { contains: search } },
      { supplier: { name: { contains: search } } },
    ],
  } : {}

  const [purchases, total] = await Promise.all([
    db.purchase.findMany({
      where,
      include: { supplier: true, items: { include: { variant: { include: { product: true } } } } },
      orderBy: { date: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.purchase.count({ where }),
  ])
  return NextResponse.json({ items: purchases, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    }
    if (user.role === 'cashier') {
      return NextResponse.json({ error: 'الكاشير لا يملك صلاحية الشراء' }, { status: 403 })
    }
    const body = await req.json()
    const parsed = purchaseSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    }
    const data = parsed.data

    // UI may submit commercial purchase units (e.g. 5 dozen).
    // Persist inventory in the base unit while keeping entered unit metadata.
    const variantIds = [...new Set(data.items.map((i) => i.variantId))]
    const variants = await db.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, sku: true, quantity: true, costPrice: true, purchaseUnit: true, purchaseUnitFactor: true, product: { select: { name: true } } },
    })
    const variantMap = new Map<string, { id: string; sku: string; quantity: number; costPrice: number; purchaseUnit?: string | null; purchaseUnitFactor?: number | null; product: { name: string } }>(
      variants.map((v) => [v.id, v])
    )
    if (variants.length !== variantIds.length) {
      return NextResponse.json({ error: 'بعض المنتجات غير موجودة' }, { status: 400 })
    }
    const normalizedItems = data.items.map((i) => {
      const v = variantMap.get(i.variantId)!
      const factor = Number(i.unitFactor || v.purchaseUnitFactor || 1)
      const enteredQuantity = Number(i.enteredQuantity || i.quantity)
      const baseQuantity = Math.round(enteredQuantity * factor)
      const enteredUnitCost = Number(i.unitCost)
      const baseUnitCost = enteredUnitCost / factor
      return { ...i, quantity: baseQuantity, unitCost: baseUnitCost, enteredQuantity, unit: i.unit || v.purchaseUnit || 'piece', unitFactor: factor, lineTotal: enteredQuantity * enteredUnitCost }
    })
    const subtotal = normalizedItems.reduce((s, i) => s + i.lineTotal, 0)
    if (data.discount > subtotal) {
      return NextResponse.json(
        { error: `الخصم (${data.discount}) يتجاوز الإجمالي الفرعي (${subtotal})` },
        { status: 400 }
      )
    }

    const purchase = await atomicAction<{
      id: string
      invoiceNo: string
      supplierId: string
      subtotal: number
      discount: number
      taxAmount: number
      total: number
      paid: number
      status: string
      date: string
      createdAt: string
      items: unknown[]
    }>('commit_purchase', {
      payload: {
        supplierId: data.supplierId,
        date: data.date || new Date().toISOString(),
        discount: data.discount,
        paid: data.paid,
        paymentMethod: data.paymentMethod,
        status: data.status,
        notes: data.notes || null,
        items: normalizedItems.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          unitCost: i.unitCost,
          enteredQuantity: i.enteredQuantity,
          unit: i.unit,
          unitFactor: i.unitFactor,
        })),
      },
    })

    await auditLog({ user, action: 'create', entity: 'purchase', entityId: purchase.id, after: { invoiceNo: purchase.invoiceNo, total: purchase.total } })

    // Auto-sync to Google Sheets (best-effort, only if completed)
    if (data.status === 'completed') {
      try {
        const { syncAfterPurchase } = await import('@/lib/sync')
        await syncAfterPurchase(data.supplierId)
      } catch (syncErr) {
        console.error('Auto-sync failed (purchase):', syncErr)
      }
    }

    return NextResponse.json(purchase, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'تعارض في رقم الفاتورة' }, { status: 409 })
    }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
