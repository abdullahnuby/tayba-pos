import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role === 'cashier') return NextResponse.json({ error: 'الكاشير لا يملك صلاحية التقارير' }, { status: 403 })
  const sp = new URL(req.url).searchParams
  const from = sp.get('from'), to = sp.get('to')
  const start = from ? new Date(`${from}T00:00:00`) : new Date(Date.now() - 30 * 86400000)
  const end = to ? new Date(`${to}T23:59:59.999`) : new Date()
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return NextResponse.json({ error: 'الفترة الزمنية غير صحيحة' }, { status: 400 })
  const sales = await db.sale.findMany({ where: { date: { gte: start, lte: end }, status: 'completed' }, include: { items: { include: { variant: { include: { product: { include: { category: true } } } } } } } })
  const purchases = await db.purchase.findMany({ where: { date: { gte: start, lte: end }, status: 'completed' } })
  const returns = await db.saleReturn.findMany({ where: { date: { gte: start, lte: end }, status: 'completed' }, include: { items: true } })
  const totalSales = sales.reduce((s, x) => s + x.total, 0)
  const totalPurchases = purchases.reduce((s, x) => s + x.total, 0)
  const totalReturns = returns.reduce((s, x) => s + x.total, 0)
  const netSales = totalSales - totalReturns
  let cogs = 0, totalProfit = 0
  const best = new Map<string, { id: string; name: string; qty: number; revenue: number; profit: number }>()
  const categories = new Map<string, number>(), methods = new Map<string, number>()
  for (const s of sales) {
    methods.set(s.paymentMethod, (methods.get(s.paymentMethod) || 0) + s.total)
    for (const it of s.items) {
      const cost = it.unitCost * it.quantity; cogs += cost; totalProfit += it.total - cost
      const row = best.get(it.variantId) || { id: it.variantId, name: it.variant.product.name, qty: 0, revenue: 0, profit: 0 }
      row.qty += it.quantity; row.revenue += it.total; row.profit += it.total - cost; best.set(it.variantId, row)
      const cat = it.variant.product.category?.name || 'بدون تصنيف'; categories.set(cat, (categories.get(cat) || 0) + it.total)
    }
  }
  const daily = new Map<string, { sales: number; profit: number; purchases: number; returns: number }>()
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) daily.set(d.toISOString().slice(0,10), { sales:0, profit:0, purchases:0, returns:0 })
  for (const s of sales) { const k=s.date.toISOString().slice(0,10); if(daily.has(k)){ daily.get(k)!.sales+=s.total; daily.get(k)!.profit+=s.items.reduce((a,i)=>a+i.total-i.unitCost*i.quantity,0) } }
  for (const p of purchases) { const k=p.date.toISOString().slice(0,10); if(daily.has(k)) daily.get(k)!.purchases+=p.total }
  for (const r of returns) { const k=r.date.toISOString().slice(0,10); if(daily.has(k)) daily.get(k)!.returns+=r.total }
  return NextResponse.json({
    from: start.toISOString(), to: end.toISOString(), salesCount: sales.length, purchasesCount: purchases.length, returnsCount: returns.length,
    totalSales: Math.round(totalSales), netSales: Math.round(netSales), totalReturns: Math.round(totalReturns), totalPurchases: Math.round(totalPurchases),
    totalProfit: Math.round(totalProfit), cogs: Math.round(cogs), profitMargin: netSales > 0 ? Math.round((totalProfit/netSales)*10000)/100 : 0,
    bestSelling: Array.from(best.values()).sort((a,b)=>b.qty-a.qty).slice(0,10),
    salesByCategory: Array.from(categories.entries()).map(([name,value])=>({name,value})),
    salesByMethod: Array.from(methods.entries()).map(([name,value])=>({name,value})),
    dailyTrend: Array.from(daily.entries()).map(([date,v])=>({date,label:new Date(date).toLocaleDateString('ar-EG',{day:'numeric',month:'short'}),...v})),
  })
}
