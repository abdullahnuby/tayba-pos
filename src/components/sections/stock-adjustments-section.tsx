'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Search, ClipboardCheck, Package, Plus, Minus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

interface Variant { id:string; sku:string; size:string|null; color:string|null; quantity:number; product?:{name:string} }
interface Product { id:string; name:string; variants:Variant[] }

export function StockAdjustmentsSection() {
  const qc=useQueryClient()
  const [mode,setMode]=useState<'stocktake'|'opening'>('stocktake')
  const [search,setSearch]=useState('')
  const [actual,setActual]=useState<Record<string,string>>({})
  const [reason,setReason]=useState('')
  const {data,isLoading}=useQuery<{items:Product[]}>({queryKey:['products-stocktake'],queryFn:async()=>{const r=await fetch('/api/products?pageSize=1000');if(!r.ok)throw new Error('products');return r.json()}})
  const products=data?.items||[]
  const variants=useMemo(()=>products.flatMap(p=>p.variants.map(v=>({...v,productName:p.name}))),[products])
  const rows=useMemo(()=>{const q=search.trim().toLowerCase();return variants.filter(v=>!q||v.productName.toLowerCase().includes(q)||v.sku.toLowerCase().includes(q)||(v.size||'').toLowerCase().includes(q)||(v.color||'').toLowerCase().includes(q))},[variants,search])
  const changed=variants.filter(v=>actual[v.id]!==undefined&&actual[v.id]!==''&&Number(actual[v.id])!==v.quantity)
  const increase=changed.reduce((s,v)=>s+Math.max(0,Number(actual[v.id])-v.quantity),0)
  const decrease=changed.reduce((s,v)=>s+Math.max(0,v.quantity-Number(actual[v.id])),0)
  const mutation=useMutation({
    mutationFn:async()=>{const items=changed.map(v=>({variantId:v.id,quantityChange:Math.floor(Number(actual[v.id]))-v.quantity,reason:reason.trim()||(mode==='opening'?'رصيد افتتاحي':'جرد مخزون'),type:mode==='opening'?'adjustment':'stocktake'}));const r=await fetch('/api/stock-adjustments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bulk:true,mode,items})});const j=await r.json();if(!r.ok)throw new Error(j.error||'فشل اعتماد الجرد');return j},
    onSuccess:(j)=>{qc.invalidateQueries({queryKey:['products-stocktake']});qc.invalidateQueries({queryKey:['products']});toast.success(`تم اعتماد ${j.applied} صنف`);setActual({})},
    onError:(e:Error)=>toast.error(e.message),
  })
  function fill(){const next:Record<string,string>={};for(const v of variants)next[v.id]=String(v.quantity);setActual(next);toast.success('تم تعبئة الرصيد الدفتري — عدّل الفروقات فقط')}
  function clear(){setActual({})}
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><div><h2 className="text-2xl font-black">الجرد والمخزون</h2><p className="text-sm text-muted-foreground">جرد كل الأصناف في كشف واحد بدل تعديل كل صنف منفردًا.</p></div><div className="ms-auto flex gap-2"><Button variant={mode==='stocktake'?'default':'outline'} onClick={()=>setMode('stocktake')}><ClipboardCheck/> جرد جديد</Button><Button variant={mode==='opening'?'default':'outline'} onClick={()=>setMode('opening')}>رصيد افتتاحي</Button></div></div>
    <Card><CardContent className="p-3"><div className="flex flex-wrap gap-2"><div className="relative min-w-[240px] flex-1"><Search className="absolute right-3 top-3 size-5 text-muted-foreground"/><Input className="h-12 pr-10" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث باسم الصنف أو SKU أو المقاس أو اللون"/></div><Button variant="outline" className="h-12" onClick={fill} disabled={!variants.length||isLoading}>تعبئة الدفتري</Button><Button variant="ghost" className="h-12" onClick={clear} disabled={!Object.keys(actual).length}><RotateCcw/> مسح</Button></div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-xl border p-3"><small>الأصناف</small><b className="block text-xl">{variants.length}</b></div><div className="rounded-xl border p-3"><small>زيادات</small><b className="block text-xl">+{increase}</b></div><div className="rounded-xl border p-3"><small>نواقص</small><b className="block text-xl">{decrease}</b></div></div></CardContent></Card>
    <Card className="overflow-hidden"><div className="overflow-auto"><div className="min-w-[900px]"><div className="grid grid-cols-[2.5fr_1.3fr_1fr_1.2fr_1fr] border-b bg-muted/40 p-3 text-xs font-black"><div>الصنف</div><div>SKU / المقاس / اللون</div><div>الدفتري</div><div>الفعلي</div><div>الفرق</div></div><div className="max-h-[62dvh] overflow-y-auto">{isLoading?<div className="p-8 text-center">جاري تحميل الأصناف...</div>:rows.map(v=>{const raw=actual[v.id]??'';const n=raw===''?null:Math.max(0,Math.floor(Number(raw)));const diff=n===null?null:n-v.quantity;return <div key={v.id} className="grid min-h-[72px] grid-cols-[2.5fr_1.3fr_1fr_1.2fr_1fr] items-center border-b p-3"><div className="font-bold">{v.productName}</div><div className="text-xs text-muted-foreground">{v.sku}<br/>{v.size||'عام'} · {v.color||'عام'}</div><div className="font-black">{v.quantity}</div><div><Input type="number" min={0} value={raw} onChange={e=>setActual(x=>({...x,[v.id]:e.target.value.replace(/[^0-9]/g,'')}))} className="h-11 text-center font-black" placeholder={String(v.quantity)}/></div><div>{diff===null?<Badge variant="outline">لم يُجرد</Badge>:diff===0?<Badge variant="secondary">مطابق</Badge>:<Badge variant={diff>0?'default':'destructive'}>{diff>0?`+${diff}`:diff}</Badge>}</div></div>})}</div></div></div></Card>
    <Card><CardContent className="p-3"><div className="grid gap-3 md:grid-cols-[1fr_260px]"><div><Label>سبب العملية</Label><Input className="mt-1 h-11" value={reason} onChange={e=>setReason(e.target.value)} placeholder={mode==='opening'?'رصيد افتتاحي للبضاعة الموجودة فعليًا':'جرد فعلي دوري'}/></div><Button className="h-11 md:self-end" disabled={!changed.length||mutation.isPending} onClick={()=>mutation.mutate()}>{mutation.isPending?'جارٍ الاعتماد...':`اعتماد الجرد (${changed.length})`}</Button></div></CardContent></Card>
  </div>
}
