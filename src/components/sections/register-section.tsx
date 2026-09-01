'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Banknote, LockKeyhole, Play, Square, Printer, Share2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP, formatDateTime } from '@/lib/format'
import { useAppStore } from '@/lib/store'

interface Session { id:string;openedAt:string;closedAt:string|null;openingFloat:number;closingFloat:number|null;expectedCash:number|null;difference:number|null;cashSales:number;cardSales:number;transferSales:number;status:'open'|'closed';user:{name:string} }
interface Report { invoiceCount:number;cashSales:number;cardSales:number;transferSales:number;creditSales:number;customerCash:number;cashRefunds:number;openingFloat:number;expectedCash:number;closingFloat:number;difference:number;totalSales:number;closedAt:string }

export function RegisterSection() {
  const qc=useQueryClient()
  const setSection=useAppStore(s=>s.setSection)
  const [openDialog,setOpenDialog]=useState(false)
  const [closeDialog,setCloseDialog]=useState<Session|null>(null)
  const [password,setPassword]=useState('')
  const [openingFloat,setOpeningFloat]=useState(0)
  const [closingFloat,setClosingFloat]=useState(0)
  const [notes,setNotes]=useState('')
  const [report,setReport]=useState<Report|null>(null)
  const {data,isLoading}=useQuery<{items:Session[]}>({queryKey:['register-sessions'],queryFn:async()=>{const r=await fetch('/api/register-sessions');if(!r.ok)throw new Error('register');return r.json()},refetchInterval:30000})
  const sessions=data?.items||[]
  const open=sessions.find(s=>s.status==='open')
  const openMutation=useMutation({mutationFn:async()=>{const r=await fetch('/api/register-sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({openingFloat,password,notes})});const j=await r.json();if(!r.ok)throw new Error(j.error||'فشل فتح الوردية');return j},onSuccess:()=>{qc.invalidateQueries({queryKey:['register-sessions']});setOpenDialog(false);setPassword('');setNotes('');toast.success('تم فتح الوردية');setSection('sales')},onError:(e:Error)=>toast.error(e.message)})
  const closeMutation=useMutation({mutationFn:async()=>{if(!closeDialog)throw new Error('لا توجد وردية');const r=await fetch('/api/register-sessions',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:closeDialog.id,closingFloat,password,notes})});const j=await r.json();if(!r.ok)throw new Error(j.error||'فشل إغلاق الوردية');return j},onSuccess:(j)=>{qc.invalidateQueries({queryKey:['register-sessions']});setPassword('');setNotes('');setReport(j.report);setCloseDialog(null);toast.success('تم إغلاق الوردية')},onError:(e:Error)=>toast.error(e.message)})

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3"><div><h2 className="text-2xl font-black">الوردية</h2><p className="text-sm text-muted-foreground">الكاشير يفتح ويغلق ورديته فقط، والإدارة ترى السجل الكامل.</p></div>{!open&&<Button className="ms-auto h-12" onClick={()=>setOpenDialog(true)}><Play/> فتح الوردية</Button>}</div>
    {open?<Card className="border-primary/30"><CardContent className="p-5"><div className="flex flex-wrap items-center gap-3"><div className="rounded-2xl bg-primary/10 p-3"><Banknote className="size-7 text-primary"/></div><div className="flex-1"><b>وردية مفتوحة</b><p className="text-xs text-muted-foreground">{formatDateTime(open.openedAt)} · رصيد البداية {formatEGP(open.openingFloat)} ج.م</p></div><Button variant="destructive" className="h-12" onClick={()=>setCloseDialog(open)}><Square/> قفل الوردية</Button></div><div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-xl bg-muted p-3"><small>نقدي</small><b className="block">{formatEGP(open.cashSales)}</b></div><div className="rounded-xl bg-muted p-3"><small>بطاقة</small><b className="block">{formatEGP(open.cardSales)}</b></div><div className="rounded-xl bg-muted p-3"><small>تحويل</small><b className="block">{formatEGP(open.transferSales)}</b></div></div></CardContent></Card>:<Card><CardContent className="p-8 text-center"><LockKeyhole className="mx-auto size-10 text-primary"/><h3 className="mt-3 text-xl font-black">لا توجد وردية مفتوحة</h3><p className="mt-1 text-sm text-muted-foreground">افتح الوردية بكلمة مرورك قبل البيع.</p><Button className="mt-4 h-12" onClick={()=>setOpenDialog(true)}>فتح الوردية</Button></CardContent></Card>}

    <Card><CardHeader><CardTitle>سجل الورديات</CardTitle></CardHeader><CardContent>{isLoading?'جاري التحميل...':sessions.map(s=><div key={s.id} className="flex flex-wrap items-center gap-3 border-b py-3"><div className="flex-1"><b>{s.user.name}</b><div className="text-xs text-muted-foreground">{formatDateTime(s.openedAt)}</div></div><Badge>{s.status==='open'?'مفتوحة':'مغلقة'}</Badge>{s.status==='closed'&&<div className="text-sm">الفرق: <b>{formatEGP(s.difference||0)}</b></div>}</div>)}</CardContent></Card>

    <Dialog open={openDialog} onOpenChange={v=>!openMutation.isPending&&setOpenDialog(v)}><DialogContent><DialogHeader><DialogTitle>فتح الوردية</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>رصيد البداية</Label><Input type="number" min={0} value={openingFloat} onChange={e=>setOpeningFloat(Number(e.target.value)||0)}/></div><div><Label>كلمة المرور</Label><Input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus/></div><div><Label>ملاحظات</Label><Input value={notes} onChange={e=>setNotes(e.target.value)}/></div></div><DialogFooter><Button variant="outline" onClick={()=>setOpenDialog(false)} disabled={openMutation.isPending}>إلغاء</Button><Button onClick={()=>openMutation.mutate()} disabled={openMutation.isPending||!password}>{openMutation.isPending?'جارٍ الفتح...':'فتح الوردية'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={!!closeDialog} onOpenChange={v=>!closeMutation.isPending&&!v&&setCloseDialog(null)}><DialogContent><DialogHeader><DialogTitle>قفل الوردية</DialogTitle></DialogHeader><div className="space-y-3"><div className="rounded-xl bg-muted p-3 text-sm">سيحسب النظام إجمالي المبيعات النقدية والبطاقات والتحويلات والمرتجعات ويقارن النقد الفعلي.</div><div><Label>النقد الفعلي في الدرج</Label><Input type="number" min={0} value={closingFloat} onChange={e=>setClosingFloat(Number(e.target.value)||0)}/></div><div><Label>كلمة المرور</Label><Input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus/></div><div><Label>ملاحظات</Label><Input value={notes} onChange={e=>setNotes(e.target.value)}/></div></div><DialogFooter><Button variant="outline" onClick={()=>setCloseDialog(null)} disabled={closeMutation.isPending}>إلغاء</Button><Button variant="destructive" onClick={()=>closeMutation.mutate()} disabled={closeMutation.isPending||!password}>{closeMutation.isPending?'جارٍ الإغلاق...':'تأكيد الإغلاق'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={!!report} onOpenChange={v=>!v&&setReport(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>تقرير الوردية جاهز</DialogTitle></DialogHeader>{report&&<div id="shift-report" className="space-y-2 rounded-2xl border bg-background p-4 text-sm"><div className="text-center text-xl font-black">تقرير وردية — طيبة</div><div className="grid grid-cols-2 gap-2">{[['الفواتير',report.invoiceCount],['إجمالي المبيعات',formatEGP(report.totalSales)+' ج.م'],['نقدي',formatEGP(report.cashSales)+' ج.م'],['بطاقة',formatEGP(report.cardSales)+' ج.م'],['تحويل',formatEGP(report.transferSales)+' ج.م'],['آجل',formatEGP(report.creditSales)+' ج.م'],['تحصيل نقدي',formatEGP(report.customerCash)+' ج.م'],['مرتجعات نقدية',formatEGP(report.cashRefunds)+' ج.م'],['بداية',formatEGP(report.openingFloat)+' ج.م'],['المتوقع',formatEGP(report.expectedCash)+' ج.م'],['الفعلي',formatEGP(report.closingFloat)+' ج.م'],['الفرق',formatEGP(report.difference)+' ج.م']].map(([k,v])=><div key={String(k)} className="rounded-xl bg-muted p-3"><small>{k}</small><b className="block">{v}</b></div>)}</div></div>}<div className="grid grid-cols-2 gap-2"><Button onClick={()=>window.print()}><Printer/> طباعة</Button><Button variant="outline" onClick={()=>{if(!report)return;const text=`تقرير وردية طيبة\\nالفواتير: ${report.invoiceCount}\\nالمبيعات: ${formatEGP(report.totalSales)} ج.م\\nنقدي: ${formatEGP(report.cashSales)}\\nبطاقة: ${formatEGP(report.cardSales)}\\nتحويل: ${formatEGP(report.transferSales)}\\nالفرق: ${formatEGP(report.difference)} ج.م`;const url=`https://wa.me/?text=${encodeURIComponent(text)}`;window.open(url,'_blank')}}><Share2/> واتساب</Button></div><Button className="w-full" onClick={()=>setReport(null)}><CheckCircle2/> تم</Button></DialogContent></Dialog>
  </div>
}
