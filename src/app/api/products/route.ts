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
  const rawPage = Number(url.searchParams.get('page') || '1')
  const rawPageSize = Number(url.searchParams.get('pageSize') || '50')
  const page = Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1)
  const pageSize = Math.min(1000, Math.max(1, Number.isFinite(rawPageSize) ? Math.floor(rawPageSize) : 50))

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

  const items = user.role === 'cashier'
    ? products.map((product) => ({
        ...product,
        variants: product.variants.map((variant) => {
          const safeVariant: Record<string, unknown> = { ...variant }
          delete safeVariant.costPrice
          delete safeVariant.minQuantity
          delete safeVariant.reorderQty
          delete safeVariant.purchaseUnit
          delete safeVariant.purchaseUnitFactor
          delete safeVariant.baseUnit
          return safeVariant
        }),
      }))
    : products

  return NextResponse.json({ items, total, page, pageSize }, { headers: { 'Cache-Control': 'no-store' } })
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

    const barcodes = variants.map((v) => v.barcode?.trim() || '').filter(Boolean)
    if (new Set(barcodes).size !== barcodes.length) {
      return NextResponse.json({ error: 'باركود مكرر داخل المنتج' }, { status: 400 })
    }
    if (barcodes.length > 0) {
      const existingBarcodes = await db.productVariant.findMany({
        where: { barcode: { in: barcodes } },
        select: { barcode: true },
      })
      if (existingBarcodes.length > 0) {
        return NextResponse.json(
          { error: `باركود مستخدم مسبقًا: ${existingBarcodes.map((item) => item.barcode).filter(Boolean).join(', ')}` },
          { status: 400 }
        )
      }
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
            barcode: v.barcode?.trim() || null,
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

    return NextResponse.json(product, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    return NextResponse.json({ error: err.message || 'خطأ في الإنشاء' }, { status: 500 })
  }
}
