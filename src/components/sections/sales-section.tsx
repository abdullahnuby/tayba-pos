'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Banknote, Barcode, ChevronDown, CreditCard, Eye,
  Menu, Minus, Pause, Play, Plus, Printer, ReceiptText, RefreshCw,
  Search, Send, ShoppingBag, Trash2, User as UserIcon,
  Wifi, WifiOff, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP, formatDateTime, saleStatusBadgeVariant, saleStatusLabel } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'
import { useAppStore } from '@/lib/store'

interface Variant {
  id: string
  sku: string
  barcode: string | null
  size: string | null
  color: string | null
  sellPrice: number
  quantity: number
  saleUnit?: string | null
  saleUnitFactor?: number | null
  quarterDozenPrice?: number | null
  halfDozenPrice?: number | null
  dozenPrice?: number | null
  product: { id: string; name: string; category?: { id: string; name: string } | null }
}
interface Product { id: string; name: string; category?: { id: string; name: string } | null; variants: Variant[] }
interface Sale {
  id: string; invoiceNo: string; date: string; subtotal: number; discount: number; taxAmount: number; total: number; paid: number; change: number; paymentMethod: string; status: string
  customer?: { name: string; phone?: string | null } | null
  items: { id: string; variantId: string; quantity: number; unitPrice: number; total: number; variant: { sku: string; size: string | null; color: string | null; product: { name: string } } }[]
}
interface Customer { id: string; name: string; phone: string | null }
interface CartItem { variantId: string; name: string; sku: string; size: string | null; color: string | null; price: number; quantity: number; max: number; unit: string; factor: number; packLabel?: string }
interface QueuedSale { id: string; createdAt: string; payload: Record<string, unknown> }

const CACHE_KEY = 'tayba-pos-products-cache-v1'
const QUEUE_KEY = 'tayba-pos-sales-queue-v1'

function money(n: number) { return `${formatEGP(n)} ج.م` }
function readJSON<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback } }
function writeJSON(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }

/** Category → icon mapping kept for potential future use; not currently rendered per design request. */

function TouchNumberPad({ value, onChange, onDone }: { value: number; onChange: (n: number) => void; onDone: () => void }) {
  const [raw, setRaw] = useState(value ? String(value) : '')
  useEffect(() => setRaw(value ? String(value) : ''), [value])
  function press(k: string) {
    let next = raw
    if (k === 'clear') next = ''
    else if (k === 'back') next = raw.slice(0, -1)
    else if (k === '.') next = raw.includes('.') ? raw : `${raw || '0'}.`
    else next = raw === '0' ? k : raw + k
    setRaw(next); onChange(Math.max(0, Number(next) || 0))
  }
  return <div className="select-none touch-manipulation rounded-3xl border bg-muted/20 p-3">
    <div className="mb-3 flex h-16 items-center justify-between rounded-2xl bg-background px-4 text-3xl font-black tabular-nums"><span>{raw || '0'}</span><span className="text-sm text-muted-foreground">ج.م</span></div>
    <div className="grid grid-cols-3 gap-2">{['1','2','3','4','5','6','7','8','9','.','0','back'].map(k => <Button key={k} type="button" variant="outline" className="h-16 rounded-2xl text-2xl font-black" onClick={() => press(k)}>{k === 'back' ? '⌫' : k}</Button>)}</div>
    <div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" variant="outline" className="h-14 rounded-2xl" onClick={() => press('clear')}>مسح</Button><Button type="button" className="h-14 rounded-2xl font-black" onClick={onDone}>تم</Button></div>
  </div>
}

