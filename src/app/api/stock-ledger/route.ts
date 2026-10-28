import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

const completedSaleStates = ['completed', 'partial_return', 'returned']

function toEntry(input: {
  id: string
  date: Date
  type: string
  quantityChange: number
  reason?: string | null
  notes?: string | null
  variant: any
  user?: { name: string } | null
  sourceId?: string | null
  invoiceNo?: string | null
}) {
  return {
    id: input.id,
    date: input.date,
    type: input.type,
    quantityChange: input.quantityChange,
    reason: input.reason || input.invoiceNo || null,
    notes: input.notes || null,
    variantId: input.variant.id,
    variant: input.variant,
    user: input.user || null,
    sourceId: input.sourceId || null,
    invoiceNo: input.invoiceNo || null,
  }
}

/**
 * Derive the stock ledger from the same transactional source records used by
 * inventory. This avoids a second, stale ledger table that could drift from
 * the actual balances after an interrupted write.
 */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const url = new URL(req.url)
  const variantId = (url.searchParams.get('variantId') || '').trim()
  const requestedType = (url.searchParams.get('type') || 'all').trim()
  const rawPage = Number(url.searchParams.get('page') || '1')
  const rawPageSize = Number(url.searchParams.get('pageSize') || '100')
  const page = Math.min(1000, Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1))
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(rawPageSize) ? Math.floor(rawPageSize) : 100))
  const take = page * pageSize

  const includeSales = requestedType === 'all' || requestedType === 'sale'
  const includePurchases = requestedType === 'all' || requestedType === 'purchase'
  const includeSaleReturns = requestedType === 'all' || requestedType === 'sale_return' || requestedType === 'return'
  const includePurchaseReturns = requestedType === 'all' || requestedType === 'purchase_return'
  const includeAdjustments = requestedType === 'all' || requestedType === 'stock_adjustment' || requestedType === 'adjustment' || requestedType === 'stocktake'

  const [sales, purchases, saleReturns, purchaseReturns, adjustments, counts] = await Promise.all([
    includeSales ? db.saleItem.findMany({
      where: { ...(variantId ? { variantId } : {}), sale: { status: { in: completedSaleStates } } },
      include: { sale: { select: { id: true, invoiceNo: true, date: true, user: { select: { name: true } } } }, variant: { include: { product: true } } },
      orderBy: { sale: { date: 'desc' } },
      take,
    }) : Promise.resolve([]),
    includePurchases ? db.purchaseItem.findMany({
      where: { ...(variantId ? { variantId } : {}), purchase: { status: 'completed' } },
      include: { purchase: { select: { id: true, invoiceNo: true, date: true, user: { select: { name: true } } } }, variant: { include: { product: true } } },
      orderBy: { purchase: { date: 'desc' } },
      take,
    }) : Promise.resolve([]),
    includeSaleReturns ? db.saleReturnItem.findMany({
      where: { ...(variantId ? { variantId } : {}), saleReturn: { status: 'completed' } },
      include: { saleReturn: { select: { id: true, returnNo: true, date: true, user: { select: { name: true } } } }, variant: { include: { product: true } } },
      orderBy: { saleReturn: { date: 'desc' } },
      take,
    }) : Promise.resolve([]),
    includePurchaseReturns ? db.purchaseReturnItem.findMany({
      where: { ...(variantId ? { variantId } : {}), purchaseReturn: { status: 'completed' } },
      include: { purchaseReturn: { select: { id: true, returnNo: true, date: true, user: { select: { name: true } } } }, variant: { include: { product: true } } },
      orderBy: { purchaseReturn: { date: 'desc' } },
      take,
    }) : Promise.resolve([]),
    includeAdjustments ? db.stockAdjustment.findMany({
      where: {
        ...(variantId ? { variantId } : {}),
        ...(requestedType !== 'all' && !['stock_adjustment', 'adjustment', 'stocktake'].includes(requestedType) ? { type: requestedType } : {}),
      },
      include: { variant: { include: { product: true } }, user: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    }) : Promise.resolve([]),
    Promise.all([
      includeSales ? db.saleItem.count({ where: { ...(variantId ? { variantId } : {}), sale: { status: { in: completedSaleStates } } } }) : 0,
      includePurchases ? db.purchaseItem.count({ where: { ...(variantId ? { variantId } : {}), purchase: { status: 'completed' } } }) : 0,
      includeSaleReturns ? db.saleReturnItem.count({ where: { ...(variantId ? { variantId } : {}), saleReturn: { status: 'completed' } } }) : 0,
      includePurchaseReturns ? db.purchaseReturnItem.count({ where: { ...(variantId ? { variantId } : {}), purchaseReturn: { status: 'completed' } } }) : 0,
      includeAdjustments ? db.stockAdjustment.count({
        where: {
          ...(variantId ? { variantId } : {}),
          ...(requestedType !== 'all' && !['stock_adjustment', 'adjustment', 'stocktake'].includes(requestedType) ? { type: requestedType } : {}),
        },
      }) : 0,
    ]),
  ])

  const items = [
    ...sales.map((item) => toEntry({
      id: `sale:${item.id}`,
      date: item.sale.date,
      type: 'sale',
      quantityChange: -item.quantity,
      variant: item.variant,
      user: item.sale.user,
      sourceId: item.sale.id,
      invoiceNo: item.sale.invoiceNo,
    })),
    ...purchases.map((item) => toEntry({
      id: `purchase:${item.id}`,
      date: item.purchase.date,
      type: 'purchase',
      quantityChange: item.quantity,
      variant: item.variant,
      user: item.purchase.user,
      sourceId: item.purchase.id,
      invoiceNo: item.purchase.invoiceNo,
    })),
    ...saleReturns.map((item) => toEntry({
      id: `sale-return:${item.id}`,
      date: item.saleReturn.date,
      type: 'sale_return',
      quantityChange: item.quantity,
      variant: item.variant,
      user: item.saleReturn.user,
      sourceId: item.saleReturn.id,
      invoiceNo: item.saleReturn.returnNo,
    })),
    ...purchaseReturns.map((item) => toEntry({
      id: `purchase-return:${item.id}`,
      date: item.purchaseReturn.date,
      type: 'purchase_return',
      quantityChange: -item.quantity,
      variant: item.variant,
      user: item.purchaseReturn.user,
      sourceId: item.purchaseReturn.id,
      invoiceNo: item.purchaseReturn.returnNo,
    })),
    ...adjustments.map((item) => toEntry({
      id: `adjustment:${item.id}`,
      date: item.createdAt,
      type: item.type,
      quantityChange: item.quantityChange,
      reason: item.reason,
      notes: item.notes,
      variant: item.variant,
      user: item.user,
      sourceId: item.id,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const offset = (page - 1) * pageSize
  const total = counts.reduce((sum, count) => sum + count, 0)
  return NextResponse.json({
    items: items.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
