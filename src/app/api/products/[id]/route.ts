import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticate } from '@/lib/auth-middleware'

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  categoryId: z.string().min(1).optional(),
  brandId: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  season: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  variants: z.array(z.object({
    id: z.string().optional(),
    sku: z.string().min(1),
    barcode: z.string().optional().nullable(),
    size: z.string().optional().nullable(),
    color: z.string().optional().nullable(),
    material: z.string().optional().nullable(),
    costPrice: z.number().min(0),
    sellPrice: z.number().min(0),
    quantity: z.number().int().min(0),
    minQuantity: z.number().int().min(0),
    reorderQty: z.number().int().min(0),
    baseUnit: z.string().default('piece'),
    purchaseUnit: z.string().default('piece'),
    purchaseUnitFactor: z.number().int().positive().default(1),
    saleUnit: z.string().default('piece'),
    saleUnitFactor: z.number().int().positive().default(1),
    quarterDozenPrice: z.number().min(0).optional().nullable(),
    halfDozenPrice: z.number().min(0).optional().nullable(),
    dozenPrice: z.number().min(0).optional().nullable(),
  })).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'لا توجد بيانات للتحديث' }
)

export async function GET(req: NextRequest, _ctx: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req, { skipRateLimit: true })
  if (auth instanceof Response) return auth

  const { id } = await _ctx.params
  const product = await db.product.findUnique({
    where: { id },
    include: { category: true, brand: true, variants: true },
  })
  if (!product) return NextResponse.json({ error: 'غير موجود' }, { status: 404 })
  return NextResponse.json(product)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { id } = await params
  try {
    const body = await req.json()
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' }, { status: 400 })
    }
    const { variants, ...updateData } = parsed.data

    // If variants provided, replace them entirely (delete + create)
    if (variants) {
      // Validate SKU uniqueness against existing variants of OTHER products
      const skus = variants.map((v) => v.sku)
      const conflicts = await db.productVariant.findMany({
        where: { sku: { in: skus }, productId: { not: id } },
        select: { sku: true },
      })
      if (conflicts.length > 0) {
        return NextResponse.json(
          { error: `SKU مكرر لمنتج آخر: ${conflicts.map((c) => c.sku).join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Cloudflare D1 doesn't support interactive transactions (a callback that
    // awaits reads/writes one by one). So: do the read up front (outside the
    // transaction), build the full list of write operations, then run them all
    // together as one D1-compatible BATCH transaction (db.$transaction([...])).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: any[] = []

    if (variants) {
      // Reconcile in place — update existing variants by id (preserving their id and
      // any FK references from sales/purchases/stock-adjustments), create only genuinely
      // new rows, and delete only rows the user actually removed from the form.
      // (Previously this deleted ALL variants and recreated them, which silently issued
      // new ids and orphaned every historical sale/purchase/adjustment line for this product.)
      const existing = await db.productVariant.findMany({
        where: { productId: id },
        select: { id: true },
      })
      const existingIds = new Set<string>(existing.map((v: { id: string }) => v.id))
      const incomingIds = new Set(variants.filter((v) => v.id).map((v) => v.id as string))
      const toDelete = [...existingIds].filter((vid) => !incomingIds.has(vid))
      if (toDelete.length) {
        ops.push(db.productVariant.deleteMany({ where: { id: { in: toDelete } } }))
      }
      for (const v of variants) {
        const data = {
          sku: v.sku,
          barcode: v.barcode || null,
          size: v.size || null,
          color: v.color || null,
          material: v.material || null,
          costPrice: v.costPrice,
          sellPrice: v.sellPrice,
          minQuantity: v.minQuantity,
          reorderQty: v.reorderQty,
          baseUnit: v.baseUnit,
          purchaseUnit: v.purchaseUnit,
          purchaseUnitFactor: v.purchaseUnitFactor,
          saleUnit: v.saleUnit,
          saleUnitFactor: v.saleUnitFactor,
          quarterDozenPrice: v.quarterDozenPrice || null,
          halfDozenPrice: v.halfDozenPrice || null,
          dozenPrice: v.dozenPrice || null,
        }
        if (v.id && existingIds.has(v.id)) {
          // Existing variant: update in place, keep its id. Quantity is deliberately
          // NOT overwritten here — live stock is changed only via sales/purchases/
          // stock-adjustments, never by re-saving the product form.
          ops.push(db.productVariant.update({ where: { id: v.id }, data }))
        } else {
          // New variant: create fresh, seeded with the quantity entered in the form.
          ops.push(db.productVariant.create({ data: { ...data, productId: id, quantity: v.quantity } }))
        }
      }
    }
    // Clean nulls
    const cleanUpdate: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(updateData)) {
      cleanUpdate[k] = v === null ? null : v
    }
    ops.push(db.product.update({ where: { id }, data: cleanUpdate, include: { variants: true, category: true, brand: true } }))

    const results = await db.$transaction(ops)
    // The product.update was pushed last, so its result is the last element.
    const updated = results[results.length - 1]

    // Auto-sync to Google Sheets (best-effort)
    try {
      const { syncAfterProduct } = await import('@/lib/sync')
      await syncAfterProduct()
    } catch (syncErr) {
      console.error('Auto-sync failed (product update):', syncErr)
    }

    return NextResponse.json(updated)
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    return NextResponse.json({ error: err.message || 'خطأ في التحديث' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { id } = await params
  try {
    // Check if product has any sales/purchases through variants
    const variantCount = await db.productVariant.count({ where: { productId: id } })
    const variantsWithActivity = await db.productVariant.findMany({
      where: { productId: id, OR: [{ saleItems: { some: {} } }, { purchaseItems: { some: {} } }] },
      select: { sku: true },
      take: 1,
    })
    if (variantsWithActivity.length > 0) {
      return NextResponse.json(
        { error: 'لا يمكن حذف المنتج لأن له variants مرتبطة بفواتير. استخدم الإلغاء بدلاً من الحذف.' },
        { status: 400 }
      )
    }
    await db.product.delete({ where: { id } })

    // Auto-sync to Google Sheets (best-effort)
    try {
      const { syncAfterProduct } = await import('@/lib/sync')
      await syncAfterProduct()
    } catch (syncErr) {
      console.error('Auto-sync failed (product delete):', syncErr)
    }

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    return NextResponse.json({ error: err.message || 'خطأ في الحذف' }, { status: 500 })
  }
}
