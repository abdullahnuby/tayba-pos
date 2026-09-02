import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getD1Binding } from '@/lib/d1-atomic'
import { getCurrentUser } from '@/lib/auth'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  const todaySalesAgg = await db.sale.aggregate({
    where: { date: { gte: startOfToday, lte: endOfToday }, status: 'completed' },
    _sum: { total: true },
  })

  const todaySaleItems = await db.saleItem.findMany({
    where: { sale: { date: { gte: startOfToday, lte: endOfToday }, status: 'completed' } },
    select: { unitPrice: true, unitCost: true, quantity: true },
  })
  let todayProfit = 0
  for (const it of todaySaleItems) {
    todayProfit += (it.unitPrice - it.unitCost) * it.quantity
  }

  const todaySalesCount = await db.sale.count({
    where: { date: { gte: startOfToday, lte: endOfToday }, status: 'completed' },
  })

  // Prisma cannot express quantity <= minQuantity/reorderQty here.
  // D1 SQL compares the two columns directly.
  const d1 = getD1Binding()
  if (!d1) throw new Error('لا يوجد اتصال Cloudflare D1')

  const lowStockCountResult = await d1
    .prepare('SELECT COUNT(*) AS count FROM "ProductVariant" WHERE quantity <= minQuantity')
    .all<{ count: number }>()
  const lowStockCount = Number(lowStockCountResult.results?.[0]?.count ?? 0)

  const outOfStockCount = await db.productVariant.count({ where: { quantity: 0 } })

  const variants = await db.productVariant.findMany({
    select: { costPrice: true, sellPrice: true, quantity: true },
  })
  const inventoryValue = variants.reduce((s, v) => s + v.costPrice * v.quantity, 0)
  const retailValue = variants.reduce((s, v) => s + v.sellPrice * v.quantity, 0)

  const customerBalances = await db.customer.aggregate({ _sum: { balance: true } })
  const supplierBalances = await db.supplier.aggregate({ _sum: { balance: true } })

  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  const recentSales = await db.sale.findMany({
    where: { date: { gte: sevenDaysAgo }, status: 'completed' },
    select: { date: true, total: true },
  })
  const recentItems = await db.saleItem.findMany({
    where: { sale: { date: { gte: sevenDaysAgo }, status: 'completed' } },
    select: { unitPrice: true, unitCost: true, quantity: true, sale: { select: { date: true } } },
  })

  const trendMap = new Map<string, { sales: number; profit: number }>()
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo)
    d.setDate(sevenDaysAgo.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    trendMap.set(key, { sales: 0, profit: 0 })
  }
  for (const s of recentSales) {
    const key = s.date.toISOString().slice(0, 10)
    if (trendMap.has(key)) trendMap.get(key)!.sales += s.total
  }
  for (const it of recentItems) {
    const key = it.sale.date.toISOString().slice(0, 10)
    if (trendMap.has(key)) trendMap.get(key)!.profit += (it.unitPrice - it.unitCost) * it.quantity
  }

  const salesTrend = Array.from(trendMap.entries()).map(([date, v]) => ({
    date,
    label: new Date(date).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric' }),
    sales: Math.round(v.sales),
    profit: Math.round(v.profit),
  }))

  const allSaleItems = await db.saleItem.findMany({
    where: { sale: { status: 'completed' } },
    select: { variantId: true, quantity: true, total: true, unitPrice: true, unitCost: true },
  })
  const prodMap = new Map<string, { qty: number; revenue: number; profit: number }>()
  for (const it of allSaleItems) {
    const cur = prodMap.get(it.variantId) || { qty: 0, revenue: 0, profit: 0 }
    cur.qty += it.quantity
    cur.revenue += it.total
    cur.profit += (it.unitPrice - it.unitCost) * it.quantity
    prodMap.set(it.variantId, cur)
  }

  const topVariantIds = Array.from(prodMap.entries())
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5)

  const topVariants = await Promise.all(
    topVariantIds.map(async ([vid, v]) => {
      const variant = await db.productVariant.findUnique({
        where: { id: vid },
        select: { sku: true, size: true, color: true, product: { select: { name: true } } },
      })
      return {
        name: variant?.product.name || '—',
        sku: variant?.sku || '—',
        size: variant?.size || '',
        color: variant?.color || '',
        qty: v.qty,
        revenue: v.revenue,
        profit: v.profit,
      }
    })
  )

  const recentSaleList = await db.sale.findMany({
    take: 5,
    where: { status: { in: ['completed', 'partial_return'] } },
    orderBy: { date: 'desc' },
    include: { customer: true, items: true },
  })

  const lowStockListResult = await d1
    .prepare(`
      SELECT pv.id, p.name AS name, pv.sku, pv.size, pv.color,
             pv.quantity, pv.minQuantity, pv.reorderQty,
             c.name AS category
      FROM "ProductVariant" pv
      JOIN "Product" p ON p.id = pv.productId
      LEFT JOIN "Category" c ON c.id = p.categoryId
      WHERE pv.quantity <= pv.minQuantity
      ORDER BY pv.quantity ASC, p.name ASC
      LIMIT 20
    `)
    .all<any>()
  const lowStockList = lowStockListResult.results || []

  const reorderListResult = await d1
    .prepare(`
      SELECT pv.id, p.name AS name, pv.sku, pv.quantity, pv.reorderQty
      FROM "ProductVariant" pv
      JOIN "Product" p ON p.id = pv.productId
      WHERE pv.quantity <= pv.reorderQty
      ORDER BY pv.quantity ASC, p.name ASC
      LIMIT 10
    `)
    .all<any>()
  const reorderList = reorderListResult.results || []

  const todaySalesByMethod = await db.sale.findMany({
    where: { date: { gte: startOfToday, lte: endOfToday }, status: 'completed' },
    select: { paymentMethod: true, total: true },
  })
  const byMethod = { cash: 0, card: 0, transfer: 0 }
  for (const s of todaySalesByMethod) {
    if (s.paymentMethod === 'cash') byMethod.cash += s.total
    else if (s.paymentMethod === 'card') byMethod.card += s.total
    else if (s.paymentMethod === 'transfer') byMethod.transfer += s.total
  }

  return NextResponse.json({
    todaySales: todaySalesAgg._sum.total || 0,
    todayProfit: Math.round(todayProfit),
    todaySalesCount,
    lowStockCount,
    outOfStockCount,
    inventoryValue: Math.round(inventoryValue),
    retailValue: Math.round(retailValue),
    potentialProfit: Math.round(retailValue - inventoryValue),
    customerBalance: customerBalances._sum.balance || 0,
    supplierBalance: supplierBalances._sum.balance || 0,
    salesTrend,
    topProducts: topVariants,
    recentSales: recentSaleList.map((s) => ({
      id: s.id,
      invoiceNo: s.invoiceNo,
      date: s.date,
      total: s.total,
      customerName: s.customer?.name || 'عميل نقدي',
      itemsCount: s.items.length,
      paymentMethod: s.paymentMethod,
      status: s.status,
    })),
    lowStockList: lowStockList.map((v: any) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      size: v.size || '',
      color: v.color || '',
      quantity: Number(v.quantity),
      minQuantity: Number(v.minQuantity),
      reorderQty: Number(v.reorderQty),
      category: v.category || undefined,
    })),
    reorderList: reorderList.map((v: any) => ({
      id: v.id,
      name: v.name,
      sku: v.sku,
      quantity: Number(v.quantity),
      reorderQty: Number(v.reorderQty),
      suggestedOrder: Math.max(0, Number(v.reorderQty) * 2 - Number(v.quantity)),
    })),
    todayByMethod: byMethod,
  })
}
