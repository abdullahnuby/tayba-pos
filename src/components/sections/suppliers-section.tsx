'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Pencil, Trash2, Users, Wallet, Phone, MapPin, ReceiptText, History } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'

interface Supplier {
  id: string
  name: string
  phone?: string | null
  address?: string | null
  notes?: string | null
  balance: number
  _count?: { purchases: number }
  totalPurchases?: number
  totalPaid?: number
}

const empty = { name: '', phone: '', address: '', notes: '' }

export function SuppliersSection() {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [form, setForm] = useState(empty)
  const [payDialog, setPayDialog] = useState<Supplier | null>(null)
  const [payAmount, setPayAmount] = useState(0)
  const [payMethod, setPayMethod] = useState('cash')
  const [statementEntity, setStatementEntity] = useState<Supplier | null>(null)
  const [search, setSearch] = useState('')

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await fetch('/api/suppliers')).json(),
  })

  const filtered = suppliers.filter((s) =>
    !search || s.name.includes(search) || (s.phone || '').includes(search)
  )

  const { data: statementData, isLoading: statementLoading } = useQuery<{ items: Array<{ id: string; date: string; amount: number; method: string; notes?: string | null; purchase?: { invoiceNo: string } | null }> } | null>({
    queryKey: ['supplier-payments', statementEntity?.id],
    queryFn: async () => {
      const res = await fetch('/api/supplier-payments?supplierId=' + encodeURIComponent(statementEntity!.id))
      if (!res.ok) throw new Error('تعذر تحميل كشف الحساب')
      return res.json()
    },
    enabled: !!statementEntity,
  })

  const saveMutation = useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: Record<string, string> }) => {
      const url = id ? `/api/suppliers/${id}` : '/api/suppliers'
      const method = id ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'خطأ')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success('تم الحفظ')
      setDialogOpen(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/suppliers/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('فشل')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      toast.success('تم الحذف')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const payMutation = useMutation({
    mutationFn: async (data: { supplierId: string; amount: number; method: string }) => {
      const res = await fetch('/api/supplier-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'خطأ')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success('تم تسجيل الدفعة وتحديث رصيد المورد')
      setPayDialog(null)
      setPayAmount(0)
      setPayMethod('cash')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const totalOwed = suppliers.reduce((s, x) => s + (x.balance || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">الموردين</h2>
          <p className="text-sm text-muted-foreground">إدارة الموردين والمستحقات المالية</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm(empty); setDialogOpen(true) }}>
          <Plus className="size-4" /> مورد جديد
        </Button>
      </div>

      {/* Summary card */}
      {totalOwed > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs text-amber-800 dark:text-amber-300">إجمالي المستحق للموردين</p>
              <p className="text-2xl font-bold text-amber-900 dark:text-amber-200">{formatEGP(totalOwed)} ج.م</p>
            </div>
            <div className="flex size-12 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600">
              <Wallet className="size-6" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <Input
          placeholder="ابحث باسم المورد أو الهاتف..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11"
        />
      </div>

      {/* Supplier cards grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="لا توجد موردين" description="أضف أول مورد" icon={Users} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <Card key={s.id} className="card-hover">
              <CardContent className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-base font-semibold truncate">{s.name}</h4>
                    {s.phone && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5" dir="ltr">
                        <Phone className="size-3" /> {s.phone}
                      </p>
                    )}
                  </div>
                  {s.balance > 0 && (
                    <Badge variant="destructive" className="shrink-0">
                      مستحق: {formatEGP(s.balance)}
                    </Badge>
                  )}
                </div>

                {/* Address */}
                {s.address && (
                  <p className="text-xs text-muted-foreground flex items-start gap-1 mb-3">
                    <MapPin className="size-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{s.address}</span>
                  </p>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 my-3 py-2 border-y">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">فواتير</p>
                    <p className="text-base font-bold">{s._count?.purchases || 0}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">إجمالي الشراء</p>
                    <p className="text-sm font-bold">{formatEGP(s.totalPurchases || 0)}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3">
                  {s.balance > 0 && (
                    <Button size="sm" variant="default" className="flex-1 h-11" onClick={() => { setPayDialog(s); setPayAmount(s.balance) }}>
                      <Wallet className="size-4" /> سداد {formatEGP(s.balance)}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-10 px-3 shrink-0" onClick={() => setStatementEntity(s)}>
                    <ReceiptText className="size-4" /> <span className="hidden sm:inline">كشف</span>
                  </Button>
                  <Button variant="ghost" size="icon" className="size-9" onClick={() => { setEditing(s); setForm({ name: s.name, phone: s.phone || '', address: s.address || '', notes: s.notes || '' }); setDialogOpen(true) }} aria-label="تعديل">
                    <Pencil className="size-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-10 text-destructive" aria-label="حذف" disabled={s.balance > 0}>
                        <Trash2 className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>حذف المورد؟</AlertDialogTitle>
                        <AlertDialogDescription>سيتم حذف "{s.name}".</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>إلغاء</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(s.id)}>حذف</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!statementEntity} onOpenChange={(open) => !open && setStatementEntity(null)}>
        <DialogContent className="max-h-[90dvh] overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="flex items-center gap-2"><History className="size-5" /> كشف حساب مورد</DialogTitle>
            <p className="text-sm text-muted-foreground">{statementEntity?.name} — الرصيد الحالي: <span className="font-bold text-foreground">{formatEGP(statementEntity?.balance || 0)} ج.م</span></p>
          </DialogHeader>
          <div className="max-h-[60dvh] overflow-y-auto px-5 py-4">
            {statementLoading ? (
              <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
            ) : !statementData?.items?.length ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">لا توجد حركات مسجلة حتى الآن.</div>
            ) : (
              <div className="space-y-2">
                {statementData.items.map((item) => (
                  <div key={item.id} className="rounded-xl border p-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="font-medium">دفعة — {item.method === 'cash' ? 'نقدي' : item.method === 'card' ? 'بطاقة' : 'تحويل'}</p>
                      <p className="text-xs text-muted-foreground">{new Date(item.date).toLocaleString('ar-EG')}{item.purchase?.invoiceNo ? ` • فاتورة ${item.purchase!.invoiceNo}` : ''}</p>
                    </div>
                    <p className="mt-2 text-base font-bold sm:mt-0">{formatEGP(item.amount)} ج.م</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="border-t px-5 py-4"><Button className="h-11 w-full sm:w-auto" onClick={() => setStatementEntity(null)}>إغلاق</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل مورد' : 'إضافة مورد'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11" /></div>
            <div className="space-y-1.5"><Label>الهاتف</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" className="h-11" /></div>
            <div className="space-y-1.5"><Label>العنوان</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="h-11" /></div>
            <div className="space-y-1.5"><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={() => saveMutation.mutate({ id: editing?.id, data: form })}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>سداد دفعة للمورد</DialogTitle>
            <p className="text-sm text-muted-foreground">
              {payDialog?.name} — المستحق: {formatEGP(payDialog?.balance || 0)} ج.م
            </p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>المبلغ (ج.م)</Label>
              <Input type="number" min={0.01} max={payDialog?.balance || 0} value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>طريقة الدفع</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="card">بطاقة</SelectItem>
                  <SelectItem value="transfer">تحويل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(null)}>إلغاء</Button>
            <Button onClick={() => payDialog && payMutation.mutate({ supplierId: payDialog.id, amount: payAmount, method: payMethod })}>
              سداد {formatEGP(payAmount)} ج.م
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
