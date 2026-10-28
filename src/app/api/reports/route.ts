import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { recognizedLineRevenue, recognizedSaleRevenue } from '@/lib/reporting'

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const dayKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role === 'cashier') return NextResponse.json({ error: 'الكاشير لا يملك صلاحية التقارير' }, { status: 403 })

  const sp = new URL(req.url).searchParams
  const from = sp.get('from'), to = sp.get('to')
  const validDate = (value: string | null) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (!validDate(from) || !validDate(to)) {
    return NextResponse.json({ error: 'صيغة التاريخ غير صحيحة' }, { status: 400 })
  }
  const start = from ? new Date(`${from}T00:00:00`) : new Date(Date.now() - 29 * 86400000)
  const end = to ? new Date(`${to}T23:59:59.999`) : new Date()
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return NextResponse.json({ error: 'الفترة الزمنية غير صحيحة' }, { status: 400 })
  }
  if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'الفترة القصوى للتقرير سنة واحدة؛ اختر فترة أقصر' }, { status: 400 })
  }

  const [sales, purchases, returns, purchaseReturns] = await Promise.all([
    db.sale.findMany({
      where: { date: { gte: start, lte: end }, status: { in: ['completed', 'partial_return', 'returned'] } },
      include: {
        items: {
          include: {
            variant: {
              include: { product: { include: { category: true } } },
            },
          },
        },
      },
    }),
    db.purchase.findMany({ where: { date: { gte: start, lte: end }, status: 'completed' } }),
    db.saleReturn.findMany({
      where: { date: { gte: start, lte: end }, status: 'completed' },
      include: {
        sale: { select: { paymentMethod: true } },
        sale: { select: { subtotal: true, total: true, taxAmount: true, paymentMethod: true } },
        items: {
          include: {
            saleItem: true,
            variant: {
              include: { product: { include: { category: true } } },
            },
          },
        },
      },
    }),
    db.purchaseReturn.findMany({ where: { date: { gte: start, lte: end }, status: 'completed' } }),
  ])

  const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0)
  const totalReturns = returns.reduce((sum, returned) => sum + returned.total, 0)
  const totalPurchases = purchases.reduce((sum, purchase) => sum + purchase.total, 0)
  const totalPurchaseReturns = purchaseReturns.reduce((sum, returned) => sum + returned.total, 0)
  const netSales = totalSales - totalReturns
  const netPurchases = totalPurchases - totalPurchaseReturns

  const recognizedSales = sales.reduce((sum, sale) => sum + recognizedSaleRevenue(sale), 0)
  const recognizedReturns = returns.reduce((sum, returned) => (
    sum + returned.items.reduce((lineSum, item) => lineSum + recognizedLineRevenue(returned.sale, item), 0)
  ), 0)
  const recognizedNetSales = recognizedSales - recognizedReturns

  const soldCost = sales.reduce((sum, sale) => sum + sale.items.reduce((sub, item) => sub + item.unitCost * item.quantity, 0), 0)
  const returnedCost = returns.reduce((sum, returned) => sum + returned.items.reduce((sub, item) => sub + item.saleItem.unitCost * item.quantity, 0), 0)
  const cogs = soldCost - returnedCost
  const totalProfit = recognizedNetSales - cogs

  const best = new Map<string, { id: string; name: string; qty: number; revenue: number; profit: number }>()
  const categories = new Map<string, number>()
  const methods = new Map<string, number>()

  for (const sale of sales) {
    methods.set(sale.paymentMethod, (methods.get(sale.paymentMethod) || 0) + sale.total)
    for (const item of sale.items) {
      const cost = item.unitCost * item.quantity
      const row = best.get(item.variantId) || {
        id: item.variantId, name: item.variant.product.name, qty: 0, revenue: 0, profit: 0,
      }
      const lineRevenue = recognizedLineRevenue(sale, item)
      row.qty += item.quantity
      row.revenue += lineRevenue
      row.profit += lineRevenue - cost
      best.set(item.variantId, row)
      const category = item.variant.product.category?.name || 'بدون تصنيف'
      categories.set(category, (categories.get(category) || 0) + lineRevenue)
    }
  }

  for (const returned of returns) {
    methods.set(returned.sale.paymentMethod, (methods.get(returned.sale.paymentMethod) || 0) - returned.total)
    for (const item of returned.items) {
      const row = best.get(item.variantId) || {
        id: item.variantId, name: item.variant.product.name, qty: 0, revenue: 0, profit: 0,
      }
      const refundedRevenue = recognizedLineRevenue(returned.sale, item)
      const costReturned = item.saleItem.unitCost * item.quantity
      row.qty -= item.quantity
      row.revenue -= refundedRevenue
      row.profit += costReturned - refundedRevenue
      best.set(item.variantId, row)
      const category = item.variant.product.category?.name || 'بدون تصنيف'
      categories.set(category, (categories.get(category) || 0) - refundedRevenue)
    }
  }

  const daily = new Map<string, { sales: number; profit: number; purchases: number; returns: number }>()
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const key = dayKey(date)
    daily.set(key, { sales: 0, profit: 0, purchases: 0, returns: 0 })
  }

  for (const sale of sales) {
    const key = dayKey(sale.date)
    const row = daily.get(key)
    if (row) {
      row.sales += sale.total
      row.profit += sale.items.reduce((sum, item) => sum + item.total - item.unitCost * item.quantity, 0)
    }
  }
  for (const purchase of purchases) {
    const row = daily.get(dayKey(purchase.date))
    if (row) row.purchases += purchase.total
  }
  for (const returned of returns) {
    const row = daily.get(dayKey(returned.date))
    if (row) {
      row.returns += returned.total
      row.profit += returned.items.reduce((sum, item) => sum + item.saleItem.unitCost * item.quantity - recognizedLineRevenue(returned.sale, item), 0)
    }
  }
  for (const returned of purchaseReturns) {
    const row = daily.get(dayKey(returned.date))
    if (row) row.purchases -= returned.total
  }

  return NextResponse.json({
    from: start.toISOString(),
    to: end.toISOString(),
    salesCount: sales.length,
    purchasesCount: purchases.length,
    returnsCount: returns.length,
    purchaseReturnsCount: purchaseReturns.length,
    totalSales: money(totalSales),
    netSales: money(netSales),
    recognizedSales: money(recognizedSales),
    recognizedReturns: money(recognizedReturns),
    recognizedNetSales: money(recognizedNetSales),
    totalReturns: money(totalReturns),
    totalPurchases: money(totalPurchases),
    totalPurchaseReturns: money(totalPurchaseReturns),
    netPurchases: money(netPurchases),
    totalProfit: money(totalProfit),
    cogs: money(cogs),
    profitMargin: recognizedNetSales > 0 ? money((totalProfit / recognizedNetSales) * 100) : 0,
    bestSelling: Array.from(best.values()).sort((a, b) => b.qty - a.qty).slice(0, 10).map((row) => ({
      ...row, revenue: money(row.revenue), profit: money(row.profit),
    })),
    salesByCategory: Array.from(categories.entries()).map(([name, value]) => ({ name, value: money(value) })),
    salesByMethod: Array.from(methods.entries()).map(([name, value]) => ({ name, value: money(value) })),
    dailyTrend: Array.from(daily.entries()).map(([date, values]) => ({
      date,
      label: new Date(`${date}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }),
      sales: money(values.sales),
      profit: money(values.profit),
      purchases: money(values.purchases),
      returns: money(values.returns),
    })),
  })
}
