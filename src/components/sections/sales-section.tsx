'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Banknote, Barcode, CheckCircle2, Eye, History, Menu, Pause, Play, Plus, Printer, ReceiptText, Search, Share2, Trash2, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime, formatEGP, saleStatusBadgeVariant, saleStatusLabel } from '@/lib/format'
import { useAppStore } from '@/lib/store'

type Role = 'admin' | 'manager' | 'cashier'
interface SessionUser { id: string; username: string; name: string; role: Role }
interface Variant { id: string; sku: string; barcode: string | null; size: string | null; color: string | null; sellPrice: number; quantity: number; product: { id: string; name: string }; saleUnit?: string | null; saleUnitFactor?: number | null; quarterDozenPrice?: number | null; halfDozenPrice?: number | null; dozenPrice?: number | null }
interface Product { id: string; name: string; category?: { id: string; name: string } | null; variants: Variant[] }
interface Customer { id: string; name: string; phone?: string | null }
interface CartItem { variantId: string; name: string; sku: string; size: string | null; color: string | null; price: number; quantity: number; max: number; unit: string; factor: number; packLabel?: string }
interface Sale { id: string; invoiceNo: string; date: string; total: number; paid: number; change: number; paymentMethod: string; status: string; customer?: { name: string } | null; items: Array<{ id: string; quantity: number; total: number; variant: { product: { name: string }; sku: string; size: string | null; color: string | null } }> }

function money(v: number) { return `${formatEGP(v)} ج.م` }

