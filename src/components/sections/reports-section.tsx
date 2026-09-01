'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { BarChart3, RefreshCw } from 'lucide-react'
import { formatEGP, todayISO, daysAgoISO } from '@/lib/format'
import { toast } from 'sonner'

interface Report { from:string;to:string;salesCount:number;purchasesCount:number;returnsCount:number;totalSales:number;netSales:number;totalReturns:number;totalPurchases:number;totalProfit:number;cogs:number;profitMargin:number;bestSelling:Array<{id:string;name:string;qty:number;revenue:number;profit:number}>;salesByMethod:Array<{name:string;value:number}> }

export function ReportsSection(){
  const [from,setFrom]=useState(daysAgoISO(30)); const [to,setTo]=useState(todayISO()); const [applied,setApplied]=useState({from:daysAgoISO(30),to:todayISO()})
  const q=useQuery<Report>({queryKey:['reports',applied],queryFn:async()=>{const r=await fetch(`/api/reports?from=${applied.from}&to=${applied.to}`);const j=await r.json();if(!r.ok)throw new Error(j.error||'فشل تحميل التقرير');return j}})
  function apply(){if(!from||!to)return toast.error('اختر الفترة');if(from>to)return toast.error('من تاريخ يجب أن يسبق إلى تاريخ');setApplied({from,to})}
  return <div className="space-y-5"><div><h2 className="text-2xl font-black">التقارير</h2><p className="text-sm text-muted-foreground">تقارير الإدارة فقط — الكاشير لا يرى هذه الصفحة.</p></div><Card><CardContent className="flex flex-wrap items-end gap-2 p-4"><div><label className="text-xs">من</label><Input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="mt-1 h-11"/></div><div><label className="text-xs">إلى</label><Input type="date" value={to} onChange={e=>setTo(e.target.value)} className="mt-1 h-11"/></div><Button className="h-11" onClick={apply} disabled={q.isFetching}><RefreshCw className={q.isFetching?'animate-spin':''}/> تطبيق</Button><Button variant="outline" className="h-11" onClick={()=>{const f=daysAgoISO(7);const t=todayISO();setFrom(f);setTo(t);setApplied({from:f,to:t})}}>7 أيام</Button></CardContent></Card>
    {q.isLoading?<Card><CardContent className="p-8">جاري تحميل التقرير...</CardContent></Card>:q.isError?<Card><CardContent className="p-8 text-center text-destructive">تعذر تحميل التقرير — {q.error instanceof Error?q.error.message:'خطأ'}</CardContent></Card>:q.data&&<><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['صافي المبيعات',money(q.data.netSales)],['المشتريات',money(q.data.totalPurchases)],['صافي الربح',money(q.data.totalProfit)],['هامش الربح',`${q.data.profitMargin}%`]].map(([k,v])=><Card key={String(k)}><CardContent className="p-4"><small>{k}</small><div className="mt-1 text-xl font-black">{v}</div></CardContent></Card>)}</div><Card><CardContent className="p-4"><h3 className="font-black">ملخص</h3><div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4"><Badge variant="outline">فواتير: {q.data.salesCount}</Badge><Badge variant="outline">مرتجعات: {q.data.returnsCount}</Badge><Badge variant="outline">تكلفة: {money(q.data.cogs)}</Badge><Badge variant="outline">صافي: {money(q.data.netSales)}</Badge></div><div className="mt-5 space-y-2">{q.data.bestSelling.map((p,i)=><div key={p.id} className="flex items-center gap-3 rounded-xl border p-3"><span className="size-7 rounded-full bg-primary/10 text-center leading-7 font-black">{i+1}</span><div className="flex-1"><b>{p.name}</b><div className="text-xs text-muted-foreground">{p.qty} قطعة · إيراد {money(p.revenue)} · ربح {money(p.profit)}</div></div></div>)}</div></CardContent></Card></>}
  </div>
}
function money(v:number){return `${formatEGP(v)} ج.م`}
