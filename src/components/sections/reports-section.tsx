'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { BarChart3, TrendingUp, ShoppingCart, Percent, Package, ArrowDown, ArrowUp } from 'lucide-react'
import { formatEGP, todayISO, daysAgoISO } from '@/lib/format'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { motion } from 'framer-motion'
import { EmptyState } from '@/components/empty-state'

const PIE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

interface ReportData {
  from: string
  to: string
  salesCount: number
  purchasesCount: number
  returnsCount: number
  totalSales: number
  netSales: number
  totalReturns: number
  totalPurchases: number
  totalProfit: number
  cogs: number
  profitMargin: number
  bestSelling: { id: string; name: string; qty: number; revenue: number; profit: number }[]
  salesByCategory: { name: string; value: number }[]
  salesByMethod: { name: string; value: number }[]
  dailyTrend: { date: string; label: string; sales: number; profit: number; purchases: number; returns: number }[]
}

function StatCard({ title, value, hint, icon: Icon, color, trend }: {
  title: string
  value: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  trend?: 'up' | 'down'
}) {
  return (
    <Card className="card-hover">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground truncate">{title}</p>
            <p className="text-xl font-bold tracking-tight">{value}</p>
            {hint && <p className="text-xs text-muted-foreground truncate">{hint}</p>}
          </div>
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}15`, color }}>
            <Icon className="size-5" />
          </div>
        </div>
        {trend && (
          <div className="mt-3 flex items-center gap-1 text-xs">
            {trend === 'up' ? (
              <><ArrowUp className="size-3 text-emerald-600" /> <span className="text-emerald-600">صاعد</span></>
            ) : (
              <><ArrowDown className="size-3 text-red-600" /> <span className="text-red-600">هابط</span></>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ReportsSection() {
  const [from, setFrom] = useState(daysAgoISO(30))
  const [to, setTo] = useState(todayISO())
  const [applied, setApplied] = useState({ from: daysAgoISO(30), to: todayISO() })

  const { data, isLoading, isError } = useQuery<ReportData>({
    queryKey: ['reports', applied.from, applied.to],
    queryFn: async () => {
      const res = await fetch(`/api/reports?from=${applied.from}&to=${applied.to}`)
      if (!res.ok) throw new Error('فشل تحميل التقرير')
      return res.json()
    },
  })

  function applyRange() {
    if (!from || !to) return
    setApplied({ from, to })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">التقارير</h2>
        <p className="text-sm text-muted-foreground">تحليل الأداء خلال فترة محددة</p>
      </div>

      {/* Date range selector */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-5">
          <div className="space-y-1.5">
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10" />
          </div>
          <div className="flex gap-2">
            <Button onClick={applyRange} className="h-10">تطبيق</Button>
            <Button variant="outline" onClick={() => { setFrom(daysAgoISO(7)); setTo(todayISO()); setApplied({ from: daysAgoISO(7), to: todayISO() }) }} className="h-10 text-xs">7 أيام</Button>
            <Button variant="outline" onClick={() => { setFrom(daysAgoISO(30)); setTo(todayISO()); setApplied({ from: daysAgoISO(30), to: todayISO() }) }} className="h-10 text-xs">30 يوم</Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : isError ? (
        <EmptyState title="تعذّر تحميل التقرير" icon={BarChart3} />
      ) : data ? (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              title="صافي المبيعات"
              value={formatEGP(data.netSales)}
              hint={`${data.salesCount} فاتورة · مرتجع ${formatEGP(data.totalReturns)}`}
              icon={TrendingUp}
              color="hsl(160 84% 39%)"
              trend="up"
            />
            <StatCard
              title="إجمالي المشتريات"
              value={formatEGP(data.totalPurchases)}
              hint={`${data.purchasesCount} فاتورة شراء`}
              icon={ShoppingCart}
              color="hsl(220 70% 50%)"
            />
            <StatCard
              title="صافي الربح"
              value={formatEGP(data.totalProfit)}
              hint={`تكلفة: ${formatEGP(data.cogs)}`}
              icon={BarChart3}
              color="hsl(140 70% 45%)"
              trend="up"
            />
            <StatCard
              title="هامش الربح"
              value={`${data.profitMargin}%`}
              hint="نسبة الربح من المبيعات"
              icon={Percent}
              color="hsl(280 60% 50%)"
            />
          </div>

          {/* Daily trend chart */}
          <Card>
            <CardContent className="p-5">
              <h3 className="text-base font-semibold mb-1">الأداء اليومي</h3>
              <p className="text-xs text-muted-foreground mb-4">المبيعات، الأرباح، المشتريات، والمرتجعات</p>
              {data.dailyTrend.length === 0 ? (
                <EmptyState title="لا توجد بيانات في هذه الفترة" icon={BarChart3} />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={data.dailyTrend} margin={{ left: -10, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={56} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                      formatter={(v: number, n: string) => [`${formatEGP(v)} ج.م`, n === 'sales' ? 'مبيعات' : n === 'profit' ? 'أرباح' : n === 'purchases' ? 'مشتريات' : 'مرتجعات']}
                    />
                    <Legend formatter={(v: string) => v === 'sales' ? 'مبيعات' : v === 'profit' ? 'أرباح' : v === 'purchases' ? 'مشتريات' : 'مرتجعات'} />
                    <Line type="monotone" dataKey="sales" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="profit" stroke="var(--chart-2)" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="purchases" stroke="var(--chart-4)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                    <Line type="monotone" dataKey="returns" stroke="var(--chart-5)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Category + Method breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-5">
                <h3 className="text-base font-semibold mb-1">المبيعات حسب التصنيف</h3>
                <p className="text-xs text-muted-foreground mb-4">توزيع قيمة المبيعات</p>
                {data.salesByCategory.length === 0 ? (
                  <EmptyState title="لا توجد مبيعات في الفترة" icon={Package} />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={data.salesByCategory}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        innerRadius={50}
                        paddingAngle={2}
                      >
                        {data.salesByCategory.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                        formatter={(v: number) => `${formatEGP(v)} ج.م`}
                      />
                      <Legend formatter={(v: string) => v} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="text-base font-semibold mb-1">المبيعات حسب طريقة الدفع</h3>
                <p className="text-xs text-muted-foreground mb-4">نقدي / بطاقة / تحويل</p>
                {data.salesByMethod.length === 0 ? (
                  <EmptyState title="لا توجد بيانات" icon={Package} />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.salesByMethod} margin={{ left: -10, right: 8, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} width={56} />
                      <Tooltip
                        contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                        formatter={(v: number) => `${formatEGP(v)} ج.م`}
                      />
                      <Bar dataKey="value" fill="var(--chart-1)" radius={[8, 8, 0, 0]} name="القيمة" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Best selling products list */}
          <Card>
            <CardContent className="p-5">
              <h3 className="text-base font-semibold mb-1">الأكثر مبيعًا في الفترة</h3>
              <p className="text-xs text-muted-foreground mb-4">ترتيب المنتجات حسب الكمية المباعة</p>
              {data.bestSelling.length === 0 ? (
                <EmptyState title="لا توجد منتجات مبيعة في هذه الفترة" icon={Package} />
              ) : (
                <div className="space-y-2">
                  {data.bestSelling.map((p, idx) => {
                    const maxQty = Math.max(...data.bestSelling.map((x) => x.qty), 1)
                    const pct = (p.qty / maxQty) * 100
                    return (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{p.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                إيراد: {formatEGP(p.revenue)} ج.م · ربح: {formatEGP(p.profit)} ج.م
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 text-left">
                            <p className="text-sm font-bold">{p.qty} قطعة</p>
                          </div>
                        </div>
                        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5, delay: 0.1 + idx * 0.05 }}
                            className="h-full rounded-full bg-primary"
                          />
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
