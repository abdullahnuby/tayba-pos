'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { RotateCcw, Eye, Search, ArrowRight, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP, formatDateTime } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'

interface SaleItem {
  id: string
  variantId: string
  quantity: number
  unitPrice: number
  total: number
  variant: { sku: string; size: string | null; color: string | null; product: { name: string } }
}
interface SaleReturnItem { saleItemId?: string; quantity: number }
interface SaleReturn { id: string; returnNo: string; date: string; total: number; reason: string | null; status: string; sale?: { invoiceNo: string } | null; customer?: { name: string } | null; items: { id: string; quantity: number; unitPrice: number; total: number; variant: { sku: string; product: { name: string } } }[] }
interface Sale { id: string; invoiceNo: string; date: string; total: number; status: string; customer?: { name: string } | null; items: SaleItem[]; returns?: { items: SaleReturnItem[] }[] }

type RefundMethod = 'cash' | 'card' | 'credit'

export function ReturnsSection() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<SaleReturn | null>(null)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [loadingSale, setLoadingSale] = useState(false)
  const [returnItems, setReturnItems] = useState<{ saleItemId: string; variantId: string; quantity: number; unitPrice: number }[]>([])
  const [reason, setReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash')

  const { data: returnsData, isLoading } = useQuery<{ items: SaleReturn[] }>({
    queryKey: ['sale-returns'], queryFn: async () => (await fetch('/api/sale-returns')).json(),
  })
  const returns = returnsData?.items || []
  const { data: salesData } = useQuery<{ items: Sale[] }>({
    queryKey: ['sales-for-returns'], queryFn: async () => (await fetch('/api/sales?status=completed&pageSize=100')).json(),
  })
  const sales = salesData?.items || []
  const filteredReturns = returns.filter((r) => !search || r.returnNo.includes(search) || r.sale?.invoiceNo.includes(search) || r.customer?.name?.includes(search))
  const filteredSales = sales.filter((s) => !search || s.invoiceNo.includes(search) || s.customer?.name?.includes(search))

  const createReturn = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch('/api/sale-returns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'خطأ') }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale-returns'] }); qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['dashboard-stats'] }); qc.invalidateQueries({ queryKey: ['sales-for-returns'] })
      toast.success('تم تسجيل المرتجع وإرجاع الكميات للمخزون')
      closeNewReturn()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function openNewReturn(sale: Sale) {
    setLoadingSale(true)
    try {
      const res = await fetch(`/api/sales/${sale.id}`)
      if (!res.ok) throw new Error('تعذر تحميل تفاصيل الفاتورة')
      const detail: Sale = await res.json()
      const alreadyReturned = new Map<string, number>()
      ;(detail.returns || []).forEach((ret) => ret.items.forEach((item) => {
        if (item.saleItemId) alreadyReturned.set(item.saleItemId, (alreadyReturned.get(item.saleItemId) || 0) + item.quantity)
      }))
      setSelectedSale(detail)
      setReturnItems(detail.items.map((it) => ({ saleItemId: it.id, variantId: it.variantId, quantity: 0, unitPrice: it.unitPrice })))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'تعذر تحميل الفاتورة') }
    finally { setLoadingSale(false) }
  }

  const remainingByItem = useMemo(() => {
    const map = new Map<string, number>()
    if (!selectedSale) return map
    selectedSale.items.forEach((it) => map.set(it.id, it.quantity))
    ;(selectedSale.returns || []).forEach((ret) => ret.items.forEach((item) => {
      if (item.saleItemId) map.set(item.saleItemId, Math.max(0, (map.get(item.saleItemId) || 0) - item.quantity))
    }))
    return map
  }, [selectedSale])

  const returnTotal = returnItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const hasItems = returnItems.some((item) => item.quantity > 0)

  function closeNewReturn() { setNewDialogOpen(false); setSelectedSale(null); setReturnItems([]); setReason(''); setRefundMethod('cash') }
  function submitReturn() {
    const valid = returnItems.filter((i) => i.quantity > 0)
    if (!selectedSale || valid.length === 0) return toast.error('حدد صنفًا واحدًا على الأقل')
    createReturn.mutate({ saleId: selectedSale.id, reason: reason.trim() || null, refundMethod, items: valid })
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-2xl font-bold tracking-tight">المرتجعات</h2><p className="text-sm text-muted-foreground">إرجاع الأصناف للمخزون ومراجعة المرتجعات السابقة</p></div>
        <Button className="min-h-11 w-full sm:w-auto" onClick={() => setNewDialogOpen(true)}><RotateCcw className="size-4" /> مرتجع جديد</Button>
      </div>

      <Card><CardContent className="p-3"><div className="relative"><Search className="pointer-events-none absolute right-3 top-3 size-4 text-muted-foreground" /><Input className="h-11 pr-9" placeholder="ابحث برقم الفاتورة أو العميل أو المرتجع..." value={search} onChange={(e) => setSearch(e.target.value)} /></div></CardContent></Card>

      <Card>
        <CardHeader><CardTitle className="text-base">المرتجعات ({filteredReturns.length})</CardTitle></CardHeader>
        <CardContent className="p-3 sm:p-6">
          {isLoading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div> : filteredReturns.length === 0 ? <EmptyState title="لا توجد مرتجعات" description="ابدأ من زر مرتجع جديد واختر الفاتورة" icon={RotateCcw} /> : (
            <>
              <div className="space-y-2 md:hidden">{filteredReturns.map((r) => <button key={r.id} className="w-full rounded-xl border p-3 text-right active:bg-accent" onClick={() => setViewing(r)}>
                <div className="flex items-start justify-between gap-3"><div><div className="font-mono text-sm font-semibold">{r.returnNo}</div><div className="mt-1 text-xs text-muted-foreground">فاتورة {r.sale?.invoiceNo || '—'} · {r.customer?.name || 'عميل نقدي'}</div></div><Badge>{formatEGP(r.total)} ج.م</Badge></div>
                <div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>{formatDateTime(r.date)}</span><span>{r.reason || 'بدون سبب'}</span></div>
              </button>)}</div>
              <div className="hidden md:block max-h-[60vh] overflow-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>رقم المرتجع</TableHead><TableHead>الفاتورة</TableHead><TableHead>العميل</TableHead><TableHead>التاريخ</TableHead><TableHead className="text-center">الإجمالي</TableHead><TableHead>السبب</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filteredReturns.map((r) => <TableRow key={r.id}><TableCell className="font-mono text-xs">{r.returnNo}</TableCell><TableCell className="font-mono text-xs">{r.sale?.invoiceNo || '—'}</TableCell><TableCell className="text-xs">{r.customer?.name || 'عميل نقدي'}</TableCell><TableCell className="text-xs">{formatDateTime(r.date)}</TableCell><TableCell className="text-center font-semibold">{formatEGP(r.total)} ج.م</TableCell><TableCell className="text-xs">{r.reason || '—'}</TableCell><TableCell className="text-center"><Button variant="ghost" size="icon" className="size-10" onClick={() => setViewing(r)}><Eye className="size-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={newDialogOpen} onOpenChange={(open) => { if (!open) closeNewReturn(); else setNewDialogOpen(true) }}>
        <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[820px]">
          <DialogHeader className="shrink-0 border-b px-4 py-4 text-right sm:px-6"><DialogTitle>مرتجع بيع جديد</DialogTitle><DialogDescription>ابحث عن الفاتورة ثم حدد الأصناف والكميات المتاحة للإرجاع.</DialogDescription></DialogHeader>
          {!selectedSale ? <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
            <div className="mb-3 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">يمكنك البحث برقم الفاتورة أو اسم العميل. يتم تحميل تفاصيل الفاتورة قبل اختيار الكميات لضمان عرض المتبقي الحقيقي.</div>
            {filteredSales.length === 0 ? <EmptyState title="لا توجد فواتير" description="جرّب تغيير البحث" icon={Search} /> : <div className="space-y-2">{filteredSales.map((s) => <button key={s.id} disabled={loadingSale} onClick={() => openNewReturn(s)} className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border p-3 text-right transition active:scale-[.99] disabled:opacity-50 hover:bg-accent"><div className="min-w-0"><div className="font-mono text-sm font-semibold">{s.invoiceNo}</div><div className="mt-1 truncate text-xs text-muted-foreground">{s.customer?.name || 'عميل نقدي'} · {formatDateTime(s.date)}</div></div><div className="flex shrink-0 items-center gap-2"><span className="font-semibold text-sm">{formatEGP(s.total)} ج.م</span><ArrowRight className="size-4" /></div></button>)}</div>}
          </div> : <>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
              <button className="mb-3 flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground" onClick={() => setSelectedSale(null)}><ArrowRight className="size-4" /> اختيار فاتورة أخرى</button>
              <div className="rounded-xl border bg-muted/20 p-3"><div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-mono font-semibold">{selectedSale.invoiceNo}</span><span>·</span><span>{selectedSale.customer?.name || 'عميل نقدي'}</span><span className="font-bold">{formatEGP(selectedSale.total)} ج.م</span></div></div>

              <div className="mt-3 space-y-2 md:hidden">{selectedSale.items.map((it) => { const remaining = remainingByItem.get(it.id) ?? it.quantity; const ret = returnItems.find((r) => r.saleItemId === it.id); const qty = ret?.quantity || 0; return <div key={it.id} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-medium">{it.variant.product.name}</div><div className="mt-1 text-xs text-muted-foreground">{it.variant.size || 'بدون مقاس'} · {it.variant.color || 'بدون لون'} · <span className="font-mono">{it.variant.sku}</span></div></div><div className="text-left text-sm font-semibold">{formatEGP(it.unitPrice)} ج.م</div></div><div className="mt-3 grid grid-cols-3 items-end gap-2"><div><div className="text-[11px] text-muted-foreground">مباعة</div><div className="font-semibold">{it.quantity}</div></div><div><div className="text-[11px] text-muted-foreground">متبقي للإرجاع</div><div className="font-semibold">{remaining}</div></div><div><Label className="text-[11px]">المرتجع</Label><Input type="number" inputMode="numeric" min={0} max={remaining} value={qty} disabled={remaining === 0} onChange={(e) => { const next = Math.min(remaining, Math.max(0, Math.floor(Number(e.target.value) || 0))); setReturnItems((items) => items.map((r) => r.saleItemId === it.id ? { ...r, quantity: next } : r)) }} className="mt-1 h-11 text-center font-semibold" /></div></div></div> })}</div>
              <div className="mt-3 hidden md:block rounded-md border"><Table><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>SKU</TableHead><TableHead className="text-center">مباعة</TableHead><TableHead className="text-center">متبقي</TableHead><TableHead className="text-center">المرتجع</TableHead><TableHead className="text-center">السعر</TableHead></TableRow></TableHeader><TableBody>{selectedSale.items.map((it) => { const remaining = remainingByItem.get(it.id) ?? it.quantity; const ret = returnItems.find((r) => r.saleItemId === it.id); return <TableRow key={it.id}><TableCell className="text-xs">{it.variant.product.name} ({it.variant.size || '—'} / {it.variant.color || '—'})</TableCell><TableCell className="font-mono text-xs">{it.variant.sku}</TableCell><TableCell className="text-center">{it.quantity}</TableCell><TableCell className="text-center font-semibold">{remaining}</TableCell><TableCell><Input type="number" min={0} max={remaining} value={ret?.quantity || 0} disabled={remaining === 0} onChange={(e) => { const next = Math.min(remaining, Math.max(0, Math.floor(Number(e.target.value) || 0))); setReturnItems((items) => items.map((r) => r.saleItemId === it.id ? { ...r, quantity: next } : r)) }} className="mx-auto h-9 w-20 text-center" /></TableCell><TableCell className="text-center">{formatEGP(it.unitPrice)}</TableCell></TableRow> })}</TableBody></Table></div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="reason">سبب المرتجع <span className="text-muted-foreground">(اختياري)</span></Label><Input id="reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مقاس غير مناسب، عيب، تبديل..." /></div><div className="space-y-1.5"><Label>طريقة رد المبلغ</Label><Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as RefundMethod)}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">نقدي</SelectItem><SelectItem value="card">بطاقة</SelectItem><SelectItem value="credit">رصيد للعميل</SelectItem></SelectContent></Select></div></div>
            </div>
            <DialogFooter className="shrink-0 border-t bg-background p-3 sm:p-6"><div className="flex w-full items-center justify-between gap-3"><div><div className="text-xs text-muted-foreground">إجمالي المرتجع</div><div className="text-xl font-bold">{formatEGP(returnTotal)} ج.م</div></div><Button className="min-h-12 flex-1 sm:flex-none sm:min-w-40" onClick={submitReturn} disabled={!hasItems || createReturn.isPending}>{createReturn.isPending ? 'جارٍ الحفظ...' : 'تأكيد المرتجع'}</Button></div></DialogFooter>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[600px]">{viewing && <><DialogHeader><DialogTitle>تفاصيل المرتجع {viewing.returnNo}</DialogTitle><DialogDescription>الفاتورة: {viewing.sale?.invoiceNo || '—'} · {formatDateTime(viewing.date)}</DialogDescription></DialogHeader><div className="space-y-2">{viewing.items.map((it) => <div key={it.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><div><div className="font-medium">{it.variant.product.name}</div><div className="font-mono text-xs text-muted-foreground">{it.variant.sku}</div></div><div className="text-left"><div>{it.quantity} × {formatEGP(it.unitPrice)}</div><div className="font-semibold">{formatEGP(it.total)} ج.م</div></div></div>)}</div><div className="rounded-xl border bg-muted/30 p-4"><div className="flex justify-between font-bold"><span>إجمالي المرتجع</span><span>{formatEGP(viewing.total)} ج.م</span></div>{viewing.reason && <div className="mt-2 text-xs text-muted-foreground">السبب: {viewing.reason}</div>}<div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4" /> تم تسجيل العملية</div></div></>}</DialogContent></Dialog>
    </div>
  )
}
