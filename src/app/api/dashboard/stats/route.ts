import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

  // Today's sales (only completed)
  const todaySalesAgg = await db.sale.aggregate({
    where: { date: { gte: startOfToday, lte: endOfToday }, status: 'completed' },
    _sum: { total: true },
  })

  // Today's profit using SaleItem.unitCost snapshot (accurate)
  const todaySaleItems = await db.saleItem.findMany({
    where: { sale: { date: { gte: startOfToday, lte: endOfToday }, status: 'completed' } },
    select: { unitPrice: true, unitCost: true, quantity: true },
  })
  let todayProfit = 0
  for (const it of todaySaleItems) {
    todayProfit += (it.unitPrice - it.unitCost) * it.quantity
  }

  // Today's sale count and items sold
  const todaySalesCount = await db.sale.count({
    where: { date: { gte: startOfToday, lte: endOfToday }, status: 'completed' },
  })

  // Low stock count (variants <= minQuantity)
  const lowStockCount = await db.productVariant.count({
    where: { quantity: { lte: db.productVariant.fields.minQuantity } },
  })

  // Out of stock count
  const outOfStockCount = await db.productVariant.count({ where: { quantity: 0 } })

  // Inventory value (using current MWA costPrice)
  const variants = await db.productVariant.findMany({
    select: { costPrice: true, sellPrice: true, quantity: true },
  })
  const inventoryValue = variants.reduce((s, v) => s + v.costPrice * v.quantity, 0)
  const retailValue = variants.reduce((s, v) => s + v.sellPrice * v.quantity, 0)

  // Outstanding balances
  const customerBalances = await db.customer.aggregate({ _sum: { balance: true } })
  const supplierBalances = await db.supplier.aggregate({ _sum: { balance: true } })

  // 7-day sales+profit trend
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
    if (trendMap.has(key)) {
      trendMap.get(key)!.profit += (it.unitPrice - it.unitCost) * it.quantity
    }
  }
  const salesTrend = Array.from(trendMap.entries()).map(([date, v]) => ({
    date,
    label: new Date(date).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric' }),
    sales: Math.round(v.sales),
    profit: Math.round(v.profit),
  }))

  // Top 5 selling products (by qty) — use variants with product include
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
  const topVariantIds = Array.from(prodMap.entries()).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5)
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

  // Recent sales
  const recentSaleList = await db.sale.findMany({
    take: 5,
    where: { status: { in: ['completed', 'partial_return'] } },
    orderBy: { date: 'desc' },
    include: { customer: true, items: true },
  })

  // Low stock list
  const lowStockList = await db.productVariant.findMany({
    where: { quantity: { lte: db.productVariant.fields.minQuantity } },
    include: { product: { include: { category: true } } },
    take: 20,
  })

  // Reorder suggestions (variants below reorder point)
  const reorderList = await db.productVariant.findMany({
    where: { quantity: { lte: db.productVariant.fields.reorderQty } },
    include: { product: { select: { name: true } } },
    take: 10,
  })

  // Today's profit by payment method
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
    lowStockList: lowStockList.map((v) => ({
      id: v.id,
      name: v.product.name,
      sku: v.sku,
      size: v.size || '',
      color: v.color || '',
      quantity: v.quantity,
      minQuantity: v.minQuantity,
      reorderQty: v.reorderQty,
      category: v.product.category?.name,
    })),
    reorderList: reorderList.map((v) => ({
      id: v.id,
      name: v.product.name,
      sku: v.sku,
      quantity: v.quantity,
      reorderQty: v.reorderQty,
      suggestedOrder: Math.max(0, v.reorderQty * 2 - v.quantity),
    })),
    todayByMethod: byMethod,
  })
}
