'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, ShoppingCart, Eye, Trash2, Minus, PackageSearch, Truck, Wallet, X, Check, Calculator, Banknote } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP, formatDateTime } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'
import { unitLabel } from '@/lib/units'
import { clearIdempotencyKey, withIdempotencyKey } from '@/lib/client-idempotency'

interface Variant { id: string; sku: string; size: string | null; color: string | null; costPrice: number; quantity: number; purchaseUnit?: string; purchaseUnitFactor?: number; baseUnit?: string; product: { name: string } }
interface Supplier { id: string; name: string; balance: number }
interface Purchase { id: string; invoiceNo: string; date: string; subtotal: number; discount: number; taxAmount: number; total: number; paid: number; status: string; notes?: string | null; supplier?: { name: string }; items: { id: string; variantId: string; quantity: number; unitCost: number; total: number; enteredQuantity?: number | null; unit?: string | null; unitFactor?: number | null; variant: { sku: string; size: string | null; color: string | null; baseUnit?: string | null; product: { name: string } } }[] }
interface PurchaseReturnRecord { id: string; returnNo: string; total: number; refundAmount?: number | null; refundMethod?: string | null; items: { id: string; purchaseItemId?: string | null; variantId: string; quantity: number }[] }
interface LineItem { variantId: string; quantity: number; unitCost: number; enteredQuantity: number; unit: string; unitFactor: number }

const QUICK_AMOUNTS = [0, 100, 200, 500, 1000, 2000]
function money(n: number) { return `${formatEGP(n)} ج.م` }
function clampMoney(n: number) { return Math.max(0, Math.round((Number(n) || 0) * 100) / 100) }

