'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Search, Pencil, Trash2, Package, Filter, AlertTriangle, Tag, Layers } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP } from '@/lib/format'

interface Variant {
  id?: string
  sku: string
  barcode?: string | null
  size?: string | null
  color?: string | null
  material?: string | null
  costPrice: number
  sellPrice: number
  quantity: number
  minQuantity: number
  reorderQty: number
}

interface Product {
  id: string
  name: string
  description?: string | null
  categoryId: string
  category?: { id: string; name: string }
  brandId?: string | null
  brand?: { id: string; name: string } | null
  gender?: string | null
  season?: string | null
  material?: string | null
  image?: string | null
  variants: (Variant & { quantity: number; sellPrice: number; costPrice: number })[]
}

interface Category { id: string; name: string; _count?: { products: number } }
interface Brand { id: string; name: string }

const emptyVariant: Variant = {
  sku: '', barcode: '', size: '', color: '', material: '',
  costPrice: 0, sellPrice: 0, quantity: 0, minQuantity: 5, reorderQty: 10,
}

const emptyProduct = {
  name: '', description: '', categoryId: '', brandId: '',
  gender: 'unisex', season: 'all', material: '', image: '',
  variants: [{ ...emptyVariant }],
}

export function ProductsSection() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<Record<string, unknown>>(emptyProduct)
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)

  const { data: productsData, isLoading } = useQuery<{ items: Product[] }>({
    queryKey: ['products'],
    queryFn: async () => (await fetch('/api/products?pageSize=500')).json(),
  })
  const products = productsData?.items || []

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: async () => (await fetch('/api/categories')).json(),
  })

  const { data: brands = [] } = useQuery<Brand[]>({
    queryKey: ['brands'],
    queryFn: async () => (await fetch('/api/brands')).json(),
  })

  const filtered = useMemo(() => {
    return products.filter((p) => {
      const s = search.trim().toLowerCase()
      if (s && !p.name.toLowerCase().includes(s) && !p.variants.some((v) => v.sku.toLowerCase().includes(s))) return false
      if (categoryFilter !== 'all' && p.categoryId !== categoryFilter) return false
      return true
    })
  }, [products, search, categoryFilter])

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch('/api/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'خطأ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
      toast.success('تم إضافة المنتج بنجاح')
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/products/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'خطأ')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success('تم تحديث المنتج بنجاح')
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'خطأ')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      toast.success('تم حذف المنتج')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'خطأ')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      toast.success('تمت إضافة التصنيف')
      setNewCat('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addBrandMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/brands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error('فشل')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brands'] })
      toast.success('تمت إضافة الماركة')
      setNewBrand('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyProduct, categoryId: categories[0]?.id || '', variants: [{ ...emptyVariant }] })
    setDialogOpen(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setForm({
      name: p.name,
      description: p.description || '',
      categoryId: p.categoryId,
      brandId: p.brandId || '',
      gender: p.gender || 'unisex',
      season: p.season || 'all',
      material: p.material || '',
      image: p.image || '',
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode || '',
        size: v.size || '',
        color: v.color || '',
        material: v.material || '',
        costPrice: v.costPrice,
        sellPrice: v.sellPrice,
        quantity: v.quantity,
        minQuantity: v.minQuantity,
        reorderQty: v.reorderQty,
      })),
    })
    setDialogOpen(true)
  }

  function addVariant() {
    const variants = [...(form.variants as Variant[]), { ...emptyVariant }]
    setForm({ ...form, variants })
  }

  function removeVariant(idx: number) {
    const variants = (form.variants as Variant[]).filter((_, i) => i !== idx)
    if (variants.length === 0) {
      toast.error('يجب وجود variant واحد على الأقل')
      return
    }
    setForm({ ...form, variants })
  }

  function updateVariant(idx: number, key: keyof Variant, value: string | number) {
    const variants = [...(form.variants as Variant[])]
    variants[idx] = { ...variants[idx], [key]: value }
    setForm({ ...form, variants })
  }

  function submit() {
    const f = form as { name: string; categoryId: string; brandId?: string; variants: Variant[] }
    if (!f.name || !f.categoryId) {
      toast.error('الاسم والتصنيف مطلوبان')
      return
    }
    if (f.variants.some((v) => !v.sku)) {
      toast.error('كل variant يجب أن يكون له SKU')
      return
    }
    const data = {
      ...f,
      brandId: f.brandId || null,
      description: (form.description as string) || null,
      gender: (form.gender as string) || null,
      season: (form.season as string) || null,
      material: (form.material as string) || null,
      image: (form.image as string) || null,
      variants: f.variants.map((v) => ({
        ...v,
        barcode: v.barcode || null,
        size: v.size || null,
        color: v.color || null,
        material: v.material || null,
      })),
    }
    if (editing) {
      updateMutation.mutate({ id: editing.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">المنتجات والمخزون</h2>
          <p className="text-sm text-muted-foreground">منتجات بـ variants (مقاس/لون) — إدارة كاملة</p>
        </div>
        <div className="flex w-full sm:w-auto gap-2">
          <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><Tag className="size-4" /> التصنيفات</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>إدارة التصنيفات والماركات</DialogTitle>
                <DialogDescription>أضف أو احذف</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="mb-2 block">التصنيفات</Label>
                  <div className="flex gap-2 mb-2">
                    <Input placeholder="تصنيف جديد" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
                    <Button onClick={() => newCat && addCategoryMutation.mutate(newCat)}><Plus className="size-4" /></Button>
                  </div>
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {categories.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                        <span>{c.name}</span>
                        <Badge variant="secondary" className="text-[10px]">{c._count?.products || 0}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="mb-2 block">الماركات</Label>
                  <div className="flex gap-2 mb-2">
                    <Input placeholder="ماركة جديدة" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
                    <Button onClick={() => newBrand && addBrandMutation.mutate(newBrand)}><Plus className="size-4" /></Button>
                  </div>
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {brands.map((b) => (
                      <div key={b.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                        <span>{b.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={openCreate} size="sm" className="flex-1 sm:flex-none"><Plus className="size-4" /> منتج جديد</Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 p-3">
          <div className="relative w-full sm:flex-1 sm:min-w-[200px]">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="ابحث بالاسم أو SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
          </div>
          <div className="flex w-full sm:w-auto items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="كل التصنيفات" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل التصنيفات</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">لا توجد منتجات مطابقة</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((p) => {
                const totalQty = p.variants.reduce((s, v) => s + v.quantity, 0)
                const totalValue = p.variants.reduce((s, v) => s + v.costPrice * v.quantity, 0)
                const hasLow = p.variants.some((v) => v.quantity <= v.minQuantity)
                const expanded = expandedProduct === p.id
                return (
                  <div
                    key={p.id}
                    className={`rounded-xl border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm ${expanded ? 'ring-2 ring-primary/20' : ''}`}
                  >
                    {/* Header: name + status */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold truncate">{p.name}</h4>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{p.category?.name || '—'}</Badge>
                          {p.brand?.name && <Badge variant="secondary" className="text-[10px]">{p.brand.name}</Badge>}
                        </div>
                      </div>
                      {hasLow && (
                        <Badge variant="destructive" className="text-[10px] shrink-0">
                          <AlertTriangle className="me-1 size-2.5" /> منخفض
                        </Badge>
                      )}
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-2 my-3 py-2 border-y">
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground">Variants</p>
                        <p className="text-base font-bold">{p.variants.length}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground">الكمية</p>
                        <p className="text-base font-bold">{totalQty}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-muted-foreground">القيمة</p>
                        <p className="text-sm font-bold">{formatEGP(totalValue)}</p>
                      </div>
                    </div>

                    {/* Variants preview */}
                    {expanded && (
                      <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                        {p.variants.map((v) => {
                          const low = v.quantity <= v.minQuantity
                          return (
                            <div key={v.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                              <div className="min-w-0 flex-1 truncate">
                                <span className="font-mono">{v.sku}</span>
                                <span className="text-muted-foreground">
                                  {v.size ? ` · ${v.size}` : ''}
                                  {v.color ? ` · ${v.color}` : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-muted-foreground">{formatEGP(v.sellPrice)}</span>
                                <Badge variant={low ? 'destructive' : v.quantity === 0 ? 'secondary' : 'default'} className="text-[10px]">
                                  {v.quantity}
                                </Badge>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => setExpandedProduct(expanded ? null : p.id)}
                      >
                        <Layers className={`size-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                        {expanded ? 'إخفاء' : 'عرض'} variants
                      </Button>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(p)} aria-label="تعديل">
                          <Pencil className="size-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 text-destructive" aria-label="حذف">
                              <Trash2 className="size-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف المنتج؟</AlertDialogTitle>
                              <AlertDialogDescription>سيتم حذف "{p.name}" وكل variants الخاصة به.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>إلغاء</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(p.id)}>حذف</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit dialog with variants matrix */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل المنتج' : 'إضافة منتج جديد'}</DialogTitle>
            <DialogDescription>أدخل بيانات المنتج و variants (مقاس/لون)</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="col-span-1 sm:col-span-2 space-y-1.5">
                <Label>اسم المنتج *</Label>
                <Input value={form.name as string} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>التصنيف *</Label>
                <Select value={form.categoryId as string} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>الماركة</Label>
                <Select value={(form.brandId as string) || 'none'} onValueChange={(v) => setForm({ ...form, brandId: v === 'none' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="بدون" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون</SelectItem>
                    {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>الجنس</Label>
                <Select value={(form.gender as string) || 'unisex'} onValueChange={(v) => setForm({ ...form, gender: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">رجالي</SelectItem>
                    <SelectItem value="female">حريمي</SelectItem>
                    <SelectItem value="unisex">للجنسين</SelectItem>
                    <SelectItem value="kids">أطفال</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>الموسم</Label>
                <Select value={(form.season as string) || 'all'} onValueChange={(v) => setForm({ ...form, season: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="summer">صيفي</SelectItem>
                    <SelectItem value="winter">شتوي</SelectItem>
                    <SelectItem value="spring">ربيعي</SelectItem>
                    <SelectItem value="autumn">خريفي</SelectItem>
                    <SelectItem value="all">كل المواسم</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>الوصف</Label>
                <Input value={(form.description as string) || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <Label className="font-semibold">Variants (مقاس/لون)</Label>
                <Button size="sm" variant="outline" onClick={addVariant}>
                  <Plus className="size-3.5" /> إضافة variant
                </Button>
              </div>
              <div className="max-h-[40vh] space-y-2 overflow-y-auto">
                {(form.variants as Variant[]).map((v, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 rounded border bg-background p-2 text-xs">
                    <Input className="col-span-2 sm:col-span-3 h-10 sm:h-8" placeholder="SKU *" value={v.sku} onChange={(e) => updateVariant(idx, 'sku', e.target.value)} />
                    <Input className="col-span-2 sm:col-span-3 h-10 sm:h-8" placeholder="باركود" value={v.barcode || ''} onChange={(e) => updateVariant(idx, 'barcode', e.target.value)} dir="ltr" />
                    <Input className="col-span-1 sm:col-span-2 h-10 sm:h-8" placeholder="مقاس" value={v.size || ''} onChange={(e) => updateVariant(idx, 'size', e.target.value)} />
                    <Input className="col-span-1 sm:col-span-2 h-10 sm:h-8" placeholder="لون" value={v.color || ''} onChange={(e) => updateVariant(idx, 'color', e.target.value)} />
                    <Input className="col-span-1 sm:col-span-2 h-10 sm:h-8" type="number" placeholder="تكلفة" value={v.costPrice} onChange={(e) => updateVariant(idx, 'costPrice', Number(e.target.value))} />
                    <Input className="col-span-2 sm:col-span-3 h-10 sm:h-8" type="number" placeholder="سعر بيع" value={v.sellPrice} onChange={(e) => updateVariant(idx, 'sellPrice', Number(e.target.value))} />
                    <Input className="col-span-1 sm:col-span-2 h-10 sm:h-8" type="number" placeholder="كمية" value={v.quantity} onChange={(e) => updateVariant(idx, 'quantity', Number(e.target.value))} disabled={!!editing} />
                    <Input className="col-span-1 sm:col-span-2 h-10 sm:h-8" type="number" placeholder="حد أدنى" value={v.minQuantity} onChange={(e) => updateVariant(idx, 'minQuantity', Number(e.target.value))} />
                    <Input className="col-span-1 sm:col-span-2 h-10 sm:h-8" type="number" placeholder="إعادة طلب" value={v.reorderQty} onChange={(e) => updateVariant(idx, 'reorderQty', Number(e.target.value))} />
                    <Button size="icon" variant="ghost" className="col-span-2 sm:col-span-1 h-10 sm:h-8 text-destructive" onClick={() => removeVariant(idx)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              {editing && (
                <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-400">
                  ملاحظة: الكمية تُحفظ من التعديل اليدوي هنا — استخدم المشتريات/المرتجعات/التعديلات لتغيير المخزون بدقة.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={createMutation.isPending || updateMutation.isPending}>
              {editing ? 'حفظ' : 'إضافة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
