import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

/** Search variants by SKU or barcode — used by POS scanner. */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

  const url = new URL(req.url)
  const search = (url.searchParams.get('search') || '').trim()
  const rawLimit = Number(url.searchParams.get('limit') || '20')
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20))

  if (!search) {
    return NextResponse.json({ items: [] })
  }

  const variants = await db.productVariant.findMany({
    where: {
      OR: [
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ],
    },
    include: { product: { include: { category: true } } },
    take: limit,
  })
  const items = auth.user.role === 'cashier'
    ? variants.map((variant) => {
        const safeVariant: Record<string, unknown> = { ...variant }
        delete safeVariant.costPrice
        delete safeVariant.minQuantity
        delete safeVariant.reorderQty
        delete safeVariant.purchaseUnit
        delete safeVariant.purchaseUnitFactor
        delete safeVariant.baseUnit
        return safeVariant
      })
    : variants

  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}
