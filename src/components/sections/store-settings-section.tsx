'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Store, Save } from 'lucide-react'
import { toast } from 'sonner'

interface StoreSettings {
  storeName: string
  storeAddress: string
  storePhone: string
  storeTaxNumber: string
  storeLogo: string
  receiptFooter: string
  vatEnabled: string
  vatRate: string
  vatInclusive: string
  saleInvoicePrefix: string
  purchaseInvoicePrefix: string
  returnPrefix: string
  currency: string
  loyaltyEnabled: string
  loyaltyRate: string
  [key: string]: string
}

export function StoreSettingsSection() {
  const qc = useQueryClient()
  const { data, isLoading, isError, refetch } = useQuery<StoreSettings>({
    queryKey: ['store-settings'],
    queryFn: async () => { const response = await fetch('/api/store-settings'); if (!response.ok) throw new Error('تعذر تحميل إعدادات المحل'); return response.json() },
  })

  const [form, setForm] = useState<Partial<StoreSettings>>({})

  const [adminPassword, setAdminPassword] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const managerPinStatus = useQuery<{ configured: boolean }>({
    queryKey: ['manager-pin-status'],
    queryFn: async () => {
      const response = await fetch('/api/auth/manager-pin', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر قراءة حالة PIN المدير')
      return result
    },
  })
  const managerPinMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auth/manager-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ currentPassword: adminPassword, pin: managerPin }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر حفظ PIN المدير')
      return result
    },
    onSuccess: () => {
      setAdminPassword('')
      setManagerPin('')
      qc.invalidateQueries({ queryKey: ['manager-pin-status'] })
      toast.success('تم تحديث PIN موافقة المدير بأمان')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'تعذر حفظ PIN المدير'),
  })

  // Sync form with loaded settings
  if (data && Object.keys(form).length === 0) {
    setForm(data)
  }

  const saveMutation = useMutation({
    mutationFn: async (settings: Record<string, string>) => {
      const res = await fetch('/api/store-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (!res.ok) throw new Error('فشل الحفظ')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['store-settings'] })
      toast.success('تم حفظ الإعدادات')
    },
    onError: () => toast.error('فشل الحفظ'),
  })

  function save() {
    if (!form) return
    // Convert booleans to strings
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(form)) {
      out[k] = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v)
    }
    saveMutation.mutate(out)
  }

  function update(key: keyof StoreSettings, value: string | boolean) {
    setForm({ ...form, [key]: String(value) })
  }

  if (isLoading && !data) {
    return <div className="text-muted-foreground">جارٍ تحميل إعدادات المحل...</div>
  }
  if (isError && !data) {
    return <Card><CardContent className="flex flex-col items-center gap-3 p-8 text-center"><p className="text-sm text-destructive">تعذر تحميل إعدادات المحل.</p><Button variant="outline" onClick={() => void refetch()}>إعادة المحاولة</Button></CardContent></Card>
  }
  if (!form) {
    return <div className="text-muted-foreground">جارٍ تحميل إعدادات المحل...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">إعدادات المحل</h2>
        <p className="text-sm text-muted-foreground">معلومات المحل، الضريبة، الفواتير، نقاط الولاء</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="size-4" /> معلومات المحل
          </CardTitle>
          <CardDescription>تظهر في رأس الفاتورة والإيصالات</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="sn">اسم المحل</Label>
            <Input id="sn" value={form.storeName || ''} onChange={(e) => update('storeName', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp">الهاتف</Label>
            <Input id="sp" value={form.storePhone || ''} onChange={(e) => update('storePhone', e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="sa">العنوان</Label>
            <Input id="sa" value={form.storeAddress || ''} onChange={(e) => update('storeAddress', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st">السجل الضريبي</Label>
            <Input id="st" value={form.storeTaxNumber || ''} onChange={(e) => update('storeTaxNumber', e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf">تذييل الإيصال</Label>
            <Input id="sf" value={form.receiptFooter || ''} onChange={(e) => update('receiptFooter', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">إعدادات الضريبة (VAT)</CardTitle>
          <CardDescription>ضريبة القيمة المضافة — تركية 14% في مصر</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>تفعيل الضريبة</Label>
              <p className="text-xs text-muted-foreground">إظهار VAT على الفواتير</p>
            </div>
            <Switch checked={form.vatEnabled === 'true'} onCheckedChange={(c) => update('vatEnabled', c)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vr">نسبة الضريبة (%)</Label>
            <Input id="vr" type="number" step="0.1" value={form.vatRate || '14'} onChange={(e) => update('vatRate', e.target.value)} dir="ltr" />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>شاملة في السعر</Label>
              <p className="text-xs text-muted-foreground">إن كانت الأسعار شاملة VAT</p>
            </div>
            <Switch checked={form.vatInclusive === 'true'} onCheckedChange={(c) => update('vatInclusive', c)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">إعدادات الفواتير</CardTitle>
          <CardDescription>بادئات أرقام الفواتير</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="sip">بادئة بيع</Label>
            <Input id="sip" value={form.saleInvoicePrefix || 'INV'} onChange={(e) => update('saleInvoicePrefix', e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pip">بادئة شراء</Label>
            <Input id="pip" value={form.purchaseInvoicePrefix || 'PUR'} onChange={(e) => update('purchaseInvoicePrefix', e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp">بادئة مرتجع</Label>
            <Input id="rp" value={form.returnPrefix || 'RET'} onChange={(e) => update('returnPrefix', e.target.value)} dir="ltr" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">نقاط الولاء</CardTitle>
          <CardDescription>برنامج نقاط للعملاء الدائمين</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>تفعيل النقاط</Label>
              <p className="text-xs text-muted-foreground">منح نقاط عند البيع</p>
            </div>
            <Switch checked={form.loyaltyEnabled === 'true'} onCheckedChange={(c) => update('loyaltyEnabled', c)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lr">معدل النقاط (لكل ج.م)</Label>
            <Input id="lr" type="number" step="0.001" value={form.loyaltyRate || '0.01'} onChange={(e) => update('loyaltyRate', e.target.value)} dir="ltr" />
            <p className="text-xs text-muted-foreground">0.01 = نقطة لكل 100 ج.م</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">تأمين موافقة المدير على الخصومات</CardTitle>
          <CardDescription>
            PIN منفصل عن PIN فتح الوردية. لا يُعرض أو يُخزّن كنص واضح، وتغييرُه يتطلب كلمة مرور المدير الحالية.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-3 text-sm">
            {managerPinStatus.isLoading
              ? 'جاري فحص إعداد PIN المدير...'
              : managerPinStatus.data?.configured
                ? 'تم إعداد PIN موافقة المدير.'
                : 'لم يتم إعداد PIN موافقة المدير بعد. لن تعمل موافقات الأسعار الخاصة حتى إعداده.'}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="admin-current-password">كلمة مرور المدير الحالية</Label>
              <Input id="admin-current-password" type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manager-approval-pin">PIN الموافقة الجديد (4 إلى 6 أرقام)</Label>
              <Input id="manager-approval-pin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4,6}" maxLength={6} value={managerPin} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, '').slice(0, 6))} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => managerPinMutation.mutate()}
              disabled={managerPinMutation.isPending || !adminPassword || !/^[0-9]{4,6}$/.test(managerPin)}
            >
              {managerPinMutation.isPending ? 'جاري التأمين...' : managerPinStatus.data?.configured ? 'تغيير PIN المدير' : 'تعيين PIN المدير'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saveMutation.isPending} size="lg">
          <Save className="size-4" /> {saveMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}
        </Button>
      </div>
    </div>
  )
}
