import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { recognizedLineRevenue, recognizedReturnRevenue } from '@/lib/reporting'

const activeSaleStatuses = ['completed', 'partial_return', 'returned']
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (!['admin', 'manager'].includes(user.role)) {
    return NextResponse.json({ error: 'لوحة التحكم متاحة للإدارة فقط' }, { status: 403 })
  }

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const todayRange = { gte: startOfToday, lte: endOfToday }

  const [todaySales, todayReturns] = await Promise.all([
    db.sale.findMany({
      where: { date: todayRange, status: { in: activeSaleStatuses } },
      include: { items: true },
    }),
    db.saleReturn.findMany({
      where: { date: todayRange, status: 'completed' },
      include: {
        sale: { select: { subtotal: true, total: true, taxAmount: true, paymentMethod: true } },
        items: { include: { saleItem: true } },
      },
    }),
  ])

  const grossTodaySales = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const todayReturnTotal = todayReturns.reduce((sum, returned) => sum + returned.total, 0)
  const todaySalesTotal = grossTodaySales - todayReturnTotal
  const todaySalesCount = todaySales.length
  const todayProfit = todaySales.reduce((sum, sale) => (
    sum + sale.items.reduce((lineSum, item) => (
      lineSum + recognizedLineRevenue(sale, item) - item.unitCost * item.quantity
    ), 0)
  ), 0) + todayReturns.reduce((sum, returned) => (
    sum + returned.items.reduce((lineSum, item) => (
      lineSum + item.saleItem.unitCost * item.quantity
    ), 0) - recognizedReturnRevenue(returned.sale, returned.total)
  ), 0)

  const variants = await db.productVariant.findMany({
    select: {
      id: true, sku: true, size: true, color: true, quantity: true,
      minQuantity: true, reorderQty: true, costPrice: true, sellPrice: true,
      product: { select: { name: true, category: { select: { name: true } } } },
    },
  })
  const lowStockVariants = variants.filter((variant) => variant.quantity <= variant.minQuantity)
  const reorderVariants = variants.filter((variant) => variant.quantity <= variant.reorderQty)
  const lowStockCount = lowStockVariants.length
  const outOfStockCount = variants.filter((variant) => variant.quantity === 0).length
  const inventoryValue = variants.reduce((sum, variant) => sum + variant.costPrice * variant.quantity, 0)
  const retailValue = variants.reduce((sum, variant) => sum + variant.sellPrice * variant.quantity, 0)

  const [customerBalances, supplierBalances] = await Promise.all([
    db.customer.aggregate({ _sum: { balance: true } }),
    db.supplier.aggregate({ _sum: { balance: true } }),
  ])

  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(now.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)
  const recentRange = { gte: sevenDaysAgo, lte: endOfToday }

  const [recentSales, recentReturns, allSales, allReturns, recentSaleList] = await Promise.all([
    db.sale.findMany({
      where: { date: recentRange, status: { in: activeSaleStatuses } },
      include: { items: true },
    }),
    db.saleReturn.findMany({
      where: { date: recentRange, status: 'completed' },
      include: {
        sale: { select: { subtotal: true, total: true, taxAmount: true, paymentMethod: true } },
        items: { include: { saleItem: true } },
      },
    }),
    db.sale.findMany({
      where: { status: { in: activeSaleStatuses } },
      include: { items: true },
    }),
    db.saleReturn.findMany({
      where: { status: 'completed' },
      include: {
        sale: { select: { subtotal: true, total: true, taxAmount: true, paymentMethod: true } },
        items: { include: { saleItem: true } },
      },
    }),
    db.sale.findMany({
      take: 5,
      where: { status: { in: activeSaleStatuses } },
      orderBy: { date: 'desc' },
      include: { customer: true, items: true },
    }),
  ])

  const trendMap = new Map<string, { sales: number; profit: number }>()
  for (let index = 0; index < 7; index++) {
    const date = new Date(sevenDaysAgo)
    date.setDate(sevenDaysAgo.getDate() + index)
    trendMap.set(dayKey(date), { sales: 0, profit: 0 })
  }

  for (const sale of recentSales) {
    const row = trendMap.get(dayKey(sale.date))
    if (!row) continue
    row.sales += sale.total
    row.profit += sale.items.reduce((sum, item) => (
      sum + recognizedLineRevenue(sale, item) - item.unitCost * item.quantity
    ), 0)
  }
  for (const returned of recentReturns) {
    const row = trendMap.get(dayKey(returned.date))
    if (!row) continue
    row.sales -= returned.total
    row.profit += returned.items.reduce((sum, item) => (
      sum + item.saleItem.unitCost * item.quantity
    ), 0) - recognizedReturnRevenue(returned.sale, returned.total)
  }

  const salesTrend = Array.from(trendMap.entries()).map(([date, value]) => ({
    date,
    label: new Date(`${date}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric' }),
    sales: Math.round(value.sales),
    profit: Math.round(value.profit),
  }))

  const productMap = new Map<string, { qty: number; revenue: number; profit: number }>()
  for (const sale of allSales) {
    for (const item of sale.items) {
      const current = productMap.get(item.variantId) || { qty: 0, revenue: 0, profit: 0 }
      const lineRevenue = recognizedLineRevenue(sale, item)
      current.qty += item.quantity
      current.revenue += lineRevenue
      current.profit += lineRevenue - item.unitCost * item.quantity
      productMap.set(item.variantId, current)
    }
  }
  for (const returned of allReturns) {
    const returnBasis = returned.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    const recognizedReturn = recognizedReturnRevenue(returned.sale, returned.total)
    for (const item of returned.items) {
      const current = productMap.get(item.variantId) || { qty: 0, revenue: 0, profit: 0 }
      const lineBasis = item.unitPrice * item.quantity
      const lineRevenue = returnBasis > 0 ? recognizedReturn * lineBasis / returnBasis : 0
      current.qty -= item.quantity
      current.revenue -= lineRevenue
      current.profit += item.saleItem.unitCost * item.quantity - lineRevenue
      productMap.set(item.variantId, current)
    }
  }

  const topVariantIds = Array.from(productMap.entries())
    .filter(([, value]) => value.qty > 0)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5)

  const topVariants = await Promise.all(
    topVariantIds.map(async ([variantId, value]) => {
      const variant = await db.productVariant.findUnique({
        where: { id: variantId },
        select: { sku: true, size: true, color: true, product: { select: { name: true } } },
      })
      return {
        name: variant?.product.name || '—',
        sku: variant?.sku || '—',
        size: variant?.size || '',
        color: variant?.color || '',
        qty: value.qty,
        revenue: value.revenue,
        profit: value.profit,
      }
    }),
  )

  const lowStockList = lowStockVariants
    .sort((a, b) => a.quantity - b.quantity || a.product.name.localeCompare(b.product.name))
    .slice(0, 20)
    .map((variant) => ({
      id: variant.id, name: variant.product.name, sku: variant.sku,
      size: variant.size, color: variant.color, quantity: variant.quantity,
      minQuantity: variant.minQuantity, reorderQty: variant.reorderQty,
      category: variant.product.category?.name || 'بدون تصنيف',
    }))

  const reorderList = reorderVariants
    .sort((a, b) => a.quantity - b.quantity || a.product.name.localeCompare(b.product.name))
    .slice(0, 10)
    .map((variant) => ({
      id: variant.id, name: variant.product.name, sku: variant.sku,
      quantity: variant.quantity, reorderQty: variant.reorderQty,
    }))

  const byMethod = { cash: 0, card: 0, transfer: 0 }
  for (const sale of todaySales) {
    if (sale.paymentMethod === 'cash') byMethod.cash += sale.total
    else if (sale.paymentMethod === 'card') byMethod.card += sale.total
    else if (sale.paymentMethod === 'transfer') byMethod.transfer += sale.total
  }
  for (const returned of todayReturns) {
    if (returned.sale.paymentMethod === 'cash') byMethod.cash -= returned.total
    else if (returned.sale.paymentMethod === 'card') byMethod.card -= returned.total
    else if (returned.sale.paymentMethod === 'transfer') byMethod.transfer -= returned.total
  }

  return NextResponse.json({
    todaySales: todaySalesTotal,
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
    recentSales: recentSaleList.map((sale) => ({
      id: sale.id,
      invoiceNo: sale.invoiceNo,
      date: sale.date,
      total: sale.total,
      customerName: sale.customer?.name || 'عميل نقدي',
      itemsCount: sale.items.length,
      paymentMethod: sale.paymentMethod,
      status: sale.status,
    })),
    lowStockList: lowStockList.map((variant) => ({
      ...variant,
      quantity: Number(variant.quantity),
      minQuantity: Number(variant.minQuantity),
      reorderQty: Number(variant.reorderQty),
      category: variant.category || undefined,
      size: variant.size || '',
      color: variant.color || '',
    })),
    reorderList: reorderList.map((variant) => ({
      ...variant,
      quantity: Number(variant.quantity),
      reorderQty: Number(variant.reorderQty),
      suggestedOrder: Math.max(0, Number(variant.reorderQty) * 2 - Number(variant.quantity)),
    })),
    todayByMethod: byMethod,
  })
}
