'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Banknote, Barcode, CheckCircle2, Eye, History, Printer, ReceiptText, Search, Share2, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime, formatEGP, saleStatusBadgeVariant, saleStatusLabel } from '@/lib/format'
import { useAppStore } from '@/lib/store'

type Role = 'admin' | 'manager' | 'cashier'
interface SessionUser { id: string; username: string; name: string; role: Role }
interface Variant { id:string; sku:string; barcode:string|null; size:string|null; color:string|null; sellPrice:number; quantity:number; product:{id:string;name:string}; saleUnit?:string|null; saleUnitFactor?:number|null }
interface Product { id:string; name:string; category?:{id:string;name:string}|null; variants:Variant[] }
interface Customer { id:string; name:string; phone?:string|null }
interface CartItem { variantId:string; name:string; sku:string; size:string|null; color:string|null; price:number; quantity:number; max:number }
interface Sale { id:string; invoiceNo:string; date:string; total:number; paid:number; change:number; paymentMethod:string; status:string; customer?:{name:string}|null; items:Array<{id:string;quantity:number;total:number;variant:{product:{name:string};sku:string;size:string|null;color:string|null}}> }

function money(v:number){return `${formatEGP(v)} ج.م`}

export function SalesSection({ user }: { user: SessionUser }) {
  const qc=useQueryClient()
  const setSection=useAppStore(s=>s.setSection)
  const [search,setSearch]=useState('')
  const [category,setCategory]=useState('all')
  const [cart,setCart]=useState<CartItem[]>([])
  const [customerId,setCustomerId]=useState('')
  const [customerDialog,setCustomerDialog]=useState(false)
  const [customerForm,setCustomerForm]=useState({name:'',phone:''})
  const [paymentMethod,setPaymentMethod]=useState<'cash'|'card'|'transfer'|'credit'>('cash')
  const [paid,setPaid]=useState(0)
  const [discount,setDiscount]=useState(0)
  const [checkout,setCheckout]=useState(false)
  const [historical,setHistorical]=useState(false)
  const [saleDate,setSaleDate]=useState(new Date().toISOString().slice(0,10))
  const [historyOpen,setHistoryOpen]=useState(false)
  const [viewing,setViewing]=useState<Sale|null>(null)
  const [printing,setPrinting]=useState<Sale|null>(null)

  const {data:shiftData,isLoading:shiftLoading}=useQuery<{items:Array<{id:string;status:string;openingFloat:number}>}>({
    queryKey:['register-sessions'],
    queryFn:async()=>{const r=await fetch('/api/register-sessions'); if(!r.ok) throw new Error('register'); return r.json()},
    refetchInterval:30000,
  })
  const openShift=shiftData?.items?.find(x=>x.status==='open')

  const productsQuery=useQuery<{items:Product[]}>({queryKey:['pos-products'],queryFn:async()=>{const r=await fetch('/api/products?pageSize=500');if(!r.ok)throw new Error('products');return r.json()},staleTime:30000})
  const customersQuery=useQuery<Customer[]>({queryKey:['customers'],queryFn:async()=>{const r=await fetch('/api/customers');if(!r.ok)throw new Error('customers');return r.json()},staleTime:30000})
  const salesQuery=useQuery<{items:Sale[]}>({queryKey:['sales'],queryFn:async()=>{const r=await fetch('/api/sales?pageSize=100');if(!r.ok)throw new Error('sales');return r.json()}})

  const products=productsQuery.data?.items||[]
  const customers=customersQuery.data||[]
  const sales=salesQuery.data?.items||[]
  const categories=useMemo(()=>[{id:'all',name:'الكل'},...Array.from(new Map(products.map(p=>[p.category?.id||'none',p.category?.name||'بدون تصنيف'])).entries()).map(([id,name])=>({id,name}))],[products])
  const visible=useMemo(()=>{const q=search.trim().toLowerCase();return products.filter(p=>(category==='all'||(p.category?.id||'none')===category)&&(!q||p.name.toLowerCase().includes(q)||p.variants.some(v=>v.sku.toLowerCase().includes(q)||(v.barcode||'').includes(q)))).slice(0,100)},[products,search,category])
  const selectedCustomer=customers.find(c=>c.id===customerId)
  const subtotal=cart.reduce((s,i)=>s+i.price*i.quantity,0)
  const total=Math.max(0,subtotal-discount)
  const change=Math.max(0,paid-total)

  const saveCustomer=useMutation({
    mutationFn:async(data:{name:string;phone:string})=>{const r=await fetch('/api/customers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw new Error(j.error||'تعذر إضافة العميل');return j},
    onSuccess:(c:Customer)=>{qc.invalidateQueries({queryKey:['customers']});setCustomerId(c.id);setCustomerDialog(false);setCustomerForm({name:'',phone:''});toast.success('تم إضافة العميل')},
    onError:(e:Error)=>toast.error(e.message),
  })
  const saveSale=useMutation({
    mutationFn:async(payload:Record<string,unknown>)=>{const r=await fetch('/api/sales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const j=await r.json();if(!r.ok)throw new Error(j.error||'تعذر حفظ الفاتورة');return j as Sale},
    onSuccess:(sale:Sale)=>{qc.invalidateQueries({queryKey:['sales']});qc.invalidateQueries({queryKey:['pos-products']});qc.invalidateQueries({queryKey:['register-sessions']});setCheckout(false);setPrinting(sale);resetSale();toast.success(`تمت الفاتورة ${sale.invoiceNo}`)},
    onError:(e:Error)=>toast.error(e.message),
  })

  function resetSale(){setCart([]);setCustomerId('');setPaymentMethod('cash');setPaid(0);setDiscount(0);setHistorical(false);setSaleDate(new Date().toISOString().slice(0,10));setSearch('')}
  function add(v:Variant){
    if(v.quantity<=0)return toast.error('الصنف غير متوفر')
    setCart(prev=>{const found=prev.find(i=>i.variantId===v.id);if(found){if(found.quantity>=found.max)return prev;return prev.map(i=>i.variantId===v.id?{...i,quantity:i.quantity+1}:i)}return [...prev,{variantId:v.id,name:v.product.name,sku:v.sku,size:v.size,color:v.color,price:v.sellPrice,quantity:1,max:v.quantity}]})
  }
  function submit(){
    if(!cart.length)return toast.error('أضف صنفًا أولًا')
    if(discount>subtotal)return toast.error('الخصم أكبر من الإجمالي')
    if(paymentMethod==='credit'&&!customerId)return toast.error('اختر العميل للبيع الآجل')
    if(paymentMethod!=='credit'&&paid<total)return toast.error('المبلغ المدفوع غير مكتمل')
    const payload={customerId:customerId||undefined,date:(historical&&user.role!=='cashier')?saleDate:undefined,discount,paid:paymentMethod==='credit'?0:paid,paymentMethod,status:'completed',items:cart.map(i=>({variantId:i.variantId,quantity:i.quantity,unitPrice:i.price})),idempotencyKey:`${user.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`}
    saveSale.mutate(payload)
  }
  function shareReceipt(s:Sale){
    const text=`طيبة\\nفاتورة ${s.invoiceNo}\\nالتاريخ: ${formatDateTime(s.date)}\\nالإجمالي: ${money(s.total)}`
    if(navigator.share){void navigator.share({title:`فاتورة ${s.invoiceNo}`,text}).catch(()=>{})}else{void navigator.clipboard?.writeText(text);toast.success('تم نسخ ملخص الفاتورة')}
  }

  if(user.role==='cashier' && shiftLoading)return <div className="p-6"><Skeleton className="h-40 w-full rounded-3xl"/></div>
  if(user.role==='cashier' && !openShift)return <Card className="mx-auto mt-8 max-w-xl p-8 text-center"><Banknote className="mx-auto size-12 text-primary"/><h2 className="mt-4 text-2xl font-black">الوردية غير مفتوحة</h2><p className="mt-2 text-muted-foreground">لا يمكن للكاشير إصدار فواتير قبل فتح الوردية.</p><Button className="mt-5 h-12" onClick={()=>setSection('register')}>فتح الوردية</Button></Card>

  return <div className="min-h-[calc(100dvh-1rem)] bg-muted/10 lg:rounded-3xl lg:border overflow-hidden">
    <div className="sticky top-0 z-20 border-b bg-background/95 p-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2"><ReceiptText className="size-5 text-primary"/><b className="text-lg">نقطة البيع</b>{openShift&&<Badge>وردية مفتوحة</Badge>}</div>
        <div className="ms-auto flex gap-2"><Button variant="outline" className="h-11" onClick={()=>setHistoryOpen(true)}><History className="size-4"/> الفواتير</Button>{user.role !== 'cashier' && <Button variant="outline" className="h-11" onClick={()=>setHistorical(v=>!v)}>{historical?'بيع عادي':'مبيعات سابقة'}</Button>}</div>
      </div>
      {historical&&<div className="mt-3 flex flex-wrap items-end gap-3 rounded-2xl border bg-muted/30 p-3"><div><Label>تاريخ الفاتورة الورقية</Label><Input type="date" value={saleDate} max={new Date().toISOString().slice(0,10)} onChange={e=>setSaleDate(e.target.value)} className="mt-1 h-11"/></div><p className="text-xs text-muted-foreground">استخدم هذا الوضع لإدخال فواتير الورق بتاريخها الحقيقي. لا ننشئ فاتورة شراء وهمية.</p></div>}
    </div>

    <div className="grid min-h-[calc(100dvh-7rem)] lg:grid-cols-[1fr_430px]">
      <section className="min-h-0 overflow-y-auto p-3 sm:p-5">
        <div className="flex gap-2"><div className="relative flex-1"><Search className="absolute right-3 top-3 size-5 text-muted-foreground"/><Input className="h-12 pr-10" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث بالاسم أو SKU أو الباركود..."/></div><Button className="h-12 w-12" size="icon" onClick={()=>{const code=prompt('أدخل الباركود');if(code){const v=products.flatMap(p=>p.variants).find(x=>x.barcode===code||x.sku===code);if(v)add(v);else toast.error('الباركود غير موجود')}}}><Barcode className="size-5"/></Button></div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{categories.map(c=><Button key={c.id} variant={category===c.id?'default':'outline'} className="shrink-0" onClick={()=>setCategory(c.id)}>{c.name}</Button>)}</div>
        {productsQuery.isLoading?<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({length:9}).map((_,i)=><Skeleton key={i} className="h-32 rounded-2xl"/>)}</div>:<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{visible.map(p=>{const stock=p.variants.reduce((s,v)=>s+v.quantity,0);return <Card key={p.id} className="p-3"><div className="line-clamp-2 min-h-10 font-bold">{p.name}</div><div className="mt-2 text-xs text-muted-foreground">{p.variants.length} خيار · مخزون {stock}</div><Button className="mt-3 h-10 w-full" disabled={!stock} onClick={()=>{const available=p.variants.filter(v=>v.quantity>0);if(available.length===1)add(available[0]);else{const choice=prompt(available.map((v,i)=>`${i+1}) ${v.size||'عام'} ${v.color||''} — ${money(v.sellPrice)} — ${v.quantity}`).join('\\n'));const v=available[Number(choice)-1];if(v)add(v)}}}>إضافة</Button></Card>})}</div>}
      </section>

      <aside className="flex min-h-0 flex-col border-t bg-background lg:border-t-0 lg:border-r">
        <div className="flex items-center gap-2 border-b p-3"><Button variant="ghost" size="icon" disabled={!cart.length||saveSale.isPending} onClick={()=>setCart([])}><Trash2/></Button><div className="flex-1 font-black">السلة ({cart.length})</div><Button variant="outline" size="sm" onClick={()=>setCustomerDialog(true)}><UserPlus className="size-4"/> عميل</Button></div>
        <div className="border-b p-3"><select className="h-11 w-full rounded-xl border bg-background px-3" value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">عميل نقدي</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?` — ${c.phone}`:''}</option>)}</select></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{!cart.length?<div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">السلة فارغة</div>:<div className="space-y-2">{cart.map((i,n)=><div key={i.variantId} className="rounded-2xl border p-3"><div className="flex justify-between gap-2"><div><b>{i.name}</b><div className="text-xs text-muted-foreground">{i.size||'عام'} {i.color?`· ${i.color}`:''}</div></div><b>{money(i.price*i.quantity)}</b></div><div className="mt-2 flex items-center gap-2"><Button variant="outline" size="sm" onClick={()=>setCart(c=>c.map((x,k)=>k===n?{...x,quantity:Math.max(1,x.quantity-1)}:x))}>−</Button><b>{i.quantity}</b><Button variant="outline" size="sm" onClick={()=>setCart(c=>c.map((x,k)=>k===n?{...x,quantity:Math.min(x.max,x.quantity+1)}:x))}>+</Button><Button variant="ghost" className="ms-auto text-destructive" onClick={()=>setCart(c=>c.filter((_,k)=>k!==n))}>حذف</Button></div></div>)}</div>}</div>
        <div className="border-t p-3"><div className="grid grid-cols-2 gap-2"><div><Label>الخصم</Label><Input type="number" min={0} value={discount} onChange={e=>setDiscount(Math.max(0,Number(e.target.value)||0))} className="mt-1 h-11"/></div><div className="rounded-xl bg-primary p-3 text-primary-foreground"><div className="text-xs">الإجمالي</div><b className="text-xl">{money(total)}</b></div></div><Button className="mt-3 h-13 w-full text-base font-black" disabled={!cart.length||saveSale.isPending} onClick={()=>{setPaid(total);setCheckout(true)}}>{saveSale.isPending?'جارٍ الحفظ...':'إنهاء الفاتورة'}</Button></div>
      </aside>
    </div>

    <Dialog open={checkout} onOpenChange={v=>!saveSale.isPending&&setCheckout(v)}><DialogContent><DialogHeader><DialogTitle>تأكيد البيع — {money(total)}</DialogTitle></DialogHeader><div className="grid grid-cols-4 gap-2">{([['cash','نقدي'],['card','بطاقة'],['transfer','تحويل'],['credit','آجل']] as const).map(([m,l])=><Button key={m} variant={paymentMethod===m?'default':'outline'} className="h-14" onClick={()=>{setPaymentMethod(m);if(m!=='credit')setPaid(total);else setPaid(0)}}>{l}</Button>)}</div>{paymentMethod!=='credit'&&<div><Label>المبلغ المستلم</Label><Input type="number" min={0} value={paid} onChange={e=>setPaid(Math.max(0,Number(e.target.value)||0))} className="mt-1 h-12"/></div>}{paymentMethod!=='credit'&&<div className="rounded-xl bg-muted p-3">الباقي: <b>{money(change)}</b></div>}<Button className="h-13 w-full font-black" disabled={saveSale.isPending} onClick={submit}>{saveSale.isPending?'جارٍ الحفظ...':'تأكيد البيع'}</Button></DialogContent></Dialog>

    <Dialog open={customerDialog} onOpenChange={v=>!saveCustomer.isPending&&setCustomerDialog(v)}><DialogContent><DialogHeader><DialogTitle>إضافة عميل سريع</DialogTitle></DialogHeader><div className="space-y-3"><div><Label>الاسم *</Label><Input value={customerForm.name} onChange={e=>setCustomerForm({...customerForm,name:e.target.value})}/></div><div><Label>الهاتف</Label><Input value={customerForm.phone} onChange={e=>setCustomerForm({...customerForm,phone:e.target.value})} dir="ltr"/></div></div><DialogFooter><Button variant="outline" onClick={()=>setCustomerDialog(false)} disabled={saveCustomer.isPending}>إلغاء</Button><Button onClick={()=>saveCustomer.mutate(customerForm)} disabled={saveCustomer.isPending||!customerForm.name.trim()}>{saveCustomer.isPending?'جارٍ الحفظ...':'حفظ العميل'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={!!printing} onOpenChange={v=>!v&&setPrinting(null)}><DialogContent><DialogHeader><DialogTitle>الفاتورة تمت بنجاح</DialogTitle></DialogHeader>{printing&&<div id="printable-invoice" className="rounded-xl border bg-white p-4 text-black"><div className="text-center text-xl font-black">طيبة</div><div className="mt-2 text-sm">فاتورة: {printing.invoiceNo}</div><div className="text-sm">التاريخ: {formatDateTime(printing.date)}</div>{printing.items.map(i=><div key={i.id} className="flex justify-between border-b py-2 text-sm"><span>{i.variant.product.name} × {i.quantity}</span><b>{money(i.total)}</b></div>)}<div className="mt-3 flex justify-between font-black"><span>الإجمالي</span><span>{money(printing.total)}</span></div></div>}<div className="grid grid-cols-2 gap-2"><Button onClick={()=>window.print()}><Printer/> طباعة</Button><Button variant="outline" onClick={()=>printing&&shareReceipt(printing)}><Share2/> مشاركة</Button></div><Button className="w-full" onClick={()=>setPrinting(null)}><CheckCircle2/> فاتورة جديدة</Button></DialogContent></Dialog>

    <Dialog open={historyOpen} onOpenChange={setHistoryOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>سجل الفواتير</DialogTitle></DialogHeader>{salesQuery.isLoading?<Skeleton className="h-24"/>:<div className="space-y-2">{sales.map(s=><div key={s.id} className="rounded-xl border p-3"><div className="flex justify-between"><b>{s.invoiceNo}</b><Badge variant={saleStatusBadgeVariant(s.status)}>{saleStatusLabel(s.status)}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{formatDateTime(s.date)} · {s.customer?.name||'عميل نقدي'}</div><div className="mt-2 flex justify-between"><b>{money(s.total)}</b><Button size="sm" variant="outline" onClick={()=>setViewing(s)}><Eye/> عرض</Button></div></div>)}</div>}</DialogContent></Dialog>
    <Dialog open={!!viewing} onOpenChange={v=>!v&&setViewing(null)}><DialogContent><DialogHeader><DialogTitle>الفاتورة {viewing?.invoiceNo}</DialogTitle></DialogHeader>{viewing&&<div className="space-y-2">{viewing.items.map(i=><div key={i.id} className="flex justify-between rounded-xl border p-3"><span>{i.variant.product.name} × {i.quantity}</span><b>{money(i.total)}</b></div>)}<div className="rounded-xl bg-muted p-3 flex justify-between"><span>الإجمالي</span><b>{money(viewing.total)}</b></div></div>}</DialogContent></Dialog>
  </div>
}
