'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, Pencil, Plus, Search, Trash2, User } from 'lucide-react'
import { toast } from 'sonner'
import { formatEGP } from '@/lib/format'

interface Customer { id:string; name:string; phone?:string|null; address?:string|null; notes?:string|null; balance:number; loyaltyPoints:number; _count?:{sales:number}; totalPurchases?:number }

export function CustomersSection(){
  const qc=useQueryClient()
  const [search,setSearch]=useState('')
  const [open,setOpen]=useState(false)
  const [editing,setEditing]=useState<Customer|null>(null)
  const [form,setForm]=useState({name:'',phone:'',address:'',notes:''})
  const {data=[],isLoading}=useQuery<Customer[]>({queryKey:['customers'],queryFn:async()=>{const r=await fetch('/api/customers');if(!r.ok)throw new Error('تعذر تحميل العملاء');return r.json()}})
  const save=useMutation({mutationFn:async()=>{const url=editing?`/api/customers/${editing.id}`:'/api/customers';const r=await fetch(url,{method:editing?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});const j=await r.json();if(!r.ok)throw new Error(j.error||'فشل الحفظ');return j},onSuccess:()=>{qc.invalidateQueries({queryKey:['customers']});setOpen(false);toast.success('تم الحفظ')},onError:(e:Error)=>toast.error(e.message)})
  const del=useMutation({mutationFn:async(id:string)=>{const r=await fetch(`/api/customers/${id}`,{method:'DELETE'});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'فشل الحذف')},onSuccess:()=>{qc.invalidateQueries({queryKey:['customers']});toast.success('تم حذف العميل')},onError:(e:Error)=>toast.error(e.message)})
  const filtered=data.filter(c=>!search||c.name.includes(search)||(c.phone||'').includes(search))
  function start(c?:Customer){setEditing(c||null);setForm(c?{name:c.name,phone:c.phone||'',address:c.address||'',notes:c.notes||''}:{name:'',phone:'',address:'',notes:''});setOpen(true)}
  return <div className="space-y-5"><div className="flex flex-wrap items-center gap-3"><div><h2 className="text-2xl font-black">العملاء</h2><p className="text-sm text-muted-foreground">إدارة العملاء بدون إنشاء سجلات مكررة عند بطء الشبكة.</p></div><Button className="ms-auto h-12" onClick={()=>start()}><Plus/> عميل جديد</Button></div><div className="relative"><Search className="absolute right-3 top-3 size-5 text-muted-foreground"/><Input className="h-12 pr-10" value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث بالاسم أو الهاتف"/></div>{isLoading?<Card><CardContent className="p-8">جاري التحميل...</CardContent></Card>:<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(c=><Card key={c.id}><CardContent className="p-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-primary/10 p-2"><User className="size-5 text-primary"/></div><div className="min-w-0 flex-1"><b className="block truncate">{c.name}</b><span className="text-xs text-muted-foreground">{c.phone||'بدون هاتف'}</span></div>{c.balance>0&&<Badge variant="destructive">{formatEGP(c.balance)} ج.م</Badge>}</div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-muted p-2">فواتير <b>{c._count?.sales||0}</b></div><div className="rounded-xl bg-muted p-2">مشتريات <b>{formatEGP(c.totalPurchases||0)}</b></div></div><div className="mt-3 flex gap-2"><Button variant="outline" className="flex-1" onClick={()=>start(c)}><Pencil/> تعديل</Button><Button variant="ghost" className="text-destructive" disabled={del.isPending||c.balance>0} onClick={()=>{if(confirm(`حذف ${c.name}؟`))del.mutate(c.id)}}><Trash2/></Button></div>{c.balance>0&&<div className="mt-2 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="size-3"/> لا يمكن حذف عميل عليه رصيد</div>}</CardContent></Card>)}</div>}

  <Dialog open={open} onOpenChange={v=>!save.isPending&&setOpen(v)}><DialogContent><DialogHeader><DialogTitle>{editing?'تعديل العميل':'إضافة عميل'}</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>الاسم *</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div><div><Label>الهاتف</Label><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} dir="ltr"/></div><div><Label>العنوان</Label><Input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></div><div><Label>ملاحظات</Label><Input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div></div><DialogFooter><Button variant="outline" onClick={()=>setOpen(false)} disabled={save.isPending}>إلغاء</Button><Button onClick={()=>save.mutate()} disabled={save.isPending||!form.name.trim()}>{save.isPending?'جارٍ الحفظ...':'حفظ'}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
