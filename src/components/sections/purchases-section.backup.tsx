'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, ShoppingCart, Eye, X, Search, PackagePlus } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP, formatDateTime } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'

interface Variant {
  id: string
  sku: string
  size: string | null
  color: string | null
  costPrice: number
  quantity: number
  product: { name: string }
}

interface Supplier { id: string; name: string; balance: number }

interface Purchase {
  id: string
  invoiceNo: string
  date: string
  subtotal: number
  discount: number
  taxAmount: number
  total: number
  paid: number
  status: string
  notes?: string | null
  supplier?: { name: string }
  items: {
    id: string
    variantId: string
    quantity: number
    unitCost: number
    total: number
    variant: { sku: string; size: string | null; color: string | null; product: { name: string } }
  }[]
}

interface LineItem {
  variantId: string
  quantity: number
  unitCost: number
}

export function PurchasesSection() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [viewing, setViewing] = useState<Purchase | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([])
  const [variantSearch, setVariantSearch] = useState('')

  const { data: purchasesData, isLoading } = useQuery<{ items: Purchase[] }>({
    queryKey: ['purchases'],
    queryFn: async () => (await fetch('/api/purchases?pageSize=100')).json(),
  })
  const purchases = purchasesData?.items || []

  const { data: productsData } = useQuery<{ items: { id: string; name: string; variants: Variant[] }[] }>({
    queryKey: ['products-for-purchases'],
    queryFn: async () => (await fetch('/api/products?pageSize=500')).json(),
  })
  const allVariants: (Variant & { productName: string })[] = []
  for (const p of productsData?.items || []) {
    for (const v of p.variants) {
      allVariants.push({ ...v, productName: p.name })
    }
  }

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await fetch('/api/suppliers')).json(),
  })

  const filteredPurchases = purchases.filter((p) =>
    !search || p.invoiceNo.includes(search) || p.supplier?.name.includes(search)
  )

  const filteredVariants = useMemo(() => {
    const s = variantSearch.trim().toLowerCase()
    if (!s) return allVariants.slice(0, 30)
    return allVariants.filter((v) =>
      v.sku.toLowerCase().includes(s) || v.productName.toLowerCase().includes(s)
    ).slice(0, 30)
  }, [allVariants, variantSearch])

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0)
  const afterDiscount = Math.max(0, subtotal - discount)
  const total = afterDiscount
  const remaining = total - paid

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'خطأ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success('تم تسجيل فاتورة الشراء وتحديث المخزون بتكلفة المتوسط المرجح')
      setDialogOpen(false)
      resetForm()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function resetForm() {
    setSupplierId('')
    setDiscount(0)
    setPaid(0)
    setPaymentMethod('cash')
    setNotes('')
    setItems([])
    setVariantSearch('')
  }

  function addLineItem(v: Variant & { productName: string }) {
    if (items.find((i) => i.variantId === v.id)) {
      toast.info('المنتج موجود في القائمة — عدّل الكمية')
      return
    }
    setItems([...items, { variantId: v.id, quantity: 1, unitCost: v.costPrice }])
    setVariantSearch('')
  }

  function updateItem(idx: number, key: keyof LineItem, value: number) {
    const next = [...items]
    next[idx] = { ...next[idx], [key]: value }
    setItems(next)
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx))
  }

  function submit() {
    if (!supplierId) return toast.error('اختر المورد')
    if (items.length === 0) return toast.error('أضف بندًا واحدًا على الأقل')
    createMutation.mutate({
      supplierId,
      discount: Number(discount) || 0,
      paid: Number(paid) || 0,
      paymentMethod,
      notes,
      status: 'completed',
      items,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">المشتريات</h2>
          <p className="text-sm text-muted-foreground">فواتير الموردين — تحدّث المخزون بتكلفة المتوسط المرجح</p>
        </div>
        <Button onClick={() => { resetForm(); setDialogOpen(true) }} size="sm" className="min-h-11">
          <Plus className="size-4" /> فاتورة شراء
        </Button>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="ابحث برقم الفاتورة أو المورد..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">قائمة فواتير الشراء ({filteredPurchases.length})</CardTitle></CardHeader>
        <CardContent className="px-3 sm:px-6">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredPurchases.length === 0 ? (
            <EmptyState title="لا توجد مشتريات" description="ابدأ بإنشاء أول فاتورة شراء" icon={ShoppingCart} />
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-md border table-sticky">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الفاتورة</TableHead>
                    <TableHead>المورد</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead className="text-center">الأصناف</TableHead>
                    <TableHead className="text-center">الإجمالي</TableHead>
                    <TableHead className="text-center">المدفوع</TableHead>
                    <TableHead className="text-center">المتبقي</TableHead>
                    <TableHead className="text-center">عرض</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPurchases.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.invoiceNo}</TableCell>
                      <TableCell className="text-sm">{p.supplier?.name || '—'}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(p.date)}</TableCell>
                      <TableCell className="text-center"><Badge variant="secondary" className="text-xs">{p.items.length}</Badge></TableCell>
                      <TableCell className="text-center font-semibold">{formatEGP(p.total)} ج.م</TableCell>
                      <TableCell className="text-center text-xs">{formatEGP(p.paid)} ج.م</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={p.total - p.paid > 0 ? 'destructive' : 'default'} className="text-xs">
                          {formatEGP(p.total - p.paid)} ج.م
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setViewing(p)}><Eye className="size-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[800px] max-h-[94dvh] overflow-y-auto p-4 sm:p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle>فاتورة شراء جديدة</DialogTitle>
            <DialogDescription>اختر المورد وأضف الأصناف — سيتم تحديث المخزون بتكلفة المتوسط المرجح</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>المورد *</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="اختر المورد" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.balance > 0 && <span className="text-amber-600"> (مستحق: {formatEGP(s.balance)})</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>طريقة الدفع</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="card">بطاقة</SelectItem>
                    <SelectItem value="transfer">تحويل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>بحث المنتج لإضافته</Label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="اسم المنتج أو SKU..."
                  value={variantSearch}
                  onChange={(e) => setVariantSearch(e.target.value)}
                  className="pr-9"
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-xl border bg-muted/20">
                {filteredVariants.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">لا توجد نتائج</p>
                ) : (
                  filteredVariants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => addLineItem(v)}
                      className="flex min-h-14 w-full items-center justify-between gap-3 border-b px-3 py-2.5 text-right text-sm active:bg-accent hover:bg-accent last:border-b-0"
                    >
                      <div>
                        <div className="font-medium">{v.productName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{v.sku}{v.size ? ` · ${v.size}` : ''}{v.color ? ` · ${v.color}` : ''}</div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">تكلفة: {formatEGP(v.costPrice)}</Badge>
                    </button>
                  ))
                )}
              </div>
            </div>

            {items.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>الأصناف في الفاتورة ({items.length})</Label>
                  <span className="text-xs text-muted-foreground">اسحب/مرر للتعديل</span>
                </div>

                {/* Mobile: one focused card per purchase line */}
                <div className="space-y-2 sm:hidden">
                  {items.map((it, idx) => {
                    const v = allVariants.find((x) => x.id === it.variantId)
                    return (
                      <div key={it.variantId} className="rounded-xl border bg-card p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{v?.productName || '—'}</div>
                            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{v?.sku}{v?.size ? ` · ${v.size}` : ''}{v?.color ? ` · ${v.color}` : ''}</div>
                          </div>
                          <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0 text-destructive" onClick={() => removeItem(idx)} aria-label="حذف الصنف">
                            <X className="size-4" />
                          </Button>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[11px]">الكمية</Label>
                            <Input type="number" inputMode="numeric" min={1} value={it.quantity} onChange={(e) => updateItem(idx, 'quantity', Math.max(1, Number(e.target.value) || 1))} className="h-11 text-base" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px]">تكلفة الوحدة</Label>
                            <Input type="number" inputMode="decimal" min={0} step="0.01" value={it.unitCost} onChange={(e) => updateItem(idx, 'unitCost', Math.max(0, Number(e.target.value) || 0))} className="h-11 text-base" />
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                          <span>إجمالي البند</span><strong>{formatEGP(it.quantity * it.unitCost)} ج.م</strong>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Desktop: compact table */}
                <div className="hidden overflow-x-auto rounded-md border sm:block">
                  <Table>
                    <TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>SKU</TableHead><TableHead className="text-center">الكمية</TableHead><TableHead className="text-center">تكلفة الوحدة</TableHead><TableHead className="text-center">الإجمالي</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {items.map((it, idx) => {
                        const v = allVariants.find((x) => x.id === it.variantId)
                        return <TableRow key={it.variantId}>
                          <TableCell className="text-xs">{v?.productName || '—'}</TableCell>
                          <TableCell className="font-mono text-xs">{v?.sku}</TableCell>
                          <TableCell className="text-center"><Input type="number" min={1} value={it.quantity} onChange={(e) => updateItem(idx, 'quantity', Math.max(1, Number(e.target.value) || 1))} className="h-8 w-16 text-xs" /></TableCell>
                          <TableCell className="text-center"><Input type="number" min={0} step="0.01" value={it.unitCost} onChange={(e) => updateItem(idx, 'unitCost', Math.max(0, Number(e.target.value) || 0))} className="h-8 w-20 text-xs" /></TableCell>
                          <TableCell className="text-center font-semibold text-xs">{formatEGP(it.quantity * it.unitCost)}</TableCell>
                          <TableCell><Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => removeItem(idx)}><X className="size-3.5" /></Button></TableCell>
                        </TableRow>
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label>الخصم</Label>
                <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label>المدفوع</Label>
                <Input type="number" min={0} value={paid} onChange={(e) => setPaid(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>ملاحظات</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>

            <div className="rounded-xl border bg-muted/30 p-3 text-sm sm:text-xs">
              <div className="flex justify-between"><span>الإجمالي الفرعي:</span><span>{formatEGP(subtotal)} ج.م</span></div>
              <div className="flex justify-between"><span>الخصم:</span><span>{formatEGP(discount)} ج.م</span></div>
              <div className="flex justify-between font-bold text-base"><span>الإجمالي:</span><span>{formatEGP(total)} ج.م</span></div>
              <div className="flex justify-between text-amber-700 dark:text-amber-400">
                <span>المتبقي للمورد:</span><span>{formatEGP(remaining)} ج.م</span>
              </div>
            </div>
          </div>
          <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 flex-col-reverse gap-2 border-t bg-background/95 p-4 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
            <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button className="min-h-11 w-full sm:w-auto" onClick={submit} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'جارٍ الحفظ...' : 'تسجيل الفاتورة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-[600px]">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle>تفاصيل فاتورة الشراء {viewing.invoiceNo}</DialogTitle>
                <DialogDescription>{viewing.supplier?.name} · {formatDateTime(viewing.date)}</DialogDescription>
              </DialogHeader>
              <div className="max-h-[40vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الصنف</TableHead>
                      <TableHead className="text-center">الكمية</TableHead>
                      <TableHead className="text-center">التكلفة</TableHead>
                      <TableHead className="text-center">الإجمالي</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewing.items.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="text-xs">{i.variant.product.name}{i.variant.size ? ` (${i.variant.size})` : ''}<div className="font-mono text-[10px] text-muted-foreground">{i.variant.sku}</div></TableCell>
                        <TableCell className="text-center text-xs">{i.quantity}</TableCell>
                        <TableCell className="text-center text-xs">{formatEGP(i.unitCost)}</TableCell>
                        <TableCell className="text-center text-xs font-semibold">{formatEGP(i.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs">
                <div className="flex justify-between"><span>الفرعي:</span><span>{formatEGP(viewing.subtotal)} ج.م</span></div>
                <div className="flex justify-between"><span>الخصم:</span><span>{formatEGP(viewing.discount)} ج.م</span></div>
                {viewing.taxAmount > 0 && <div className="flex justify-between"><span>الضريبة:</span><span>{formatEGP(viewing.taxAmount)} ج.م</span></div>}
                <div className="flex justify-between font-bold"><span>الإجمالي:</span><span>{formatEGP(viewing.total)} ج.م</span></div>
                <div className="flex justify-between text-muted-foreground"><span>المدفوع:</span><span>{formatEGP(viewing.paid)} ج.م</span></div>
                {viewing.total - viewing.paid > 0 && (
                  <div className="flex justify-between text-amber-700 dark:text-amber-400"><span>المتبقي للمورد:</span><span>{formatEGP(viewing.total - viewing.paid)} ج.م</span></div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
