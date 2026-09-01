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
import { Textarea } from '@/components/ui/textarea'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Banknote, Plus, Play, Square, WalletCards, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP, formatDateTime } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'

interface RegisterSession {
  id: string
  openedAt: string
  closedAt: string | null
  openingFloat: number
  closingFloat: number | null
  expectedCash: number | null
  difference: number | null
  cashSales: number
  cardSales: number
  transferSales: number
  notes: string | null
  status: 'open' | 'closed'
  user: { name: string; username: string }
}

export function RegisterSection() {
  const qc = useQueryClient()
  const [openDialog, setOpenDialog] = useState(false)
  const [closeDialog, setCloseDialog] = useState<RegisterSession | null>(null)
  const [openingFloat, setOpeningFloat] = useState(500)
  const [closingFloat, setClosingFloat] = useState(0)
  const [notes, setNotes] = useState('')

  const { data, isLoading } = useQuery<{ items: RegisterSession[] }>({
    queryKey: ['register-sessions'],
    queryFn: async () => (await fetch('/api/register-sessions')).json(),
  })
  const sessions = data?.items || []
  const openSession = sessions.find((s) => s.status === 'open')

  const openSessionMutation = useMutation({
    mutationFn: async (data: { openingFloat: number; notes?: string }) => {
      const res = await fetch('/api/register-sessions', {
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
      qc.invalidateQueries({ queryKey: ['register-sessions'] })
      toast.success('تم فتح الوردية بنجاح')
      setOpenDialog(false)
      setOpeningFloat(500)
      setNotes('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const closeSessionMutation = useMutation({
    mutationFn: async (data: { sessionId: string; closingFloat: number; notes?: string }) => {
      const res = await fetch('/api/register-sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.error || 'خطأ')
      }
      return res.json()
    },
    onSuccess: (s: RegisterSession) => {
      qc.invalidateQueries({ queryKey: ['register-sessions'] })
      const diff = s.difference ?? 0
      if (Math.abs(diff) < 1) {
        toast.success('تم إغلاق الوردية — لا يوجد فرق')
      } else if (diff > 0) {
        toast.warning(`تم الإغلاق — زيادة ${formatEGP(diff)} ج.م`)
      } else {
        toast.error(`تم الإغلاق — عجز ${formatEGP(Math.abs(diff))} ج.م`)
      }
      setCloseDialog(null)
      setClosingFloat(0)
      setNotes('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-5 pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><WalletCards className="size-5" /></div><div><h2 className="text-xl font-bold tracking-tight sm:text-2xl">الورديات والكاش</h2>
          <p className="text-sm text-muted-foreground">افتح الوردية، تابع التحصيل، ثم أغلقها بعد عدّ النقد الفعلي.</p></div></div></div>
        {!openSession && (
          <Button className="min-h-11 w-full sm:w-auto" onClick={() => setOpenDialog(true)} size="sm">
            <Plus className="size-4" /> فتح وردية
          </Button>
        )}
      </div>

      {openSession && (
        <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardContent className="p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-lg bg-emerald-600 text-white animate-pulse">
                <Banknote className="size-6" />
              </div>
              <div>
                <p className="font-bold">وردية مفتوحة</p>
                <p className="text-xs text-muted-foreground">
                  فتحت: {formatDateTime(openSession.openedAt)} · الكاشير: {openSession.user.name}
                </p>
                <p className="text-xs">رصيد الافتتاح: {formatEGP(openSession.openingFloat)} ج.م</p>
              </div>
            </div>
            <Button className="min-h-11 w-full sm:w-auto" variant="destructive" onClick={() => setCloseDialog(openSession)}>
              <Square className="size-4" /> إغلاق الوردية
            </Button></div><div className="grid grid-cols-2 gap-2 border-t pt-3 sm:grid-cols-4"><div className="rounded-lg bg-background/70 p-2.5"><p className="text-[11px] text-muted-foreground">رصيد البداية</p><p className="mt-1 text-sm font-bold">{formatEGP(openSession.openingFloat)} ج.م</p></div><div className="rounded-lg bg-background/70 p-2.5"><p className="text-[11px] text-muted-foreground">نقدي</p><p className="mt-1 text-sm font-bold">{formatEGP(openSession.cashSales)} ج.م</p></div><div className="rounded-lg bg-background/70 p-2.5"><p className="text-[11px] text-muted-foreground">بطاقة</p><p className="mt-1 text-sm font-bold">{formatEGP(openSession.cardSales)} ج.م</p></div><div className="rounded-lg bg-background/70 p-2.5"><p className="text-[11px] text-muted-foreground">تحويل</p><p className="mt-1 text-sm font-bold">{formatEGP(openSession.transferSales)} ج.م</p></div></div></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">سجل الورديات ({sessions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState title="لا توجد ورديات" description="افتح أول وردية للبدء" icon={Banknote} />
          ) : (
            <>
            <div className="space-y-2 md:hidden">
              {sessions.map((s) => (
                <div key={s.id} className="rounded-xl border bg-card p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.user.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(s.openedAt)}</p>
                    </div>
                    <Badge variant={s.status === 'open' ? 'default' : 'secondary'} className="shrink-0 text-xs">
                      {s.status === 'open' ? 'مفتوحة' : 'مغلقة'}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-muted/40 p-2"><span className="text-muted-foreground">البداية</span><p className="mt-0.5 font-semibold">{formatEGP(s.openingFloat)} ج.م</p></div>
                    <div className="rounded-lg bg-muted/40 p-2"><span className="text-muted-foreground">المتوقع</span><p className="mt-0.5 font-semibold">{s.expectedCash == null ? 'عند الإغلاق' : `${formatEGP(s.expectedCash)} ج.م`}</p></div>
                    <div className="rounded-lg bg-muted/40 p-2"><span className="text-muted-foreground">الفعلي</span><p className="mt-0.5 font-semibold">{s.closingFloat == null ? '—' : `${formatEGP(s.closingFloat)} ج.م`}</p></div>
                    <div className="rounded-lg bg-muted/40 p-2"><span className="text-muted-foreground">الفرق</span><p className="mt-0.5 font-semibold">{s.difference == null ? '—' : `${s.difference >= 0 ? '+' : ''}${formatEGP(s.difference)} ج.م`}</p></div>
                  </div>
                  {s.difference != null && Math.abs(s.difference) >= 1 && <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive"><AlertTriangle className="size-3.5" /> يحتاج مراجعة</div>}
                </div>
              ))}
            </div>
            <div className="hidden max-h-[60vh] overflow-auto rounded-md border table-sticky md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الكاشير</TableHead>
                    <TableHead>الافتتاح</TableHead>
                    <TableHead>الإغلاق</TableHead>
                    <TableHead className="text-center">رصيد بداية</TableHead>
                    <TableHead className="text-center">نقدي متوقع</TableHead>
                    <TableHead className="text-center">فعلي</TableHead>
                    <TableHead className="text-center">الفرق</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs">{s.user.name}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(s.openedAt)}</TableCell>
                      <TableCell className="text-xs">{s.closedAt ? formatDateTime(s.closedAt) : '—'}</TableCell>
                      <TableCell className="text-center text-xs">{formatEGP(s.openingFloat)}</TableCell>
                      <TableCell className="text-center text-xs">{s.expectedCash ? formatEGP(s.expectedCash) : '—'}</TableCell>
                      <TableCell className="text-center text-xs">{s.closingFloat ? formatEGP(s.closingFloat) : '—'}</TableCell>
                      <TableCell className="text-center">
                        {s.difference == null ? (
                          '—'
                        ) : (
                          <Badge variant={Math.abs(s.difference) < 1 ? 'default' : 'destructive'} className="text-xs">
                            {s.difference >= 0 ? '+' : ''}{formatEGP(s.difference)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={s.status === 'open' ? 'default' : 'secondary'} className="text-xs">
                          {s.status === 'open' ? 'مفتوحة' : 'مغلقة'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Open dialog */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>فتح وردية جديدة</DialogTitle>
            <DialogDescription>سجل رصيد النقد في بداية الوردية</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="of">رصيد الافتتاح (ج.م)</Label>
              <Input id="of" type="number" min={0} value={openingFloat} onChange={(e) => setOpeningFloat(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="on">ملاحظات</Label>
              <Textarea id="on" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button className="min-h-11" variant="outline" onClick={() => setOpenDialog(false)}>إلغاء</Button>
            <Button className="min-h-11" onClick={() => openSessionMutation.mutate({ openingFloat, notes })} disabled={openSessionMutation.isPending}>
              <Play className="size-4" /> فتح
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close dialog */}
      <Dialog open={!!closeDialog} onOpenChange={(o) => !o && setCloseDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إغلاق الوردية</DialogTitle>
            <DialogDescription>
              عدّ النقد الفعلي في الدرج وأدخله للمطابقة
            </DialogDescription>
          </DialogHeader>
          {closeDialog && (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                <div className="flex justify-between"><span>رصيد بداية:</span><span className="font-semibold">{formatEGP(closeDialog.openingFloat)} ج.م</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">النقدية المتوقعة:</span><span className="font-semibold">تُحسب لحظة الإغلاق</span></div><div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />المبلغ الفعلي هو كل النقد الموجود في الدرج، وليس إجمالي المبيعات.</div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cf">النقد الفعلي في الدرج (ج.م)</Label>
                <Input id="cf" type="number" min={0} value={closingFloat} onChange={(e) => setClosingFloat(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cn">ملاحظات الإغلاق</Label>
                <Textarea id="cn" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button className="min-h-11" variant="outline" onClick={() => setCloseDialog(null)}>إلغاء</Button>
            <Button className="min-h-11" variant="destructive" onClick={() => closeDialog && closeSessionMutation.mutate({
              sessionId: closeDialog.id, closingFloat, notes,
            })} disabled={closeSessionMutation.isPending}>
              <Square className="size-4" /> تأكيد الإغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