export function SalesSection() {
  const qc = useQueryClient()
  const setSection = useAppStore(s => s.setSection)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [unitPickerFor, setUnitPickerFor] = useState<{ v: Variant; productName: string } | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [customerId, setCustomerId] = useState('')
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'cash'|'card'|'transfer'|'credit'>('cash')
  const [paid, setPaid] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [moneyEditor, setMoneyEditor] = useState<'paid'|'discount'|null>(null)
  const [viewing, setViewing] = useState<Sale | null>(null)
  const [printing, setPrinting] = useState<Sale | null>(null)
  const [heldOpen, setHeldOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [storeName, setStoreName] = useState('طيبة')
  const [receiptFooter, setReceiptFooter] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])

  const { data: salesData, isLoading } = useQuery<{ items: Sale[] }>({ queryKey: ['sales'], queryFn: async () => (await fetch('/api/sales?pageSize=100')).json() })
  const sales = salesData?.items || []

  const productsQuery = useQuery<{ items: Product[] }>({ queryKey: ['variants-pos'], queryFn: async () => {
    try {
      const r = await fetch('/api/products?pageSize=500')
      if (!r.ok) throw new Error('products')
      const data = await r.json() as { items: Product[] }
      writeJSON(CACHE_KEY, data.items || [])
      return data
    } catch (e) {
      const cached = readJSON<Product[]>(CACHE_KEY, [])
      if (cached.length) return { items: cached }
      throw e
    }
  }, staleTime: 60000 })

  useEffect(() => {
    setProducts(productsQuery.data?.items || readJSON<Product[]>(CACHE_KEY, []))
  }, [productsQuery.data])

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update(); window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => { setPending(readJSON<QueuedSale[]>(QUEUE_KEY, []).length) }, [])
  useEffect(() => {
    fetch('/api/customers').then(r => r.json()).then(setCustomers).catch(() => {})
    fetch('/api/store-settings').then(r => r.json()).then(s => { setStoreName(s.storeName || 'طيبة'); setReceiptFooter(s.receiptFooter || '') }).catch(() => {})
    setTimeout(() => barcodeRef.current?.focus(), 150)
  }, [])

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

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = products.filter(p => (category === 'all' || (p.category?.id || 'none') === category) && (!q || p.name.toLowerCase().includes(q) || p.variants.some(v => v.sku.toLowerCase().includes(q) || (v.barcode || '').includes(q))))
    return list.slice(0, 60)
  }, [products, category, search])

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0)
  const total = Math.max(0, subtotal - discount)
  const change = Math.max(0, paid - total)
  const remaining = Math.max(0, total - paid)
  const heldSales = sales.filter(s => s.status === 'draft')
  const selectedCustomer = customers.find(c => c.id === customerId)

  const resumeMutation = useMutation({ mutationFn: async (id: string) => {
    const r = await fetch(`/api/sales/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) })
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'فشل استئناف الفاتورة') }
    return r.json()
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales'] }); toast.success('تم استئناف الفاتورة'); setHeldOpen(false) }, onError: (e: Error) => toast.error(e.message) })

  const voidMutation = useMutation({ mutationFn: async (id: string) => {
    const r = await fetch(`/api/sales/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'void', voidReason: 'إلغاء من شاشة الفواتير' }) })
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'فشل إلغاء الفاتورة') }
    return r.json()
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['variants-pos'] }); toast.success('تم إلغاء الفاتورة وإرجاع المخزون'); setViewing(null) }, onError: (e: Error) => toast.error(e.message) })

  const onlineMutation = useMutation({ mutationFn: async (payload: Record<string, unknown>) => {
    const r = await fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'فشل حفظ الفاتورة') }
    return r.json() as Promise<Sale>
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['dashboard-stats'] }); toast.success('تم تسجيل البيع'); resetSale() }, onError: (e: Error) => toast.error(e.message) })

  function resetSale() { setCart([]); setCustomerId(''); setDiscount(0); setPaid(0); setPaymentMethod('cash'); setSearch(''); setSelectedProduct(null); setCustomerPickerOpen(false); setCheckoutOpen(false); setTimeout(() => barcodeRef.current?.focus(), 100) }

  function chooseProduct(p: Product) {
    const available = p.variants.filter(v => v.quantity > 0)
    if (!available.length) return toast.warning('المنتج غير متوفر في المخزون')
    if (available.length === 1) return handlePickVariant(available[0], p.name)
    setSelectedProduct(p)
  }
  /** Has this variant been configured with special pack pricing? If so, ask which unit before adding. */
  function hasPackPricing(v: Variant) { return (v.quarterDozenPrice ?? 0) > 0 || (v.halfDozenPrice ?? 0) > 0 || (v.dozenPrice ?? 0) > 0 }
  function handlePickVariant(v: Variant, productName: string) {
    if (v.quantity <= 0) return toast.warning('هذا المقاس/اللون غير متوفر')
    if (hasPackPricing(v)) setUnitPickerFor({ v, productName })
    else addVariant(v, productName)
  }
  function addVariant(v: Variant, productName = v.product.name, pack?: { factor: number; price: number; unit: string; label: string }) {
    if (v.quantity <= 0) return toast.warning('هذا المقاس/اللون غير متوفر')
    const factor = pack?.factor ?? (Number(v.saleUnitFactor) || 1)
    const unit = pack?.unit ?? (v.saleUnit || 'piece')
    const price = pack?.price ?? v.sellPrice
    if (v.quantity < factor) return toast.warning('لا يوجد مخزون كافٍ لهذه الوحدة')
    const existing = cart.find(i => i.variantId === v.id && i.unit === unit)
    if (existing) {
      if ((existing.quantity + 1) * factor > v.quantity) return toast.warning('لا يوجد مخزون كافٍ')
      setCart(cart.map(i => i === existing ? { ...i, quantity: i.quantity + 1 } : i))
    } else setCart([...cart, { variantId: v.id, name: productName, sku: v.sku, size: v.size, color: v.color, price, quantity: 1, max: v.quantity, unit, factor, packLabel: pack?.label }])
    setSelectedProduct(null); setUnitPickerFor(null); setSearch(''); setTimeout(() => barcodeRef.current?.focus(), 50)
  }
  function changeQty(index: number, delta: number) { setCart(cart.map((i, n) => n === index ? { ...i, quantity: Math.max(1, Math.min(Math.floor(i.max / i.factor), i.quantity + delta)) } : i)) }
  function removeItem(index: number) { setCart(cart.filter((_, n) => n !== index)) }

  function scanBarcode(value: string) {
    const code = value.trim()
    if (!code) return
    const found = products.flatMap(p => p.variants.map(v => ({ v, name: p.name }))).find(x => x.v.barcode === code || x.v.sku === code)
    if (found) handlePickVariant(found.v, found.name)
    else toast.error('الباركود غير موجود')
  }

  function buildPayload(status: 'completed'|'draft', paidValue: number, method = paymentMethod) {
    return { customerId: customerId || undefined, discount: Number(discount) || 0, paid: method === 'credit' ? 0 : paidValue, paymentMethod: method, status, items: cart.map(i => ({ variantId: i.variantId, quantity: i.quantity * i.factor, unitPrice: i.price / i.factor })) }
  }
  function enqueue(payload: Record<string, unknown>) {
    const queue = readJSON<QueuedSale[]>(QUEUE_KEY, [])
    queue.push({ id: `OFF-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, createdAt: new Date().toISOString(), payload })
    writeJSON(QUEUE_KEY, queue); setPending(queue.length)
    toast.success('تم حفظ الفاتورة محليًا — ستتم مزامنتها تلقائيًا عند عودة الإنترنت')
    resetSale()
  }
  function submit() {
    if (!cart.length) return toast.error('أضف صنفًا أولًا')
    if (discount > subtotal) return toast.error('الخصم أكبر من الإجمالي')
    if (paymentMethod === 'credit' && !customerId) return toast.error('اختر العميل للبيع الآجل')
    if (paymentMethod !== 'credit' && paid < total) return toast.error('المبلغ المدفوع غير مكتمل')
    const payload = buildPayload('completed', paymentMethod === 'credit' ? 0 : paid)
    if (offline) enqueue(payload); else onlineMutation.mutate(payload)
  }
  function quickPay(method: 'cash'|'card'|'transfer'|'credit') {
    setPaymentMethod(method)
    if (method === 'credit') { setPaid(0); return }
    setPaid(total)
  }
  function hold() {
    if (!cart.length) return toast.error('السلة فارغة')
    const payload = buildPayload('draft', 0)
    if (offline) enqueue(payload); else onlineMutation.mutate(payload)
  }

  async function syncQueue() {
    if (!navigator.onLine) return
    const queue = readJSON<QueuedSale[]>(QUEUE_KEY, [])
    if (!queue.length) return
    let rest = [...queue]
    for (const item of queue) {
      try {
        const r = await fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.payload) })
        if (!r.ok) throw new Error('sync')
        rest = rest.filter(x => x.id !== item.id)
      } catch { break }
    }
    writeJSON(QUEUE_KEY, rest); setPending(rest.length)
    if (rest.length !== queue.length) { qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['products'] }); toast.success('تمت مزامنة الفواتير المؤجلة') }
  }
  useEffect(() => { const fn = () => void syncQueue(); window.addEventListener('online', fn); void syncQueue(); return () => window.removeEventListener('online', fn) }, [])

  return <div className="flex h-[100dvh] flex-col overflow-hidden bg-muted/10 lg:h-auto lg:min-h-[calc(100vh-8rem)] lg:rounded-3xl lg:border">
    {/* Top bar */}
    <div className="shrink-0 border-b bg-background px-3 py-2.5 sm:px-4 no-print">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-10 rounded-2xl lg:hidden" onClick={() => setSection('dashboard')} aria-label="لوحة التحكم"><Menu className="size-5"/></Button>
          <Button variant="outline" size="icon" className="size-10 rounded-2xl" onClick={() => setHistoryOpen(true)} aria-label="سجل الفواتير"><ReceiptText className="size-5"/></Button>
          <Badge variant={offline ? 'destructive' : 'default'} className="gap-1 rounded-xl px-2.5 py-1.5">{offline ? <WifiOff className="size-3"/> : <Wifi className="size-3"/>}<span className="hidden xs:inline">{offline ? 'غير متصل' : 'متصل'}</span>{pending ? ` · ${pending}` : ''}</Badge>
        </div>
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5"><ShoppingBag className="size-5 text-primary"/><span className="text-lg font-black leading-none sm:text-xl">{storeName}</span></div>
          <span className="mt-0.5 text-[11px] text-muted-foreground">نظام نقاط البيع</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="size-10 rounded-2xl" onClick={() => void syncQueue()} disabled={offline} aria-label="مزامنة"><RefreshCw className="size-5"/></Button>
          {heldSales.length > 0 && <Button variant="outline" size="icon" className="relative size-10 rounded-2xl" onClick={() => setHeldOpen(true)} aria-label="فواتير معلقة"><Pause className="size-5"/><span className="absolute -top-1 -left-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-black text-primary-foreground">{heldSales.length}</span></Button>}
        </div>
      </div>
    </div>

    {/* Search */}
    <div className="shrink-0 border-b bg-background px-3 py-2.5 sm:px-4 no-print">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"/>
          <input value={search} onChange={e => setSearch(e.target.value)} className="h-12 w-full rounded-2xl border bg-muted/30 px-11 text-sm outline-none focus:ring-2 focus:ring-primary/30" placeholder="ابحث بالباركود أو الاسم أو SKU..."/>
        </div>
        <div className="relative">
          <input ref={barcodeRef} value="" onChange={() => {}} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); scanBarcode((e.target as HTMLInputElement).value) } }} inputMode="none" autoComplete="off" className="absolute size-px opacity-0" tabIndex={-1} aria-hidden/>
          <Button type="button" variant="default" size="icon" className="size-12 shrink-0 rounded-2xl" onClick={() => { const v = prompt('أدخل الباركود'); if (v) scanBarcode(v) }} aria-label="مسح باركود"><Barcode className="size-5"/></Button>
        </div>
      </div>
    </div>

    {/* Category chips — text only, no icons */}
    <div className="shrink-0 border-b bg-background px-3 py-2 sm:px-4 no-print">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 touch-pan-x">
        {categories.map(c => {
          const active = category === c.id
          return <button key={c.id} type="button" onClick={() => setCategory(c.id)} className={`flex min-w-max items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black active:scale-[.98] ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card'}`}>
            <span>{c.name}</span>
            <span className={active ? 'text-primary-foreground/80' : 'text-muted-foreground'}>({c.count})</span>
          </button>
        })}
      </div>
    </div>

    {/* Body: products + cart */}
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-[1fr_400px]">
      {/* Product grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {productsQuery.isLoading ? <div className="grid grid-cols-3 gap-2">{Array.from({length:9}).map((_,i)=><Skeleton key={i} className="h-[6.5rem] rounded-2xl"/>)}</div> :
        visibleProducts.length === 0 ? <div className="py-16 text-center text-muted-foreground">لا توجد أصناف مطابقة</div> :
        <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
          {visibleProducts.map(p => {
            const totalStock = p.variants.reduce((s,v) => s + v.quantity, 0)
            const minPrice = Math.min(...p.variants.map(v => v.sellPrice))
            const outOfStock = totalStock === 0
            return <div key={p.id} className="flex h-[6.5rem] flex-col rounded-2xl border bg-card p-2 shadow-sm">
              <div className="line-clamp-1 text-[12px] font-black leading-tight">{p.name}</div>
              <div className="text-[9px] text-muted-foreground">{p.variants.length} {p.variants.length === 1 ? 'خيار' : 'مقاسات/ألوان'}</div>
              <div className="mt-auto flex items-center justify-between">
                <span className="text-[12px] font-black text-primary">{money(minPrice)}</span>
                <span className={`text-[9px] ${outOfStock ? 'text-destructive' : 'text-muted-foreground'}`}>{outOfStock ? 'نفد' : `المخزون: ${totalStock}`}</span>
              </div>
              <Button type="button" disabled={outOfStock} onClick={() => chooseProduct(p)} className="mt-1 h-6 w-full rounded-lg px-1 text-[11px] font-black active:scale-[.98]"><Plus className="me-1 size-3"/> إضافة</Button>
            </div>
          })}
        </div>}
      </div>

      {/* Cart panel */}
      <div className="flex max-h-[42dvh] min-h-0 shrink-0 flex-col border-t bg-background lg:max-h-none lg:h-full lg:border-t-0 lg:border-r">
        {/* header row: clear + customer selector + title */}
        <div className="flex shrink-0 items-center gap-2 border-b p-2.5">
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl text-destructive disabled:opacity-30" disabled={!cart.length} onClick={() => setCart([])} aria-label="تفريغ السلة"><Trash2 className="size-4"/></Button>
          <button type="button" onClick={() => setCustomerPickerOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border bg-muted/30 px-3 py-2 text-sm font-bold">
            <UserIcon className="size-4 shrink-0 text-muted-foreground"/>
            <span className="truncate">{selectedCustomer?.name || 'عميل نقدي'}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground"/>
          </button>
          <span className="shrink-0 text-sm font-black">السلة ({cart.length})</span>
        </div>
        {customerPickerOpen && <div className="flex shrink-0 gap-2 overflow-x-auto border-b p-2 touch-pan-x">
          <button type="button" onClick={() => { setCustomerId(''); setCustomerPickerOpen(false) }} className={`min-w-max rounded-xl border px-3 py-2 text-xs font-bold ${!customerId ? 'border-primary bg-primary/10' : 'bg-card'}`}>عميل نقدي</button>
          {customers.map(c => <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setCustomerPickerOpen(false) }} className={`min-w-max rounded-xl border px-3 py-2 text-xs font-bold ${customerId === c.id ? 'border-primary bg-primary/10' : 'bg-card'}`}>{c.name}</button>)}
          {!customers.length && <span className="py-2 text-xs text-muted-foreground">لا يوجد عملاء بعد</span>}
        </div>}

        {/* items */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {cart.length === 0 ? <div className="flex h-full min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed text-center text-muted-foreground"><ReceiptText className="mb-2 size-8 opacity-40"/><div className="text-sm font-bold">السلة فارغة</div><div className="mt-0.5 text-xs">اضغط على صنف لإضافته</div></div> :
          <div className="space-y-1.5">{cart.map((it,i) => <div key={it.variantId} className="flex items-center gap-2 rounded-2xl border bg-card p-2">
            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-destructive" onClick={() => removeItem(i)}><X className="size-4"/></Button>
            <div className="flex shrink-0 items-center gap-1.5"><Button variant="outline" size="icon" className="size-8 rounded-xl" onClick={() => changeQty(i,-1)}><Minus className="size-3.5"/></Button><span className="min-w-6 text-center text-sm font-black tabular-nums">{it.quantity}</span><Button variant="outline" size="icon" className="size-8 rounded-xl" onClick={() => changeQty(i,1)}><Plus className="size-3.5"/></Button></div>
            <div className="min-w-0 flex-1 text-left"><div className="text-sm font-black">{money(it.price * it.quantity)}</div></div>
            <div className="min-w-0 flex-1 text-right"><div className="truncate text-sm font-bold">{it.name}</div><div className="truncate text-[11px] text-muted-foreground">{it.packLabel ? <span className="font-bold text-primary">{it.packLabel}</span> : (it.size || 'مقاس عام')}{it.color ? ` · ${it.color}` : ''}</div></div>
          </div>)}</div>}
        </div>

        {/* footer: totals (1 row) + actions (1 row) — payment method is chosen in the checkout step */}
        <div className="shrink-0 border-t bg-card p-2.5 pb-[max(.65rem,env(safe-area-inset-bottom))]">
          <div className="flex items-stretch gap-2">
            <button type="button" onClick={() => setMoneyEditor('discount')} className="flex shrink-0 flex-col items-center justify-center rounded-2xl border px-3 text-[11px]"><span className="text-muted-foreground">الخصم</span><span className="font-black">{money(discount)}</span></button>
            <div className="flex flex-1 items-center justify-between rounded-2xl bg-primary px-3 py-2 text-primary-foreground"><span className="text-xs font-bold opacity-90">الإجمالي</span><span className="text-xl font-black tabular-nums">{money(total)}</span></div>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Button type="button" variant="outline" onClick={hold} disabled={!cart.length || onlineMutation.isPending} className="h-11 w-full rounded-xl text-xs"><Pause className="me-1.5 size-3.5"/> حفظ كفاتورة معلقة</Button>
            <Button type="button" onClick={() => { if (!cart.length) return toast.error('أضف صنفًا أولًا'); setPaid(total); setCheckoutOpen(true) }} disabled={!cart.length} className="h-11 w-full rounded-xl text-sm font-black">إنهاء البيع</Button>
          </div>
        </div>
      </div>
    </div>

    {/* Checkout: payment method + amount */}
    <Dialog open={checkoutOpen} onOpenChange={setCheckoutOpen}><DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-3xl p-4"><DialogHeader><DialogTitle>إتمام الدفع</DialogTitle><DialogDescription>الإجمالي: {money(total)}</DialogDescription></DialogHeader>
      <div className="grid grid-cols-4 gap-1.5">{([['cash','نقدي',Banknote],['card','بطاقة',CreditCard],['transfer','تحويل',Send],['credit','آجل',ReceiptText]] as const).map(([m,label,Icon]) => <button key={m} type="button" onClick={() => quickPay(m)} className={`min-h-16 rounded-xl border p-1.5 font-black active:scale-[.98] ${paymentMethod === m ? 'border-primary bg-primary/10 ring-1 ring-primary/20' : 'bg-card'}`}><Icon className="mx-auto mb-0.5 size-5"/><span className="text-xs">{label}</span></button>)}</div>
      {paymentMethod !== 'credit' && <button type="button" onClick={() => setMoneyEditor('paid')} className="mt-2 flex w-full items-center justify-between rounded-xl border p-3 text-right text-sm font-bold"><span>{change > 0 ? <>الباقي: <b className="text-primary">{money(change)}</b></> : remaining > 0 ? <>متبقي: <b className="text-destructive">{money(remaining)}</b></> : 'المبلغ مكتمل'}</span><span className="text-muted-foreground">مستلم: {money(paid)}</span></button>}
      {paymentMethod === 'credit' && <div className="mt-2 rounded-xl bg-muted/40 p-3 text-sm">المتبقي على العميل ({selectedCustomer?.name || 'اختر عميلًا'}): <b>{money(total)}</b></div>}
      <Button type="button" onClick={submit} disabled={onlineMutation.isPending || !cart.length} className="mt-2 h-14 w-full rounded-2xl text-base font-black">{onlineMutation.isPending ? 'جاري الحفظ...' : offline ? 'حفظ الفاتورة Offline' : paymentMethod === 'credit' ? 'إتمام البيع الآجل' : 'تأكيد الدفع'}</Button>
    </DialogContent></Dialog>

    {/* Variant picker */}
    <Dialog open={!!selectedProduct} onOpenChange={o => !o && setSelectedProduct(null)}><DialogContent className="w-[calc(100vw-1rem)] max-w-xl rounded-3xl p-4"><DialogHeader><DialogTitle className="text-xl font-black">اختيار المقاس واللون</DialogTitle><DialogDescription>{selectedProduct?.name}</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{selectedProduct?.variants.filter(v => v.quantity > 0).map(v => <button key={v.id} type="button" onClick={() => handlePickVariant(v, selectedProduct.name)} className="min-h-28 rounded-3xl border p-4 text-right active:scale-[.98]"><div className="font-black">{v.size || 'مقاس عام'}</div><div className="mt-1 text-sm text-muted-foreground">{v.color || 'لون عام'}</div><div className="mt-3 text-lg font-black text-primary">{money(v.sellPrice)}</div><div className="mt-1 text-xs text-muted-foreground">متوفر {v.quantity}</div></button>)}</div></DialogContent></Dialog>

    {/* Unit picker — piece / half-dozen / dozen, shown only when the variant has pack pricing configured */}
    <Dialog open={!!unitPickerFor} onOpenChange={o => !o && setUnitPickerFor(null)}><DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-3xl p-4"><DialogHeader><DialogTitle className="text-xl font-black">اختيار وحدة البيع</DialogTitle><DialogDescription>{unitPickerFor?.productName}{unitPickerFor?.v.size ? ` · ${unitPickerFor.v.size}` : ''}{unitPickerFor?.v.color ? ` · ${unitPickerFor.v.color}` : ''}</DialogDescription></DialogHeader>
      {unitPickerFor && <div className="space-y-2">
        <button type="button" onClick={() => addVariant(unitPickerFor.v, unitPickerFor.productName)} className="flex w-full items-center justify-between rounded-2xl border p-4 text-right active:scale-[.98]"><div><div className="font-black">قطعة</div><div className="text-xs text-muted-foreground">متوفر {unitPickerFor.v.quantity}</div></div><span className="text-lg font-black text-primary">{money(unitPickerFor.v.sellPrice)}</span></button>
        {!!unitPickerFor.v.quarterDozenPrice && <button type="button" disabled={unitPickerFor.v.quantity < 3} onClick={() => addVariant(unitPickerFor.v, unitPickerFor.productName, { factor: 3, price: unitPickerFor.v.quarterDozenPrice!, unit: 'quarter-dozen', label: 'ربع دستة' })} className="flex w-full items-center justify-between rounded-2xl border p-4 text-right active:scale-[.98] disabled:opacity-40"><div><div className="font-black">ربع دستة (3 قطع)</div><div className="text-xs text-muted-foreground">{unitPickerFor.v.quantity < 3 ? 'مخزون غير كافٍ' : `يلزم 3 من ${unitPickerFor.v.quantity}`}</div></div><span className="text-lg font-black text-primary">{money(unitPickerFor.v.quarterDozenPrice)}</span></button>}
        {!!unitPickerFor.v.halfDozenPrice && <button type="button" disabled={unitPickerFor.v.quantity < 6} onClick={() => addVariant(unitPickerFor.v, unitPickerFor.productName, { factor: 6, price: unitPickerFor.v.halfDozenPrice!, unit: 'half-dozen', label: 'نص دستة' })} className="flex w-full items-center justify-between rounded-2xl border p-4 text-right active:scale-[.98] disabled:opacity-40"><div><div className="font-black">نص دستة (6 قطع)</div><div className="text-xs text-muted-foreground">{unitPickerFor.v.quantity < 6 ? 'مخزون غير كافٍ' : `يلزم 6 من ${unitPickerFor.v.quantity}`}</div></div><span className="text-lg font-black text-primary">{money(unitPickerFor.v.halfDozenPrice)}</span></button>}
        {!!unitPickerFor.v.dozenPrice && <button type="button" disabled={unitPickerFor.v.quantity < 12} onClick={() => addVariant(unitPickerFor.v, unitPickerFor.productName, { factor: 12, price: unitPickerFor.v.dozenPrice!, unit: 'dozen', label: 'دستة' })} className="flex w-full items-center justify-between rounded-2xl border p-4 text-right active:scale-[.98] disabled:opacity-40"><div><div className="font-black">دستة (12 قطعة)</div><div className="text-xs text-muted-foreground">{unitPickerFor.v.quantity < 12 ? 'مخزون غير كافٍ' : `يلزم 12 من ${unitPickerFor.v.quantity}`}</div></div><span className="text-lg font-black text-primary">{money(unitPickerFor.v.dozenPrice)}</span></button>}
      </div>}
    </DialogContent></Dialog>
    <Dialog open={!!moneyEditor} onOpenChange={() => setMoneyEditor(null)}><DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-3xl p-4"><DialogHeader><DialogTitle>{moneyEditor === 'paid' ? 'المبلغ المستلم' : 'الخصم'}</DialogTitle><DialogDescription>لوحة أرقام داخلية — بدون لوحة مفاتيح الجهاز</DialogDescription></DialogHeader><TouchNumberPad value={moneyEditor === 'paid' ? paid : discount} onChange={n => moneyEditor === 'paid' ? setPaid(n) : setDiscount(n)} onDone={() => setMoneyEditor(null)}/></DialogContent></Dialog>
    <Dialog open={heldOpen} onOpenChange={setHeldOpen}><DialogContent className="w-[calc(100vw-1rem)] max-w-lg rounded-3xl"><DialogHeader><DialogTitle>الفواتير المعلقة</DialogTitle></DialogHeader><div className="space-y-2">{heldSales.map(s => <div key={s.id} className="flex items-center justify-between rounded-2xl border p-3"><div><b>{s.invoiceNo}</b><div className="text-xs text-muted-foreground">{formatDateTime(s.date)}</div></div><Button onClick={() => resumeMutation.mutate(s.id)} disabled={resumeMutation.isPending}><Play className="me-1 size-4"/> استئناف</Button></div>)}</div></DialogContent></Dialog>
    <Dialog open={!!viewing} onOpenChange={() => setViewing(null)}><DialogContent className="w-[calc(100vw-1rem)] max-w-2xl rounded-3xl"><DialogHeader><DialogTitle className="flex items-center gap-2">الفاتورة {viewing?.invoiceNo}{viewing?.status === 'voided' && <Badge variant="destructive">ملغاة</Badge>}</DialogTitle></DialogHeader>{viewing && <div className="space-y-2">{viewing.items.map(i => <div key={i.id} className="flex items-center justify-between rounded-2xl border p-3"><div><b>{i.variant.product.name}</b><div className="text-xs text-muted-foreground">{i.variant.size || 'مقاس عام'}{i.variant.color ? ` · ${i.variant.color}` : ''} × {i.quantity}</div></div><b>{money(i.total)}</b></div>)}<div className="rounded-2xl bg-muted/40 p-4"><div className="flex justify-between"><span>الإجمالي</span><b>{money(viewing.total)}</b></div><div className="mt-1 flex justify-between"><span>المدفوع</span><b>{money(viewing.paid)}</b></div><div className="mt-1 flex justify-between"><span>الباقي</span><b>{money(viewing.change)}</b></div></div>{viewing.status === 'completed' && <Button variant="destructive" className="h-11 w-full rounded-xl" disabled={voidMutation.isPending} onClick={() => { if (confirm('هل تريد إلغاء الفاتورة دي؟ هيتم رجوع المخزون.')) voidMutation.mutate(viewing.id) }}><X className="me-2 size-4"/> {voidMutation.isPending ? 'جاري الإلغاء...' : 'إلغاء الفاتورة'}</Button>}</div>}</DialogContent></Dialog>
    <Dialog open={!!printing} onOpenChange={() => setPrinting(null)}><DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-3xl"><DialogHeader><DialogTitle>معاينة الإيصال</DialogTitle></DialogHeader>{printing && <div id="printable-invoice" className="bg-white p-3 text-black"><div className="text-center"><b>{storeName}</b><div className="text-xs">فاتورة بيع</div></div><div className="my-2 text-xs">{printing.invoiceNo} · {formatDateTime(printing.date)}</div>{printing.items.map(i => <div key={i.id} className="flex justify-between border-b border-dashed py-1 text-xs"><span>{i.variant.product.name} ×{i.quantity}</span><b>{money(i.total)}</b></div>)}<div className="mt-2 border-t border-dashed pt-2 text-sm font-black"><div className="flex justify-between"><span>الإجمالي</span><span>{money(printing.total)}</span></div>{receiptFooter && <div className="mt-2 text-center text-xs font-normal">{receiptFooter}</div>}</div></div>}<Button className="h-14 w-full rounded-2xl" onClick={() => window.print()}><Printer className="me-2"/> طباعة</Button></DialogContent></Dialog>

    {/* Sales history */}
    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="h-[85dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto rounded-3xl"><DialogHeader><DialogTitle>سجل الفواتير</DialogTitle></DialogHeader>
      {isLoading ? <div className="space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-20 rounded-2xl"/>)}</div> : sales.length === 0 ? <EmptyState title="لا توجد مبيعات" description="ابدأ أول فاتورة بيع" icon={Banknote}/> : <div className="space-y-2">{sales.map(s => <Card key={s.id} className="rounded-2xl"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-black">{s.invoiceNo}</div><div className="mt-1 text-xs text-muted-foreground">{s.customer?.name || 'عميل نقدي'} · {formatDateTime(s.date)}</div></div><div className="text-left"><Badge variant={saleStatusBadgeVariant(s.status)}>{saleStatusLabel(s.status)}</Badge><div className="mt-2 text-lg font-black">{money(s.total)}</div></div></div><div className="mt-3 flex gap-2"><Button variant="outline" className="h-11 flex-1 rounded-xl" onClick={() => setViewing(s)}><Eye className="me-2"/> عرض</Button><Button variant="outline" className="h-11 flex-1 rounded-xl" onClick={() => setPrinting(s)}><Printer className="me-2"/> طباعة</Button></div></CardContent></Card>)}</div>}
    </DialogContent></Dialog>
  </div>
}
