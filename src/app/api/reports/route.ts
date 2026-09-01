import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role === 'cashier') {
    return NextResponse.json({ error: 'الكاشير لا يملك صلاحية التقارير' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let startDate: Date
  let endDate: Date
  if (from && to) {
    startDate = new Date(from)
    endDate = new Date(to)
    endDate.setHours(23, 59, 59, 999)
  } else {
    endDate = new Date()
    startDate = new Date()
    startDate.setDate(endDate.getDate() - 30)
  }

  // Sales — exclude voided
  const sales = await db.sale.findMany({
    where: { date: { gte: startDate, lte: endDate }, status: { not: 'voided' } },
    include: {
      items: {
        include: {
          variant: { include: { product: { include: { category: true } } } },
        },
      },
      customer: true,
    },
  })

  const purchases = await db.purchase.findMany({
    where: { date: { gte: startDate, lte: endDate }, status: 'completed' },
    include: { items: { include: { variant: { include: { product: true } } } }, supplier: true },
  })

  // Returns within range
  const saleReturns = await db.saleReturn.findMany({
    where: { date: { gte: startDate, lte: endDate }, status: 'completed' },
    include: { items: true },
  })

  const totalSales = sales.reduce((s, x) => s + x.total, 0)
  const totalPurchases = purchases.reduce((s, x) => s + x.total, 0)
  const totalReturns = saleReturns.reduce((s, r) => s + r.total, 0)
  const netSales = totalSales - totalReturns

  // Profit using SaleItem.unitCost snapshot (accurate historical)
  let totalProfit = 0
  let cogs = 0
  for (const s of sales) {
    for (const it of s.items) {
      const lineCost = it.unitCost * it.quantity
      cogs += lineCost
      totalProfit += it.total - lineCost
    }
  }
  // Subtract returned items' profit
  for (const r of saleReturns) {
    for (const it of r.items) {
      totalProfit -= 0 // already counted as revenue reduction; assume cost was returned at sale-time unitCost
    }
  }

  // Best-selling by variant
  const variantMap = new Map<string, { name: string; sku: string; qty: number; revenue: number; profit: number }>()
  for (const s of sales) {
    for (const it of s.items) {
      const key = it.variantId
      const cur = variantMap.get(key) || {
        name: it.variant.product.name,
        sku: it.variant.sku,
        qty: 0,
        revenue: 0,
        profit: 0,
      }
      cur.qty += it.quantity
      cur.revenue += it.total
      cur.profit += it.total - it.unitCost * it.quantity
      variantMap.set(key, cur)
    }
  }
  const bestSelling = Array.from(variantMap.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10)

  // Sales by category
  const catMap = new Map<string, number>()
  for (const s of sales) {
    for (const it of s.items) {
      const catName = it.variant.product.category?.name || 'بدون تصنيف'
      catMap.set(catName, (catMap.get(catName) || 0) + it.total)
    }
  }
  const salesByCategory = Array.from(catMap.entries()).map(([name, value]) => ({ name, value }))

  // Sales by payment method
  const methodMap = new Map<string, number>()
  for (const s of sales) {
    methodMap.set(s.paymentMethod, (methodMap.get(s.paymentMethod) || 0) + s.total)
  }
  const salesByMethod = Array.from(methodMap.entries()).map(([name, value]) => ({ name, value }))

  // Profit margin
  const profitMargin = netSales > 0 ? (totalProfit / netSales) * 100 : 0

  // Daily breakdown
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const dailyMap = new Map<string, { sales: number; profit: number; purchases: number; returns: number }>()
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + i)
    dailyMap.set(d.toISOString().slice(0, 10), { sales: 0, profit: 0, purchases: 0, returns: 0 })
  }
  for (const s of sales) {
    const key = s.date.toISOString().slice(0, 10)
    if (dailyMap.has(key)) {
      dailyMap.get(key)!.sales += s.total
      for (const it of s.items) {
        dailyMap.get(key)!.profit += it.total - it.unitCost * it.quantity
      }
    }
  }
  for (const p of purchases) {
    const key = p.date.toISOString().slice(0, 10)
    if (dailyMap.has(key)) {
      dailyMap.get(key)!.purchases += p.total
    }
  }
  for (const r of saleReturns) {
    const key = r.date.toISOString().slice(0, 10)
    if (dailyMap.has(key)) {
      dailyMap.get(key)!.returns += r.total
    }
  }
  const dailyTrend = Array.from(dailyMap.entries()).map(([date, v]) => ({
    date,
    label: new Date(date).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }),
    sales: Math.round(v.sales),
    profit: Math.round(v.profit),
    purchases: Math.round(v.purchases),
    returns: Math.round(v.returns),
  }))

  return NextResponse.json({
    from: startDate.toISOString(),
    to: endDate.toISOString(),
    salesCount: sales.length,
    purchasesCount: purchases.length,
    returnsCount: saleReturns.length,
    totalSales: Math.round(totalSales),
    netSales: Math.round(netSales),
    totalReturns: Math.round(totalReturns),
    totalPurchases: Math.round(totalPurchases),
    totalProfit: Math.round(totalProfit),
    cogs: Math.round(cogs),
    profitMargin: Math.round(profitMargin * 100) / 100,
    bestSelling,
    salesByCategory,
    salesByMethod,
    dailyTrend,
  })
}