export function SalesSection({ user }: { user: SessionUser }) {
  const qc = useQueryClient()
  const setSection = useAppStore(s => s.setSection)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [unitPickerFor, setUnitPickerFor] = useState<{ v: Variant; productName: string } | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false)
  const [customerDialog, setCustomerDialog] = useState(false)
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '' })
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'transfer' | 'credit'>('cash')
  const [paid, setPaid] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [checkout, setCheckout] = useState(false)
  const [historical, setHistorical] = useState(false)
  const [saleDate, setSaleDate] = useState(new Date().toISOString().slice(0, 10))
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewing, setViewing] = useState<Sale | null>(null)
  const [printing, setPrinting] = useState<Sale | null>(null)

  const { data: shiftData, isLoading: shiftLoading } = useQuery<{ items: Array<{ id: string; status: string; openingFloat: number }> }>({
    queryKey: ['register-sessions'],
    queryFn: async () => { const r = await fetch('/api/register-sessions'); if (!r.ok) throw new Error('register'); return r.json() },
    refetchInterval: 30000,
  })
  const openShift = shiftData?.items?.find(x => x.status === 'open')

  const productsQuery = useQuery<{ items: Product[] }>({ queryKey: ['pos-products'], queryFn: async () => { const r = await fetch('/api/products?pageSize=500'); if (!r.ok) throw new Error('products'); return r.json() }, staleTime: 30000 })
  const customersQuery = useQuery<Customer[]>({ queryKey: ['customers'], queryFn: async () => { const r = await fetch('/api/customers'); if (!r.ok) throw new Error('customers'); return r.json() }, staleTime: 30000 })
  const salesQuery = useQuery<{ items: Sale[] }>({ queryKey: ['sales'], queryFn: async () => { const r = await fetch('/api/sales?pageSize=100'); if (!r.ok) throw new Error('sales'); return r.json() } })

  const products = productsQuery.data?.items || []
  const customers = customersQuery.data || []
  const sales = salesQuery.data?.items || []

  const categoryCounts = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>()
    for (const p of products) {
      const id = p.category?.id || 'none'
      const name = p.category?.name || 'بدون تصنيف'
      const cur = map.get(id)
      if (cur) cur.count += 1
      else map.set(id, { id, name, count: 1 })
    }
    return Array.from(map.values())
  }, [products])
  const categories = useMemo(() => [{ id: 'all', name: 'الكل', count: products.length }, ...categoryCounts], [products, categoryCounts])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => (category === 'all' || (p.category?.id || 'none') === category) && (!q || p.name.toLowerCase().includes(q) || p.variants.some(v => v.sku.toLowerCase().includes(q) || (v.barcode || '').includes(q)))).slice(0, 100)
  }, [products, search, category])

  const selectedCustomer = customers.find(c => c.id === customerId)
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0)
  const total = Math.max(0, subtotal - discount)
  const change = Math.max(0, paid - total)
  const remaining = Math.max(0, total - paid)

  const saveCustomer = useMutation({
    mutationFn: async (data: { name: string; phone: string }) => { const r = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'تعذر إضافة العميل'); return j },
    onSuccess: (c: Customer) => { qc.invalidateQueries({ queryKey: ['customers'] }); setCustomerId(c.id); setCustomerDialog(false); setCustomerForm({ name: '', phone: '' }); toast.success('تم إضافة العميل') },
    onError: (e: Error) => toast.error(e.message),
  })
  const saveSale = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => { const r = await fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'تعذر حفظ الفاتورة'); return j as Sale },
    onSuccess: (sale: Sale) => { qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['pos-products'] }); qc.invalidateQueries({ queryKey: ['register-sessions'] }); setCheckout(false); setPrinting(sale); resetSale(); toast.success(`تمت الفاتورة ${sale.invoiceNo}`) },
    onError: (e: Error) => toast.error(e.message),
  })

  useEffect(() => { setTimeout(() => barcodeRef.current?.focus(), 150) }, [])

  function resetSale() { setCart([]); setCustomerId(''); setCustomerPickerOpen(false); setPaymentMethod('cash'); setPaid(0); setDiscount(0); setHistorical(false); setSaleDate(new Date().toISOString().slice(0, 10)); setSearch(''); setTimeout(() => barcodeRef.current?.focus(), 100) }

  function hasPackPricing(v: Variant) { return (v.quarterDozenPrice ?? 0) > 0 || (v.halfDozenPrice ?? 0) > 0 || (v.dozenPrice ?? 0) > 0 }
  function chooseProduct(p: Product) {
    const available = p.variants.filter(v => v.quantity > 0)
    if (!available.length) return toast.error('الصنف غير متوفر')
    if (available.length === 1) return handlePickVariant(available[0], p.name)
    setSelectedProduct(p)
  }
  function handlePickVariant(v: Variant, productName: string) {
    if (v.quantity <= 0) return toast.error('الصنف غير متوفر')
    if (hasPackPricing(v)) setUnitPickerFor({ v, productName })
    else addVariant(v, productName)
  }
  function addVariant(v: Variant, productName = v.product.name, pack?: { factor: number; price: number; unit: string; label: string }) {
    if (v.quantity <= 0) return toast.error('الصنف غير متوفر')
    const factor = pack?.factor ?? (Number(v.saleUnitFactor) || 1)
    const unit = pack?.unit ?? (v.saleUnit || 'piece')
    const price = pack?.price ?? v.sellPrice
    if (v.quantity < factor) return toast.error('لا يوجد مخزون كافٍ لهذه الوحدة')
    setCart(prev => {
      const found = prev.find(i => i.variantId === v.id && i.unit === unit)
      if (found) {
        if ((found.quantity + 1) * factor > v.quantity) { toast.error('لا يوجد مخزون كافٍ'); return prev }
        return prev.map(i => i === found ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { variantId: v.id, name: productName, sku: v.sku, size: v.size, color: v.color, price, quantity: 1, max: v.quantity, unit, factor, packLabel: pack?.label }]
    })
    setSelectedProduct(null); setUnitPickerFor(null); setSearch(''); setTimeout(() => barcodeRef.current?.focus(), 50)
  }
  function changeQty(index: number, delta: number) { setCart(c => c.map((x, k) => k === index ? { ...x, quantity: Math.max(1, Math.min(Math.floor(x.max / x.factor), x.quantity + delta)) } : x)) }
  function removeItem(index: number) { setCart(c => c.filter((_, k) => k !== index)) }

  function scanBarcode(code: string) {
    if (!code.trim()) return
    const found = products.flatMap(p => p.variants.map(v => ({ v, name: p.name }))).find(x => x.v.barcode === code || x.v.sku === code)
    if (found) handlePickVariant(found.v, found.name)
    else toast.error('الباركود غير موجود')
  }

  function quickPay(m: 'cash' | 'card' | 'transfer' | 'credit') { setPaymentMethod(m); setPaid(m === 'credit' ? 0 : total) }

  function submit() {
    if (!cart.length) return toast.error('أضف صنفًا أولًا')
    if (discount > subtotal) return toast.error('الخصم أكبر من الإجمالي')
    if (paymentMethod === 'credit' && !customerId) return toast.error('اختر العميل للبيع الآجل')
    if (paymentMethod !== 'credit' && paid < total) return toast.error('المبلغ المدفوع غير مكتمل')
    const payload = {
      customerId: customerId || undefined,
      date: (historical && user.role !== 'cashier') ? saleDate : undefined,
      discount,
      paid: paymentMethod === 'credit' ? 0 : paid,
      paymentMethod,
      status: 'completed',
      items: cart.map(i => ({ variantId: i.variantId, quantity: i.quantity * i.factor, unitPrice: i.price / i.factor })),
      idempotencyKey: `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }
    saveSale.mutate(payload)
  }
  function shareReceipt(s: Sale) {
    const text = `طيبة\nفاتورة ${s.invoiceNo}\nالتاريخ: ${formatDateTime(s.date)}\nالإجمالي: ${money(s.total)}`
    if (navigator.share) { void navigator.share({ title: `فاتورة ${s.invoiceNo}`, text }).catch(() => {}) }
    else { void navigator.clipboard?.writeText(text); toast.success('تم نسخ ملخص الفاتورة') }
  }

  if (user.role === 'cashier' && shiftLoading) return <div className="p-6"><Skeleton className="h-40 w-full rounded-3xl" /></div>
  if (user.role === 'cashier' && !openShift) return <Card className="mx-auto mt-8 max-w-xl p-8 text-center"><Banknote className="mx-auto size-12 text-primary" /><h2 className="mt-4 text-2xl font-black">الوردية غير مفتوحة</h2><p className="mt-2 text-muted-foreground">لا يمكن للكاشير إصدار فواتير قبل فتح الوردية.</p><Button className="mt-5 h-12" onClick={() => setSection('register')}>فتح الوردية</Button></Card>

  return <div className="flex h-[100dvh] flex-col overflow-hidden bg-muted/10 lg:h-auto lg:min-h-[calc(100vh-8rem)] lg:rounded-3xl lg:border">
    {/* Top bar */}
    <div className="shrink-0 border-b bg-background px-3 py-2.5 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-10 rounded-2xl lg:hidden" onClick={() => setSection('dashboard')} aria-label="لوحة التحكم"><Menu className="size-5" /></Button>
          <ReceiptText className="size-5 text-primary" /><b className="text-lg">نقطة البيع</b>
          {openShift && <Badge className="hidden xs:inline-flex">وردية مفتوحة</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-10 rounded-2xl" onClick={() => setHistoryOpen(true)} aria-label="سجل الفواتير"><History className="size-5" /></Button>
          {user.role !== 'cashier' && <Button variant="outline" size="sm" className="h-10 rounded-2xl" onClick={() => setHistorical(v => !v)}>{historical ? 'بيع عادي' : 'مبيعات سابقة'}</Button>}
        </div>
      </div>
      {historical && <div className="mt-2.5 flex flex-wrap items-end gap-3 rounded-2xl border bg-muted/30 p-3"><div><Label className="text-xs">تاريخ الفاتورة الورقية</Label><Input type="date" value={saleDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setSaleDate(e.target.value)} className="mt-1 h-11" /></div><p className="text-xs text-muted-foreground">لإدخال فواتير الورق بتاريخها الحقيقي.</p></div>}
    </div>

    {/* Search */}
    <div className="shrink-0 border-b bg-background px-3 py-2.5 sm:px-4">
      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={e => setSearch(e.target.value)} className="h-12 w-full rounded-2xl border bg-muted/30 px-11 text-sm outline-none focus:ring-2 focus:ring-primary/30" placeholder="ابحث بالباركود أو الاسم أو SKU..." /></div>
        <input ref={barcodeRef} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); scanBarcode((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = '' } }} inputMode="none" autoComplete="off" className="absolute size-px opacity-0" tabIndex={-1} aria-hidden />
        <Button type="button" size="icon" className="size-12 shrink-0 rounded-2xl" onClick={() => { const code = prompt('أدخل الباركود'); if (code) scanBarcode(code) }} aria-label="مسح باركود"><Barcode className="size-5" /></Button>
      </div>
    </div>

    {/* Category chips — text only */}
    <div className="shrink-0 border-b bg-background px-3 py-2 sm:px-4">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 touch-pan-x">
        {categories.map(c => <button key={c.id} type="button" onClick={() => setCategory(c.id)} className={`flex min-w-max items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black active:scale-[.98] ${category === c.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card'}`}><span>{c.name}</span><span className={category === c.id ? 'text-primary-foreground/80' : 'text-muted-foreground'}>({c.count})</span></button>)}
      </div>
    </div>

    {/* Body: products + cart */}
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[1fr_400px]">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {productsQuery.isLoading ? <div className="grid grid-cols-3 gap-2">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-[6.5rem] rounded-2xl" />)}</div> :
          visible.length === 0 ? <div className="py-16 text-center text-muted-foreground">لا توجد أصناف مطابقة</div> :
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
            {visible.map(p => {
              const stock = p.variants.reduce((s, v) => s + v.quantity, 0)
              const minPrice = p.variants.length ? Math.min(...p.variants.map(v => v.sellPrice)) : 0
              const outOfStock = stock === 0
              return <div key={p.id} className="flex h-[6.5rem] flex-col rounded-2xl border bg-card p-2 shadow-sm">
                <div className="line-clamp-1 text-[12px] font-black leading-tight">{p.name}</div>
                <div className="text-[9px] text-muted-foreground">{p.variants.length} {p.variants.length === 1 ? 'خيار' : 'مقاسات/ألوان'}</div>
                <div className="mt-auto flex items-center justify-between">
                  <span className="text-[12px] font-black text-primary">{money(minPrice)}</span>
                  <span className={`text-[9px] ${outOfStock ? 'text-destructive' : 'text-muted-foreground'}`}>{outOfStock ? 'نفد' : `المخزون: ${stock}`}</span>
                </div>
                <Button type="button" disabled={outOfStock} onClick={() => chooseProduct(p)} className="mt-1 h-6 w-full rounded-lg px-1 text-[11px] font-black active:scale-[.98]"><Plus className="me-1 size-3" /> إضافة</Button>
              </div>
            })}
          </div>}
      </div>

      {/* Cart panel */}
      <div className="flex max-h-[42dvh] min-h-0 shrink-0 flex-col border-t bg-background lg:max-h-none lg:h-full lg:border-t-0 lg:border-r">
        <div className="flex shrink-0 items-center gap-2 border-b p-2.5">
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl text-destructive disabled:opacity-30" disabled={!cart.length} onClick={() => setCart([])} aria-label="تفريغ السلة"><Trash2 className="size-4" /></Button>
          <button type="button" onClick={() => setCustomerPickerOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border bg-muted/30 px-3 py-2 text-sm font-bold"><span className="truncate">{selectedCustomer?.name || 'عميل نقدي'}</span></button>
          <Button variant="outline" size="sm" className="h-9 rounded-xl shrink-0" onClick={() => setCustomerDialog(true)}><UserPlus className="size-4" /></Button>
          <span className="shrink-0 text-sm font-black">السلة ({cart.length})</span>
        </div>
        {customerPickerOpen && <div className="flex shrink-0 gap-2 overflow-x-auto border-b p-2 touch-pan-x">
          <button type="button" onClick={() => { setCustomerId(''); setCustomerPickerOpen(false) }} className={`min-w-max rounded-xl border px-3 py-2 text-xs font-bold ${!customerId ? 'border-primary bg-primary/10' : 'bg-card'}`}>عميل نقدي</button>
          {customers.map(c => <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setCustomerPickerOpen(false) }} className={`min-w-max rounded-xl border px-3 py-2 text-xs font-bold ${customerId === c.id ? 'border-primary bg-primary/10' : 'bg-card'}`}>{c.name}</button>)}
          {!customers.length && <span className="py-2 text-xs text-muted-foreground">لا يوجد عملاء بعد</span>}
        </div>}

        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {cart.length === 0 ? <div className="flex h-full min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed text-center text-muted-foreground"><ReceiptText className="mb-2 size-8 opacity-40" /><div className="text-sm font-bold">السلة فارغة</div></div> :
          <div className="space-y-1.5">{cart.map((it, i) => <div key={`${it.variantId}-${it.unit}`} className="flex items-center gap-2 rounded-2xl border bg-card p-2">
            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" onClick={() => removeItem(i)}><X className="size-4" /></Button>
            <div className="flex shrink-0 items-center gap-1.5"><Button variant="outline" size="icon" className="size-8 rounded-xl" onClick={() => changeQty(i, -1)}>−</Button><span className="min-w-6 text-center text-sm font-black tabular-nums">{it.quantity}</span><Button variant="outline" size="icon" className="size-8 rounded-xl" onClick={() => changeQty(i, 1)}>+</Button></div>
            <div className="min-w-0 flex-1 text-left"><div className="text-sm font-black">{money(it.price * it.quantity)}</div></div>
            <div className="min-w-0 flex-1 text-right"><div className="truncate text-sm font-bold">{it.name}</div><div className="truncate text-[11px] text-muted-foreground">{it.packLabel ? <span className="font-bold text-primary">{it.packLabel}</span> : (it.size || 'مقاس عام')}{it.color ? ` · ${it.color}` : ''}</div></div>
          </div>)}</div>}
        </div>

        <div className="shrink-0 border-t bg-card p-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))]">
          <div className="flex items-stretch gap-2">
            <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl border px-3 text-[11px]"><span className="text-muted-foreground">الخصم</span><input type="number" min={0} value={discount} onChange={e => setDiscount(Math.max(0, Number(e.target.value) || 0))} className="w-14 bg-transparent text-center font-black outline-none" /></div>
            <div className="flex flex-1 items-center justify-between rounded-2xl bg-primary px-3 py-2 text-primary-foreground"><span className="text-xs font-bold opacity-90">الإجمالي</span><span className="text-xl font-black tabular-nums">{money(total)}</span></div>
          </div>
          <Button type="button" className="mt-1.5 h-12 w-full rounded-2xl text-base font-black" disabled={!cart.length || saveSale.isPending} onClick={() => { setPaid(total); setCheckout(true) }}>{saveSale.isPending ? 'جارٍ الحفظ...' : 'إنهاء الفاتورة'}</Button>
        </div>
      </div>
    </div>

    {/* Variant picker */}
    <Dialog open={!!selectedProduct} onOpenChange={o => !o && setSelectedProduct(null)}><DialogContent className="w-[calc(100vw-1rem)] max-w-xl rounded-3xl p-4"><DialogHeader><DialogTitle>اختيار المقاس واللون</DialogTitle><DialogDescription>{selectedProduct?.name}</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{selectedProduct?.variants.filter(v => v.quantity > 0).map(v => <button key={v.id} type="button" onClick={() => handlePickVariant(v, selectedProduct.name)} className="min-h-28 rounded-3xl border p-4 text-right active:scale-[.98]"><div className="font-black">{v.size || 'مقاس عام'}</div><div className="mt-1 text-sm text-muted-foreground">{v.color || 'لون عام'}</div><div className="mt-3 text-lg font-black text-primary">{money(v.sellPrice)}</div><div className="mt-1 text-xs text-muted-foreground">متوفر {v.quantity}</div></button>)}</div></DialogContent></Dialog>

    {/* Unit picker — piece / quarter / half / dozen */}
    <Dialog open={!!unitPickerFor} onOpenChange={o => !o && setUnitPickerFor(null)}><DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-3xl p-4"><DialogHeader><DialogTitle>اختيار وحدة البيع</DialogTitle><DialogDescription>{unitPickerFor?.productName}{unitPickerFor?.v.size ? ` · ${unitPickerFor.v.size}` : ''}</DialogDescription></DialogHeader>
      {unitPickerFor && <div className="space-y-2">
        <button type="button" onClick={() => addVariant(unitPickerFor.v, unitPickerFor.productName)} className="flex w-full items-center justify-between rounded-2xl border p-4 text-right active:scale-[.98]"><div><div className="font-black">قطعة</div><div className="text-xs text-muted-foreground">متوفر {unitPickerFor.v.quantity}</div></div><span className="text-lg font-black text-primary">{money(unitPickerFor.v.sellPrice)}</span></button>
        {!!unitPickerFor.v.quarterDozenPrice && <button type="button" disabled={unitPickerFor.v.quantity < 3} onClick={() => addVariant(unitPickerFor.v, unitPickerFor.productName, { factor: 3, price: unitPickerFor.v.quarterDozenPrice!, unit: 'quarter-dozen', label: 'ربع دستة' })} className="flex w-full items-center justify-between rounded-2xl border p-4 text-right active:scale-[.98] disabled:opacity-40"><div><div className="font-black">ربع دستة (3 قطع)</div><div className="text-xs text-muted-foreground">{unitPickerFor.v.quantity < 3 ? 'مخزون غير كافٍ' : `يلزم 3 من ${unitPickerFor.v.quantity}`}</div></div><span className="text-lg font-black text-primary">{money(unitPickerFor.v.quarterDozenPrice)}</span></button>}
        {!!unitPickerFor.v.halfDozenPrice && <button type="button" disabled={unitPickerFor.v.quantity < 6} onClick={() => addVariant(unitPickerFor.v, unitPickerFor.productName, { factor: 6, price: unitPickerFor.v.halfDozenPrice!, unit: 'half-dozen', label: 'نص دستة' })} className="flex w-full items-center justify-between rounded-2xl border p-4 text-right active:scale-[.98] disabled:opacity-40"><div><div className="font-black">نص دستة (6 قطع)</div><div className="text-xs text-muted-foreground">{unitPickerFor.v.quantity < 6 ? 'مخزون غير كافٍ' : `يلزم 6 من ${unitPickerFor.v.quantity}`}</div></div><span className="text-lg font-black text-primary">{money(unitPickerFor.v.halfDozenPrice)}</span></button>}
        {!!unitPickerFor.v.dozenPrice && <button type="button" disabled={unitPickerFor.v.quantity < 12} onClick={() => addVariant(unitPickerFor.v, unitPickerFor.productName, { factor: 12, price: unitPickerFor.v.dozenPrice!, unit: 'dozen', label: 'دستة' })} className="flex w-full items-center justify-between rounded-2xl border p-4 text-right active:scale-[.98] disabled:opacity-40"><div><div className="font-black">دستة (12 قطعة)</div><div className="text-xs text-muted-foreground">{unitPickerFor.v.quantity < 12 ? 'مخزون غير كافٍ' : `يلزم 12 من ${unitPickerFor.v.quantity}`}</div></div><span className="text-lg font-black text-primary">{money(unitPickerFor.v.dozenPrice)}</span></button>}
      </div>}
    </DialogContent></Dialog>

    {/* Checkout: payment method + amount */}
    <Dialog open={checkout} onOpenChange={v => !saveSale.isPending && setCheckout(v)}><DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-3xl p-4"><DialogHeader><DialogTitle>تأكيد البيع — {money(total)}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-4 gap-1.5">{([['cash', 'نقدي'], ['card', 'بطاقة'], ['transfer', 'تحويل'], ['credit', 'آجل']] as const).map(([m, l]) => <button key={m} type="button" onClick={() => quickPay(m)} className={`min-h-16 rounded-xl border p-1.5 font-black active:scale-[.98] ${paymentMethod === m ? 'border-primary bg-primary/10 ring-1 ring-primary/20' : 'bg-card'}`}>{l}</button>)}</div>
      {paymentMethod !== 'credit' && <div className="mt-2"><Label>المبلغ المستلم</Label><Input type="number" min={0} value={paid} onChange={e => setPaid(Math.max(0, Number(e.target.value) || 0))} className="mt-1 h-12" /></div>}
      {paymentMethod !== 'credit' && <div className="mt-2 rounded-xl bg-muted p-3 text-sm">{change > 0 ? <>الباقي: <b className="text-primary">{money(change)}</b></> : remaining > 0 ? <>متبقي: <b className="text-destructive">{money(remaining)}</b></> : 'المبلغ مكتمل'}</div>}
      {paymentMethod === 'credit' && <div className="mt-2 rounded-xl bg-muted p-3 text-sm">المتبقي على العميل ({selectedCustomer?.name || 'اختر عميلًا'}): <b>{money(total)}</b></div>}
      <Button className="mt-2 h-14 w-full rounded-2xl text-base font-black" disabled={saveSale.isPending} onClick={submit}>{saveSale.isPending ? 'جارٍ الحفظ...' : 'تأكيد البيع'}</Button>
    </DialogContent></Dialog>

    {/* Quick add customer */}
    <Dialog open={customerDialog} onOpenChange={v => !saveCustomer.isPending && setCustomerDialog(v)}><DialogContent className="rounded-3xl"><DialogHeader><DialogTitle>إضافة عميل سريع</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>الاسم *</Label><Input value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} /></div><div><Label>الهاتف</Label><Input value={customerForm.phone} onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })} dir="ltr" /></div></div><DialogFooter><Button variant="outline" onClick={() => setCustomerDialog(false)} disabled={saveCustomer.isPending}>إلغاء</Button><Button onClick={() => saveCustomer.mutate(customerForm)} disabled={saveCustomer.isPending || !customerForm.name.trim()}>{saveCustomer.isPending ? 'جارٍ الحفظ...' : 'حفظ العميل'}</Button></DialogFooter></DialogContent></Dialog>

    {/* Receipt after checkout */}
    <Dialog open={!!printing} onOpenChange={v => !v && setPrinting(null)}><DialogContent className="rounded-3xl"><DialogHeader><DialogTitle>الفاتورة تمت بنجاح</DialogTitle></DialogHeader>{printing && <div id="printable-invoice" className="rounded-xl border bg-white p-4 text-black"><div className="text-center text-xl font-black">طيبة</div><div className="mt-2 text-sm">فاتورة: {printing.invoiceNo}</div><div className="text-sm">التاريخ: {formatDateTime(printing.date)}</div>{printing.items.map(i => <div key={i.id} className="flex justify-between border-b py-2 text-sm"><span>{i.variant?.product?.name || 'صنف'} × {i.quantity}</span><b>{money(i.total)}</b></div>)}<div className="mt-3 flex justify-between font-black"><span>الإجمالي</span><span>{money(printing.total)}</span></div></div>}<div className="grid grid-cols-2 gap-2"><Button onClick={() => window.print()}><Printer className="size-4" /> طباعة</Button><Button variant="outline" onClick={() => printing && shareReceipt(printing)}><Share2 className="size-4" /> مشاركة</Button></div><Button className="w-full" onClick={() => setPrinting(null)}><CheckCircle2 className="size-4" /> فاتورة جديدة</Button></DialogContent></Dialog>

    {/* History */}
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl sm:max-w-2xl"><DialogHeader><DialogTitle>سجل الفواتير</DialogTitle></DialogHeader>{salesQuery.isLoading ? <Skeleton className="h-24" /> : <div className="space-y-2">{sales.map(s => <div key={s.id} className="rounded-xl border p-3"><div className="flex justify-between"><b>{s.invoiceNo}</b><Badge variant={saleStatusBadgeVariant(s.status)}>{saleStatusLabel(s.status)}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{formatDateTime(s.date)} · {s.customer?.name || 'عميل نقدي'}</div><div className="mt-2 flex justify-between"><b>{money(s.total)}</b><Button size="sm" variant="outline" onClick={() => setViewing(s)}><Eye className="size-4" /> عرض</Button></div></div>)}</div>}</DialogContent></Dialog>
    <Dialog open={!!viewing} onOpenChange={v => !v && setViewing(null)}><DialogContent className="rounded-3xl"><DialogHeader><DialogTitle>الفاتورة {viewing?.invoiceNo}</DialogTitle></DialogHeader>{viewing && <div className="space-y-2">{viewing.items.map(i => <div key={i.id} className="flex justify-between rounded-xl border p-3"><span>{i.variant?.product?.name || 'صنف'} × {i.quantity}</span><b>{money(i.total)}</b></div>)}<div className="flex justify-between rounded-xl bg-muted p-3"><span>الإجمالي</span><b>{money(viewing.total)}</b></div></div>}</DialogContent></Dialog>
  </div>
}
