import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'

// Zod schemas — strict validation
const variantSchema = z.object({
  id: z.string().optional(),
  sku: z.string().min(1),
  barcode: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  costPrice: z.number().min(0).default(0),
  sellPrice: z.number().min(0).default(0),
  quantity: z.number().int().min(0).default(0),
  minQuantity: z.number().int().min(0).default(5),
  reorderQty: z.number().int().min(0).default(10),
  baseUnit: z.string().default('piece'),
  purchaseUnit: z.string().default('piece'),
  purchaseUnitFactor: z.number().int().positive().default(1),
  saleUnit: z.string().default('piece'),
  saleUnitFactor: z.number().int().positive().default(1),
  quarterDozenPrice: z.number().min(0).optional().nullable(),
  halfDozenPrice: z.number().min(0).optional().nullable(),
  dozenPrice: z.number().min(0).optional().nullable(),
})

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  categoryId: z.string().min(1),
  brandId: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  season: z.string().optional().nullable(),
  material: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  variants: z.array(variantSchema).min(1, 'يجب إضافة variant واحد على الأقل'),
})

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  const url = new URL(req.url)
  const search = url.searchParams.get('search') || ''
  const categoryId = url.searchParams.get('categoryId')
  const page = Number(url.searchParams.get('page') || '1')
  const pageSize = Number(url.searchParams.get('pageSize') || '50')

  const where: {
    OR?: Array<{ name?: { contains: string }; description?: { contains: string }; variants?: { some: { sku?: { contains: string }; barcode?: { contains: string } } } }>
    categoryId?: string
  } = {}
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { variants: { some: { sku: { contains: search } } } },
      { variants: { some: { barcode: { contains: search } } } },
    ]
  }
  if (categoryId && categoryId !== 'all') where.categoryId = categoryId

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        category: true,
        brand: true,
        variants: { orderBy: { size: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.product.count({ where }),
  ])

  return NextResponse.json({ items: products, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    if (user.role === 'cashier') {
      return NextResponse.json({ error: 'الكاشير لا يملك صلاحية إضافة المنتجات' }, { status: 403 })
    }
    const body = await req.json()
    const parsed = productSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' },
        { status: 400 }
      )
    }
    const { variants, ...productData } = parsed.data

    // Validate SKU uniqueness
    const skus = variants.map((v) => v.sku)
    if (new Set(skus).size !== skus.length) {
      return NextResponse.json({ error: 'SKUs مكررة في نفس المنتج' }, { status: 400 })
    }
    const existingSkus = await db.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { sku: true },
    })
    if (existingSkus.length > 0) {
      return NextResponse.json(
        { error: `SKU مكرر: ${existingSkus.map((s) => s.sku).join(', ')}` },
        { status: 400 }
      )
    }

    const product = await db.product.create({
      data: {
        ...productData,
        brandId: productData.brandId || null,
        gender: productData.gender || null,
        season: productData.season || null,
        material: productData.material || null,
        image: productData.image || null,
        description: productData.description || null,
        variants: {
          create: variants.map((v) => ({
            sku: v.sku,
            barcode: v.barcode || null,
            size: v.size || null,
            color: v.color || null,
            material: v.material || null,
            costPrice: v.costPrice,
            sellPrice: v.sellPrice,
            quantity: v.quantity,
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
          })),
        },
      },
      include: { variants: true, category: true, brand: true },
    })

    // Auto-sync to Google Sheets (best-effort)
    try {
      const { syncAfterProduct } = await import('@/lib/sync')
      await syncAfterProduct()
    } catch (syncErr) {
      console.error('Auto-sync failed (product create):', syncErr)
    }

    return NextResponse.json(product, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    return NextResponse.json({ error: err.message || 'خطأ في الإنشاء' }, { status: 500 })
  }
}
