'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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
import { Plus, ClipboardList, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP, formatDateTime, STOCK_ADJUSTMENT_TYPES, stockAdjustmentTypeLabel } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'

interface Variant {
  id: string
  sku: string
  size: string | null
  color: string | null
  quantity: number
  product: { name: string }
}

interface Adjustment {
  id: string
  type: string
  quantityChange: number
  reason: string | null
  notes: string | null
  createdAt: string
  variant: { sku: string; product: { name: string } }
  user: { name: string } | null
}

export function StockAdjustmentsSection() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [variantId, setVariantId] = useState('')
  const [type, setType] = useState('damage')
  const [quantityChange, setQuantityChange] = useState(-1)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')

  const { data: adjustmentsData, isLoading } = useQuery<{ items: Adjustment[] }>({
    queryKey: ['stock-adjustments'],
    queryFn: async () => (await fetch('/api/stock-adjustments')).json(),
  })
  const adjustments = adjustmentsData?.items || []

  const { data: productsData } = useQuery<{ items: { id: string; name: string; variants: Variant[] }[] }>({
    queryKey: ['products-for-adjustments'],
    queryFn: async () => (await fetch('/api/products?pageSize=500')).json(),
  })
  const allVariants: (Variant & { productName: string })[] = []
  for (const p of productsData?.items || []) {
    for (const v of p.variants) {
      allVariants.push({ ...v, productName: p.name })
    }
  }

  const filteredVariants = allVariants.filter((v) =>
    !search || v.sku.includes(search) || v.productName.includes(search)
  ).slice(0, 50)

  const filteredAdjustments = adjustments.filter((a) =>
    !search || a.variant.sku.includes(search) || a.variant.product.name.includes(search)
  )

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch('/api/stock-adjustments', {
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
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success('تم تسجيل تعديل المخزون')
      setOpen(false)
      setVariantId('')
      setType('damage')
      setQuantityChange(-1)
      setReason('')
      setNotes('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function submit() {
    if (!variantId) return toast.error('اختر variant')
    if (quantityChange === 0) return toast.error('الكمية لا يمكن أن تكون صفر')
    createMutation.mutate({
      variantId, type, quantityChange, reason, notes,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">تعديلات المخزون</h2>
          <p className="text-sm text-muted-foreground">تالف، مسروق، عينة، جرد، تحويلات</p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm">
          <Plus className="size-4" /> تعديل جديد
        </Button>
      </div>

      <Card>
        <CardContent className="p-3">
          <Input
            placeholder="ابحث برقم SKU أو اسم المنتج..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">السجل ({filteredAdjustments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredAdjustments.length === 0 ? (
            <EmptyState title="لا توجد تعديلات" description="سجل أول تعديل للمخزون" icon={ClipboardList} />
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-md border table-sticky">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المنتج</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead className="text-center">التغيير</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>المستخدم</TableHead>
                    <TableHead>التاريخ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAdjustments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs font-medium">{a.variant.product.name}</TableCell>
                      <TableCell className="font-mono text-xs">{a.variant.sku}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{stockAdjustmentTypeLabel(a.type)}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={a.quantityChange < 0 ? 'destructive' : 'default'} className="text-xs">
                          {a.quantityChange > 0 ? '+' : ''}{a.quantityChange}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{a.reason || '—'}</TableCell>
                      <TableCell className="text-xs">{a.user?.name || '—'}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(a.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل مخزون جديد</DialogTitle>
            <DialogDescription>سجل تالف، عينة، جرد، إلخ</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>بحث المنتج</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم المنتج أو SKU..." />
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {filteredVariants.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">لا توجد نتائج</p>
                ) : (
                  filteredVariants.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setVariantId(v.id)}
                      className={`flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-right text-xs hover:bg-accent ${variantId === v.id ? 'bg-primary/10' : ''}`}
                    >
                      <div>
                        <div className="font-medium">{v.productName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{v.sku} · متوفر: {v.quantity}</div>
                      </div>
                      <div className="text-xs">
                        {v.size && <Badge variant="outline" className="me-1 text-[10px]">{v.size}</Badge>}
                        {v.color && <Badge variant="outline" className="text-[10px]">{v.color}</Badge>}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>النوع</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STOCK_ADJUSTMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>التغيير في الكمية</Label>
                <Input
                  type="number"
                  value={quantityChange}
                  onChange={(e) => setQuantityChange(Number(e.target.value))}
                  placeholder="-1 لتالف، +5 لاستلام"
                />
                <p className="text-xs text-muted-foreground">سالب = نقصان، موجب = زيادة</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>السبب</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="علبة مكسورة، خطأ عدّ..." />
            </div>
            <div className="space-y-1.5">
              <Label>ملاحظات</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit} disabled={createMutation.isPending}>تسجيل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