function TouchNumberPad({ value, onChange, onDone }: { value: number; onChange: (n: number) => void; onDone?: () => void }) {
  const [raw, setRaw] = useState(String(value || ''))
  function press(k: string) {
    let next = raw
    if (k === 'clear') next = ''
    else if (k === 'back') next = raw.slice(0, -1)
    else if (k === '.') next = raw.includes('.') ? raw : `${raw || '0'}.`
    else next = raw === '0' ? k : raw + k
    setRaw(next)
    onChange(clampMoney(Number(next) || 0))
  }
  return <div className="rounded-3xl border bg-muted/20 p-3 select-none touch-manipulation">
    <div className="mb-3 flex h-14 items-center justify-between rounded-2xl bg-background px-4 text-2xl font-black tabular-nums"><span>{raw || '0'}</span><span className="text-sm font-semibold text-muted-foreground">ج.م</span></div>
    <div className="grid grid-cols-3 gap-2">
      {['1','2','3','4','5','6','7','8','9','.','0','back'].map(k => <Button key={k} type="button" variant="outline" className="h-14 rounded-2xl text-xl font-black" onClick={() => press(k)}>{k === 'back' ? '⌫' : k}</Button>)}
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" variant="outline" className="h-12 rounded-2xl" onClick={() => press('clear')}>مسح</Button><Button type="button" className="h-12 rounded-2xl" onClick={onDone}><Check className="me-1"/> تم</Button></div>
    <Dialog open={Boolean(returningPurchase)} onOpenChange={(isOpen) => { if (!isOpen) closePurchaseReturn() }}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto rounded-3xl p-0">
        <DialogHeader className="border-b px-4 py-4 sm:px-6">
          <DialogTitle>مرتجع شراء · {returningPurchase?.invoiceNo}</DialogTitle>
          <DialogDescription>حدد الكميات التي سترجع للمورد. الكميات المعروضة بوحدة المخزون الأساسية، والبرنامج يمنع تجاوز الكمية التي لم تُرجع من قبل.</DialogDescription>
        </DialogHeader>
        {returningPurchase && <div className="space-y-4 p-4 sm:p-6">
          {purchaseReturnsError && <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">تعذر تحميل المرتجعات السابقة. أغلق النافذة وافتحها مرة أخرى قبل اعتماد أي مرتجع.</div>}
          {purchaseReturnsLoading ? <div className="py-8 text-center text-muted-foreground">جاري التحقق من المرتجعات السابقة...</div> : <div className="space-y-2">
            {returningPurchase.items.map((item) => {
              const already = alreadyReturnedByPurchaseItem.get(item.id) || 0
              const remainingQty = Math.max(0, item.quantity - already)
              const quantity = Math.min(remainingQty, Math.floor(Number(returnQuantities[item.id]) || 0))
              return <div key={item.id} className="rounded-2xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold">{item.variant.product.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.variant.sku}{item.variant.size ? ` · ${item.variant.size}` : ''}{item.variant.color ? ` · ${item.variant.color}` : ''}</div>
                    <div className="mt-1 text-xs text-muted-foreground">مشتراة: {item.quantity} {unitLabel(item.variant.baseUnit || 'piece')} · تم إرجاع: {already} · متبقٍ: {remainingQty}</div>
                  </div>
                  <div className="w-28 shrink-0">
                    <label className="mb-1 block text-xs font-semibold">كمية الإرجاع</label>
                    <input
                      aria-label={`كمية إرجاع ${item.variant.product.name}`}
                      className="h-11 w-full rounded-xl border bg-background px-3 text-center font-bold"
                      type="number"
                      min={0}
                      max={remainingQty}
                      step={1}
                      value={returnQuantities[item.id] ?? ''}
                      disabled={remainingQty <= 0 || purchaseReturnsLoading || purchaseReturnsError}
                      onChange={(event) => {
                        const raw = Math.floor(Number(event.target.value) || 0)
                        setReturnQuantities((current) => ({ ...current, [item.id]: Math.max(0, Math.min(remainingQty, raw)) }))
                      }}
                    />
                  </div>
                </div>
                {quantity > 0 && <div className="mt-2 text-sm text-muted-foreground">قيمة البند التقريبية: {money(quantity * item.unitCost)}</div>}
              </div>
            })}
          </div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">طريقة التسوية</label>
              <select
                className="h-11 w-full rounded-xl border bg-background px-3"
                value={returnMethod}
                onChange={(event) => setReturnMethod(event.target.value as 'cash' | 'card' | 'transfer' | 'credit')}
                disabled={purchaseReturnsLoading || purchaseReturnsError}
              >
                <option value="credit">خصم من حساب المورد</option>
                <option value="cash">استرداد نقدي</option>
                <option value="card">استرداد على البطاقة</option>
                <option value="transfer">استرداد بتحويل</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-semibold">سبب المرتجع (اختياري)</label>
              <input className="h-11 w-full rounded-xl border bg-background px-3" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="تالف، زيادة توريد، اختلاف صنف..." />
            </div>
          </div>
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">إجمالي المرتجع المتوقع</span>
              <b className="text-xl">{money(estimatedReturnTotal)}</b>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">المبلغ المسترد فعليًا يتحدد على الخادم بعد خصم أي مديونية مستحقة للمورد؛ وقد يكون أقل من إجمالي المرتجع.</p>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={closePurchaseReturn} disabled={purchaseReturnMutation.isPending}>إلغاء</Button>
            <Button type="button" className="h-12 rounded-xl" onClick={submitPurchaseReturn} disabled={purchaseReturnMutation.isPending || purchaseReturnsLoading || purchaseReturnsError || estimatedReturnTotal <= 0}>
              {purchaseReturnMutation.isPending ? 'جاري تسجيل المرتجع...' : `اعتماد مرتجع الشراء · ${money(estimatedReturnTotal)}`}
            </Button>
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  </div>
}

export function PurchasesSection() {
  const qc = useQueryClient()
  const submissionKeyRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState<Purchase | null>(null)
  const [returningPurchase, setReturningPurchase] = useState<Purchase | null>(null)
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({})
  const [returnReason, setReturnReason] = useState('')
  const [returnMethod, setReturnMethod] = useState<'cash' | 'card' | 'transfer' | 'credit'>('credit')
  const returnKeyRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([])
  const [productFilter, setProductFilter] = useState('')
  const [moneyEditor, setMoneyEditor] = useState<'discount'|'paid'|'price'|'qty'|null>(null)
  const [editingLine, setEditingLine] = useState<number | null>(null)

  const { data: purchasesData, isLoading } = useQuery<{ items: Purchase[] }>({ queryKey: ['purchases'], queryFn: async () => (await fetch('/api/purchases?pageSize=100')).json() })
  const purchases = purchasesData?.items || []
  const { data: productsData } = useQuery<{ items: { id: string; name: string; variants: Variant[] }[] }>({ queryKey: ['products-for-purchases'], queryFn: async () => (await fetch('/api/products?pageSize=500')).json() })
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ['suppliers'], queryFn: async () => (await fetch('/api/suppliers')).json() })
  const pricingSettingsQuery = useQuery<{ vatEnabled: boolean; vatRate: number; vatInclusive: boolean; currency: string }>({
    queryKey: ['pos-pricing-settings'],
    queryFn: async () => {
      const response = await fetch('/api/pos-settings', { cache: 'no-store' })
      if (!response.ok) throw new Error('تعذر تحميل إعدادات الضريبة؛ لا تعتمد فاتورة بإجمالي غير معروف')
      return response.json()
    },
    staleTime: 60_000,
  })
  const { data: purchaseReturnsData, isLoading: purchaseReturnsLoading, isError: purchaseReturnsError } = useQuery<{ items: PurchaseReturnRecord[] }>({
    queryKey: ['purchase-returns', returningPurchase?.id],
    queryFn: async () => {
      const response = await fetch(`/api/purchase-returns?purchaseId=${encodeURIComponent(returningPurchase!.id)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error((await response.json()).error || 'تعذر تحميل المرتجعات السابقة')
      return response.json()
    },
    enabled: Boolean(returningPurchase),
  })
  const alreadyReturnedByPurchaseItem = useMemo(() => {
    const direct = new Map<string, number>()
    const legacyByVariant = new Map<string, number>()
    if (!returningPurchase) return direct
    for (const returned of purchaseReturnsData?.items || []) {
      for (const item of returned.items || []) {
        if (item.purchaseItemId) direct.set(item.purchaseItemId, (direct.get(item.purchaseItemId) || 0) + item.quantity)
        else legacyByVariant.set(item.variantId, (legacyByVariant.get(item.variantId) || 0) + item.quantity)
      }
    }
    // Older return lines did not store purchaseItemId. Allocate them to original
    // purchase lines of the same variant in stable order, matching the server.
    const byVariant = new Map<string, Purchase['items']>()
    for (const item of [...returningPurchase.items].sort((a, b) => a.id.localeCompare(b.id))) {
      const list = byVariant.get(item.variantId) || []
      list.push(item)
      byVariant.set(item.variantId, list)
    }
    for (const [variantId, rows] of byVariant) {
      let unallocated = legacyByVariant.get(variantId) || 0
      for (const item of rows) {
        const room = Math.max(0, item.quantity - (direct.get(item.id) || 0))
        const allocated = Math.min(unallocated, room)
        if (allocated > 0) direct.set(item.id, (direct.get(item.id) || 0) + allocated)
        unallocated -= allocated
      }
    }
    return direct
  }, [returningPurchase, purchaseReturnsData])
  const allVariants = useMemo(() => (productsData?.items || []).flatMap(p => p.variants.map(v => ({ ...v, productName: p.name }))), [productsData])
  const products = useMemo(() => {
    const q = productFilter.trim().toLowerCase()
    return allVariants.filter(v => !q || v.productName.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q)).slice(0, 60)
  }, [allVariants, productFilter])
  const filteredPurchases = purchases.filter(p => !search || p.invoiceNo.toLowerCase().includes(search.toLowerCase()) || p.supplier?.name.toLowerCase().includes(search.toLowerCase()))
  const roundCurrencyAmount = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  const subtotal = roundCurrencyAmount(items.reduce((sum, item) => (
    sum + roundCurrencyAmount(item.enteredQuantity * item.unitCost)
  ), 0))
  const discountAmount = roundCurrencyAmount(discount)
  const taxable = roundCurrencyAmount(Math.max(0, subtotal - discountAmount))
  const vatEnabled = pricingSettingsQuery.data?.vatEnabled === true
  const vatRate = Math.max(0, Math.min(100, Number(pricingSettingsQuery.data?.vatRate) || 0))
  const vatInclusive = pricingSettingsQuery.data?.vatInclusive === true
  const taxAmount = roundCurrencyAmount(vatEnabled
    ? (vatInclusive ? taxable - taxable / (1 + vatRate / 100) : taxable * vatRate / 100)
    : 0)
  const total = roundCurrencyAmount(vatEnabled && vatInclusive ? taxable : taxable + taxAmount)
  const paidAmount = roundCurrencyAmount(paid)
  const remaining = roundCurrencyAmount(Math.max(0, total - paidAmount))

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const payload = withIdempotencyKey(data, submissionKeyRef)
      const r = await fetch('/api/purchases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!r.ok) throw new Error((await r.json()).error || 'فشل حفظ الفاتورة')
      return r.json()
    },
    onSuccess: () => {
      clearIdempotencyKey(submissionKeyRef)
      qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['suppliers'] }); qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success('تم تسجيل فاتورة الشراء وتحديث المخزون'); setOpen(false); reset()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const voidMutation = useMutation({ mutationFn: async (purchaseId: string) => { const r = await fetch(`/api/purchases/${purchaseId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'void', voidReason: 'إلغاء من شاشة المشتريات' }) }); if (!r.ok) throw new Error((await r.json()).error || 'فشل إلغاء الفاتورة'); return r.json() }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['suppliers'] }); toast.success('تم إلغاء فاتورة الشراء وإرجاع المخزون'); setViewing(null) }, onError: (e: Error) => toast.error(e.message) })
  const purchaseReturnMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const safePayload = withIdempotencyKey(payload, returnKeyRef)
      const response = await fetch('/api/purchase-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safePayload),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'فشل تسجيل مرتجع الشراء')
      return body
    },
    onSuccess: (result: { returnNo: string; total: number; refundAmount?: number | null; refundMethod?: string | null }) => {
      clearIdempotencyKey(returnKeyRef)
      toast.success(`تم تسجيل المرتجع ${result.returnNo} بقيمة ${money(result.total)}${result.refundMethod === 'credit' ? ' على حساب المورد' : ` · المسترد فعليًا ${money(result.refundAmount || 0)}`}`)
      qc.invalidateQueries({ queryKey: ['purchases'] })
      qc.invalidateQueries({ queryKey: ['purchase-returns'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      setReturningPurchase(null)
      setReturnQuantities({})
      setReturnReason('')
      setReturnMethod('credit')
      setViewing(null)
    },
    onError: (error: Error) => toast.error(error.message),
  })
  function openPurchaseReturn(purchase: Purchase) {
    clearIdempotencyKey(returnKeyRef)
    setReturnQuantities({})
    setReturnReason('')
    setReturnMethod('credit')
    setReturningPurchase(purchase)
  }
  function closePurchaseReturn() {
    clearIdempotencyKey(returnKeyRef)
    setReturningPurchase(null)
    setReturnQuantities({})
  }
  function submitPurchaseReturn() {
    if (!returningPurchase) return
    const returnItems = returningPurchase.items
      .map((item) => ({ purchaseItemId: item.id, quantity: Math.floor(Number(returnQuantities[item.id]) || 0) }))
      .filter((item) => item.quantity > 0)
    if (!returnItems.length) return toast.error('حدد كمية واحدة على الأقل للإرجاع')
    const tooLarge = returnItems.some((item) => item.quantity > Math.max(0,
      (returningPurchase.items.find((purchaseItem) => purchaseItem.id === item.purchaseItemId)?.quantity || 0) -
      (alreadyReturnedByPurchaseItem.get(item.purchaseItemId) || 0)))
    if (tooLarge) return toast.error('إحدى الكميات تتجاوز الكمية المتبقية للإرجاع')
    purchaseReturnMutation.mutate({
      purchaseId: returningPurchase.id,
      reason: returnReason.trim() || null,
      refundMethod: returnMethod,
      items: returnItems,
    })
  }
  const estimatedReturnSubtotal = returningPurchase?.items.reduce((sum, item) => {
    const quantity = Math.floor(Number(returnQuantities[item.id]) || 0)
    return sum + item.unitCost * quantity
  }, 0) || 0
  const estimatedReturnTotal = returningPurchase && returningPurchase.subtotal > 0
    ? Math.round((estimatedReturnSubtotal * returningPurchase.total / returningPurchase.subtotal + Number.EPSILON) * 100) / 100
    : 0
  function reset() { setSupplierId(''); setDiscount(0); setPaid(0); setPaymentMethod('cash'); setNotes(''); setItems([]); setProductFilter(''); setMoneyEditor(null); setEditingLine(null) }
  function add(v: any) { if (items.some(i => i.variantId === v.id)) return toast.info('الصنف موجود بالفعل'); const unit = v.purchaseUnit || 'piece'; const factor = Number(v.purchaseUnitFactor) || 1; setItems([...items, { variantId: v.id, quantity: factor, enteredQuantity: 1, unitCost: (v.costPrice || 0) * factor, unit, unitFactor: factor }]); }
  function update(i: number, patch: Partial<LineItem>) { setItems(items.map((x, idx) => idx === i ? { ...x, ...patch } : x)) }
  function remove(i: number) { setItems(items.filter((_, idx) => idx !== i)) }
  function submit() { if (!supplierId) return toast.error('اختر المورد'); if (!items.length) return toast.error('أضف صنفًا واحدًا على الأقل'); if (items.some(i => i.enteredQuantity <= 0 || i.unitCost <= 0)) return toast.error('راجع الكميات والأسعار'); if (paid > total) return toast.error('المدفوع أكبر من الإجمالي'); createMutation.mutate({ supplierId, discount: Number(discount) || 0, paid: Number(paid) || 0, paymentMethod, notes, status: 'completed', items: items.map(i => ({ variantId: i.variantId, quantity: i.quantity, unitCost: i.unitCost, enteredQuantity: i.enteredQuantity, unit: i.unit, unitFactor: i.unitFactor })) }) }

  return <div className="space-y-4 pb-28">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">فواتير الشراء</h2><p className="text-sm text-muted-foreground">Touch First · شراء → مخزون → حساب المورد</p></div><Button className="h-14 rounded-2xl px-5 text-base font-bold" onClick={() => { reset(); setOpen(true) }}><Plus className="me-2"/> فاتورة شراء</Button></div>
    <Card><CardContent className="p-3"><button type="button" className="flex h-12 w-full items-center gap-2 rounded-xl border bg-background px-4 text-right text-sm text-muted-foreground" onClick={() => toast.info('البحث في قائمة الفواتير متاح من هذا الزر')}>🔎 البحث في الفواتير</button></CardContent></Card>
    {isLoading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl"/>)}</div> : filteredPurchases.length === 0 ? <EmptyState title="لا توجد فواتير شراء" description="أنشئ أول فاتورة شراء" icon={ShoppingCart}/> : <div className="space-y-2">{filteredPurchases.map(p => <Card key={p.id} className="rounded-2xl"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-bold">{p.invoiceNo}</div><div className="mt-1 text-sm text-muted-foreground">{p.supplier?.name || 'بدون مورد'} · {formatDateTime(p.date)}</div></div><Badge variant={p.total - p.paid > 0 ? 'destructive' : 'default'}>{p.total - p.paid > 0 ? 'متبقي' : 'مدفوع'}</Badge></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-muted/50 p-2"><div className="text-[11px] text-muted-foreground">الأصناف</div><b>{p.items.length}</b></div><div className="rounded-xl bg-muted/50 p-2"><div className="text-[11px] text-muted-foreground">الإجمالي</div><b>{money(p.total)}</b></div><div className="rounded-xl bg-muted/50 p-2"><div className="text-[11px] text-muted-foreground">المتبقي</div><b>{money(Math.max(0, p.total - p.paid))}</b></div></div><Button variant="outline" className="mt-3 h-12 w-full rounded-2xl" onClick={() => setViewing(p)}><Eye className="me-2"/> عرض الفاتورة</Button></CardContent></Card>)}</div>}

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="h-[100dvh] w-screen max-w-none rounded-none p-0 overflow-hidden sm:h-[96dvh] sm:w-[calc(100vw-2rem)] sm:max-w-6xl sm:rounded-3xl"><div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b px-4 py-4"><div className="flex items-center justify-between"><div><DialogTitle className="text-xl font-black">فاتورة شراء جديدة</DialogTitle><DialogDescription>كل خطوات الفاتورة باللمس — بدون لوحة مفاتيح</DialogDescription></div><Button variant="outline" size="icon" className="size-11 rounded-2xl" onClick={() => setOpen(false)}><X/></Button></div></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5"><div className="grid gap-4 lg:grid-cols-[1.35fr_.95fr]">
        <div className="space-y-4">
          <section className="rounded-3xl border p-3 sm:p-4"><div className="mb-3 flex items-center gap-2"><Truck className="size-5 text-primary"/><h3 className="font-black">1 · اختر المورد</h3></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{suppliers.map(s => <button key={s.id} type="button" onClick={() => setSupplierId(s.id)} className={`min-h-20 rounded-2xl border p-3 text-right transition active:scale-[.98] ${supplierId === s.id ? 'border-primary bg-primary/10 ring-2 ring-primary/20' : 'bg-card'}`}><div className="font-bold">{s.name}</div><div className="mt-1 text-xs text-muted-foreground">{s.balance > 0 ? `عليه ${money(s.balance)}` : 'حسابه سليم'}</div></button>)}</div>{!suppliers.length && <div className="rounded-2xl bg-muted/40 p-4 text-center text-sm text-muted-foreground">أضف موردًا أولاً</div>}</section>

          <section className="rounded-3xl border p-3 sm:p-4"><div className="mb-3 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><PackageSearch className="size-5 text-primary"/><h3 className="font-black">2 · أضف الأصناف</h3></div><Badge variant="outline">{items.length} صنف</Badge></div><div className="mb-3 grid grid-cols-3 gap-2"><Button type="button" variant={!productFilter ? 'default' : 'outline'} className="h-11 rounded-2xl" onClick={() => setProductFilter('')}>الكل</Button><Button type="button" variant={productFilter === 'مقاس' ? 'default' : 'outline'} className="h-11 rounded-2xl" onClick={() => setProductFilter('مقاس')}>مقاسات</Button><Button type="button" variant={productFilter === 'لون' ? 'default' : 'outline'} className="h-11 rounded-2xl" onClick={() => setProductFilter('لون')}>ألوان</Button></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{products.map(v => <button key={v.id} type="button" onClick={() => add(v)} className={`min-h-28 rounded-2xl border p-3 text-right transition active:scale-[.98] ${items.some(i => i.variantId === v.id) ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-card hover:bg-muted/40'}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-bold leading-tight">{v.productName}</div><div className="mt-1 text-xs text-muted-foreground">{v.size || 'مقاس عام'}{v.color ? ` · ${v.color}` : ''}</div></div>{items.some(i => i.variantId === v.id) && <Check className="size-5 shrink-0 text-emerald-600"/>}</div><div className="mt-3 text-xs text-primary">{unitLabel(v.purchaseUnit || 'piece')} × {v.purchaseUnitFactor || 1}</div><div className="mt-1 text-sm font-black">{money((v.costPrice || 0) * (v.purchaseUnitFactor || 1))}</div></button>)}</div></section>

          <section className="space-y-2"><div className="flex items-center gap-2 px-1"><ShoppingCart className="size-5 text-primary"/><h3 className="font-black">3 · الأصناف داخل الفاتورة</h3></div>{items.length === 0 ? <Card className="rounded-3xl border-dashed"><CardContent className="py-12 text-center text-muted-foreground">اضغط على أي صنف لإضافته</CardContent></Card> : items.map((it, i) => { const v = allVariants.find(x => x.id === it.variantId); const lineTotal = it.enteredQuantity * it.unitCost; const perPieceCost = it.unitCost / (it.unitFactor || 1); return <Card key={it.variantId} className="rounded-3xl overflow-hidden"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-lg font-black">{v?.productName || 'منتج'}</div><div className="text-sm text-muted-foreground">{v?.size || 'مقاس عام'}{v?.color ? ` · ${v.color}` : ''} · {v?.sku}</div></div><Button variant="outline" size="icon" className="size-11 rounded-2xl text-destructive" onClick={() => remove(i)}><Trash2/></Button></div>
            <div className="mt-3"><div className="mb-1.5 text-xs text-muted-foreground">وحدة الشراء</div><div className="grid grid-cols-4 gap-1.5">{([['piece','قطعة',1],['quarter-dozen','ربع دستة',3],['half-dozen','نص دستة',6],['dozen','دستة',12]] as const).map(([code,label,factor]) => <button key={code} type="button" onClick={() => { const newFactor = factor; const newCost = Math.round(perPieceCost * newFactor * 100) / 100; update(i, { unit: code, unitFactor: newFactor, unitCost: newCost, quantity: it.enteredQuantity * newFactor }) }} className={`rounded-xl border py-2 text-xs font-black active:scale-[.98] ${it.unitFactor === factor ? 'border-primary bg-primary/10 text-primary' : 'bg-card text-muted-foreground'}`}>{label}</button>)}</div></div>
            <div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-muted/40 p-2"><div className="mb-1 text-center text-xs text-muted-foreground">الكمية ({unitLabel(it.unit)})</div><div className="flex h-12 items-center"><Button type="button" variant="outline" className="size-12 shrink-0 rounded-xl" onClick={() => { const q = Math.max(1, it.enteredQuantity - 1); update(i, { enteredQuantity: q, quantity: q * it.unitFactor }) }}><Minus/></Button><button type="button" className="flex-1 text-center text-xl font-black tabular-nums active:opacity-60" onClick={() => { setEditingLine(i); setMoneyEditor('qty') }}>{it.enteredQuantity}</button><Button type="button" variant="outline" className="size-12 shrink-0 rounded-xl" onClick={() => { const q = it.enteredQuantity + 1; update(i, { enteredQuantity: q, quantity: q * it.unitFactor }) }}><Plus/></Button></div><div className="mt-1 text-center text-[11px] text-primary">اضغط الرقم للكتابة المباشرة</div></div><button type="button" className="rounded-2xl border p-3 text-right active:scale-[.99]" onClick={() => { setEditingLine(i); setMoneyEditor('price') }}><div className="text-xs text-muted-foreground">سعر {unitLabel(it.unit)}</div><div className="mt-1 text-lg font-black">{money(it.unitCost)}</div><div className="text-[11px] text-primary">اضغط للتعديل</div></button></div>
            <div className="mt-3 rounded-2xl bg-primary/5 p-3"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">إجمالي البند</span><span className="text-lg font-black">{money(lineTotal)}</span></div><div className="mt-0.5 text-[11px] text-muted-foreground">= {it.quantity} {unitLabel(v?.baseUnit)}</div></div>
          </CardContent></Card> })}</section>
        </div>

        <aside className="lg:sticky lg:top-0 lg:h-fit"><Card className="rounded-3xl border-2 overflow-hidden"><CardContent className="p-0"><div className="border-b bg-muted/30 p-4"><div className="flex items-center gap-2"><Calculator className="size-5 text-primary"/><h3 className="font-black">ملخص الفاتورة</h3></div></div><div className="space-y-3 p-4"><div className="flex justify-between"><span>قبل الخصم</span><b>{money(subtotal)}</b></div><button type="button" className="flex w-full items-center justify-between rounded-2xl border p-3 text-right" onClick={() => setMoneyEditor('discount')}><span>الخصم</span><b>{money(discount)}</b></button>{vatEnabled && <div className="flex justify-between text-sm"><span>{vatInclusive ? 'ضريبة القيمة المضافة (ضمن السعر)' : 'ضريبة القيمة المضافة'}</span><b>{money(taxAmount)}</b></div>}<div className="flex items-center justify-between rounded-2xl bg-primary/10 p-4"><span className="font-bold">الإجمالي بعد الضريبة</span><b className="text-2xl font-black">{money(total)}</b></div><button type="button" className="flex w-full items-center justify-between rounded-2xl border p-3 text-right" onClick={() => setMoneyEditor('paid')}><span className="flex items-center gap-2"><Banknote className="size-5"/> المدفوع</span><b>{money(paid)}</b></button><div className="rounded-2xl bg-muted/50 p-3"><div className="flex justify-between text-sm"><span>المتبقي للمورد</span><b>{money(remaining)}</b></div></div><div><div className="mb-2 text-sm font-bold">طريقة الدفع</div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['cash','💵 نقدي'],['card','💳 بطاقة'],['transfer','🔄 تحويل'],['credit','📒 آجل']].map(([id,label]) => <button key={id} type="button" onClick={() => { setPaymentMethod(id); setPaid(id === 'credit' ? 0 : total) }} className={`h-14 rounded-2xl border text-sm font-bold ${paymentMethod === id ? 'border-primary bg-primary/10 ring-2 ring-primary/20' : ''}`}>{label}</button>)}</div></div><button type="button" className="h-12 w-full rounded-2xl border p-3 text-right text-sm" onClick={() => setNotes(notes ? '' : 'تمت المراجعة')}>📝 {notes || 'إضافة ملاحظة'}</button></div></CardContent></Card></aside>
      </div></div>
      <div className="shrink-0 border-t bg-background p-3"><div className="mx-auto flex max-w-6xl gap-2"><Button variant="outline" className="h-14 flex-1 rounded-2xl text-base" onClick={() => setOpen(false)}>إلغاء</Button><Button className="h-14 flex-[2] rounded-2xl text-base font-black" onClick={submit} disabled={createMutation.isPending || !items.length || !supplierId || pricingSettingsQuery.isLoading || pricingSettingsQuery.isError}><Wallet className="me-2"/>{createMutation.isPending ? 'جاري الحفظ...' : `حفظ الفاتورة · ${money(total)}`}</Button></div></div>
    </div></DialogContent></Dialog>

    <Dialog open={!!moneyEditor} onOpenChange={() => { setMoneyEditor(null); setEditingLine(null) }}><DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-3xl p-4"><DialogHeader><DialogTitle>{moneyEditor === 'price' ? 'تعديل سعر الوحدة' : moneyEditor === 'qty' ? 'إدخال الكمية' : moneyEditor === 'discount' ? 'إدخال الخصم' : 'إدخال المدفوع'}</DialogTitle><DialogDescription>لوحة أرقام Touch — لا تحتاج لوحة مفاتيح الجهاز</DialogDescription></DialogHeader><TouchNumberPad value={moneyEditor === 'price' && editingLine !== null ? items[editingLine]?.unitCost || 0 : moneyEditor === 'qty' && editingLine !== null ? items[editingLine]?.enteredQuantity || 0 : moneyEditor === 'discount' ? discount : paid} onChange={n => { if (moneyEditor === 'price' && editingLine !== null) update(editingLine, { unitCost: n }); else if (moneyEditor === 'qty' && editingLine !== null) { const q = Math.max(1, Math.round(n)); update(editingLine, { enteredQuantity: q, quantity: q * items[editingLine].unitFactor }) } else if (moneyEditor === 'discount') setDiscount(n); else if (moneyEditor === 'paid') setPaid(n) }} onDone={() => { setMoneyEditor(null); setEditingLine(null) }}/></DialogContent></Dialog>

    <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}><DialogContent className="w-[calc(100vw-1rem)] max-w-2xl rounded-3xl"><DialogHeader><DialogTitle className="flex items-center gap-2">فاتورة {viewing?.invoiceNo}{viewing?.status === 'voided' && <Badge variant="destructive">ملغاة</Badge>}</DialogTitle><DialogDescription>{viewing?.supplier?.name} · {viewing && formatDateTime(viewing.date)}</DialogDescription></DialogHeader>{viewing && <div className="max-h-[60vh] space-y-2 overflow-y-auto">{viewing.items.map(it => <div key={it.id} className="rounded-2xl border p-3"><div className="font-bold">{it.variant.product.name}</div><div className="text-xs text-muted-foreground">{it.variant.sku}{it.variant.size ? ` · ${it.variant.size}` : ''}{it.variant.color ? ` · ${it.variant.color}` : ''}</div><div className="mt-2 flex justify-between text-sm"><span>{it.enteredQuantity || it.quantity} {unitLabel(it.unit || 'piece')}</span><b>{money(it.total)}</b></div></div>)}<div className="rounded-2xl bg-muted/50 p-4"><div className="flex justify-between"><span>الإجمالي</span><b>{money(viewing.total)}</b></div><div className="mt-1 flex justify-between"><span>المدفوع</span><b>{money(viewing.paid)}</b></div><div className="mt-1 flex justify-between"><span>المتبقي</span><b>{money(Math.max(0, viewing.total - viewing.paid))}</b></div></div>{viewing.status === 'completed' && <div className="grid gap-2 sm:grid-cols-2"><Button variant="outline" className="h-12 w-full rounded-2xl" onClick={() => openPurchaseReturn(viewing)}><PackageSearch className="me-2 size-4"/> مرتجع للمورد</Button><Button variant="destructive" className="h-12 w-full rounded-2xl" disabled={voidMutation.isPending} onClick={() => { if (confirm('هل تريد إلغاء فاتورة الشراء دي؟ هيتم رجوع المخزون اللي دخل بيها.')) voidMutation.mutate(viewing.id) }}><Trash2 className="me-2 size-4"/> {voidMutation.isPending ? 'جاري الإلغاء...' : 'إلغاء الفاتورة'}</Button></div>}</div>}</DialogContent></Dialog>
  </div>
}
