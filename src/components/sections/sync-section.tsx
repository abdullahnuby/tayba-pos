'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Download, FileSpreadsheet, RefreshCw, CloudUpload, Link as LinkIcon,
  CheckCircle2, AlertCircle, Eye, Database, Zap, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface SyncStatus {
  configured: boolean
  lastSyncAt: string | null
  autoSyncEnabled: boolean
}

export function SyncSection() {
  const qc = useQueryClient()
  const [clientEmail, setClientEmail] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [liveCsvUrl, setLiveCsvUrl] = useState('')
  const [viewData, setViewData] = useState<{ headers: string[]; rows: string[][]; url: string; count: number } | null>(null)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [appsScriptUrl, setAppsScriptUrl] = useState('')
  const [appsScriptTestResult, setAppsScriptTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const { data: settings = {}, isLoading: loadingSettings } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: async () => (await fetch('/api/settings')).json(),
  })

  // Fetch sync status
  const { data: syncStatus, refetch: refetchStatus } = useQuery<SyncStatus>({
    queryKey: ['sync-status'],
    queryFn: async () => (await fetch('/api/sync/status')).json(),
    refetchInterval: 10_000, // refresh every 10s
  })

  if (!loadingSettings && clientEmail === '' && settings.googleClientEmail) {
    setClientEmail(settings.googleClientEmail)
  }
  if (!loadingSettings && spreadsheetId === '' && settings.googleSpreadsheetId) {
    setSpreadsheetId(settings.googleSpreadsheetId)
  }
  if (!loadingSettings && liveCsvUrl === '' && settings.googleLiveCsvUrl) {
    setLiveCsvUrl(settings.googleLiveCsvUrl)
  }
  if (!loadingSettings && appsScriptUrl === '' && settings.appsScriptUrl) {
    setAppsScriptUrl(settings.appsScriptUrl)
  }

  const toggleAutoSync = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { autoSyncEnabled: String(enabled) } }),
      })
      if (!res.ok) throw new Error('فشل')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['sync-status'] })
      toast.success('تم تحديث إعداد المزامنة التلقائية')
    },
    onError: () => toast.error('فشل التحديث'),
  })

  const saveSettingsMutation = useMutation({
    mutationFn: async (s: Record<string, string>) => {
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: s }),
      })
      if (!res.ok) throw new Error('فشل الحفظ')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('تم حفظ الإعدادات')
    },
    onError: () => toast.error('فشل في حفظ الإعدادات'),
  })

  const googleSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/sync/google', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل المزامنة')
      return data
    },
    onSuccess: (data: { synced: string[]; errors: string[] }) => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['sync-status'] })
      refetchStatus()
      if (data.errors.length > 0) {
        toast.warning(`اكتملت المزامنة مع بعض الأخطاء (${data.errors.length})`)
      } else {
        toast.success(`تمت المزامنة بنجاح: ${data.synced.length} ورقة`)
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const liveFetchMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch(`/api/sync/live?url=${encodeURIComponent(url)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل')
      return data
    },
    onSuccess: (data) => {
      setViewData(data)
      toast.success(`تم جلب ${data.count} صف`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function saveGoogleCredentials() {
    if (!clientEmail || !spreadsheetId) {
      toast.error('البريد ومعرّف الملف مطلوبان')
      return
    }
    const s: Record<string, string> = {
      googleClientEmail: clientEmail,
      googleSpreadsheetId: spreadsheetId,
    }
    if (privateKey) s.googlePrivateKey = privateKey
    saveSettingsMutation.mutate(s)
  }

  function saveLiveUrl() {
    if (!liveCsvUrl) return toast.error('أدخل الرابط')
    saveSettingsMutation.mutate({ googleLiveCsvUrl: liveCsvUrl })
  }

  function downloadExcel() {
    window.open('/api/sync/export?format=xlsx', '_blank')
    toast.success('بدأ تنزيل ملف Excel (18 ورقة)')
  }

  function downloadCsv() {
    window.open('/api/sync/export?format=csv', '_blank')
    toast.success('بدأ تنزيل ملف CSV')
  }

  function saveAppsScriptUrl() {
    if (!appsScriptUrl) return toast.error('أدخل الرابط')
    saveSettingsMutation.mutate({ appsScriptUrl })
  }

  const testAppsScriptMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch('/api/sync/test-apps-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'فشل')
      return data
    },
    onSuccess: (data: { ok: boolean; message: string }) => {
      setAppsScriptTestResult(data)
      if (data.ok) toast.success('تم الاتصال بنجاح')
      else toast.error('فشل الاتصال')
    },
    onError: (e: Error) => {
      setAppsScriptTestResult({ ok: false, message: e.message })
      toast.error(e.message)
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">المزامنة و Google Sheets</h2>
        <p className="text-sm text-muted-foreground">صدّر كل البيانات أو اربط Google Sheets تلقائيًا</p>
      </div>

      {/* Sync status banner */}
      <Card className={`${syncStatus?.configured ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20' : 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20'}`}>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`flex size-12 items-center justify-center rounded-xl ${syncStatus?.configured ? 'bg-emerald-500/20 text-emerald-600' : 'bg-amber-500/20 text-amber-600'}`}>
                {syncStatus?.configured ? <CheckCircle2 className="size-6" /> : <AlertCircle className="size-6" />}
              </div>
              <div>
                <p className="font-semibold">
                  {syncStatus?.configured ? 'Google Sheets متصل' : 'Google Sheets غير مُهيأ'}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="size-3" />
                  {syncStatus?.lastSyncAt
                    ? `آخر مزامنة: ${new Date(syncStatus.lastSyncAt).toLocaleString('ar-EG')}`
                    : 'لا توجد مزامنة بعد'}
                </p>
              </div>
            </div>
            {syncStatus?.configured && (
              <div className="flex items-center gap-2">
                <Zap className={`size-4 ${syncStatus.autoSyncEnabled ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground">المزامنة التلقائية:</span>
                  <Switch
                    checked={syncStatus.autoSyncEnabled}
                    onCheckedChange={(c) => toggleAutoSync.mutate(c)}
                    aria-label="تفعيل المزامنة التلقائية"
                  />
                  <span className={`font-medium ${syncStatus.autoSyncEnabled ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                    {syncStatus.autoSyncEnabled ? 'مفعّلة' : 'متوقفة'}
                  </span>
                </div>
              </div>
            )}
          </div>
          {syncStatus?.configured && syncStatus.autoSyncEnabled && (
            <div className="mt-3 rounded-md bg-emerald-100/50 dark:bg-emerald-950/30 p-2 text-xs text-emerald-800 dark:text-emerald-300">
              ✅ كل عملية بيع/شراء/مرتجع/دفعة تُزامن تلقائياً مع Google Sheets (الأوراق المتأثرة فقط)
            </div>
          )}
        </CardContent>
      </Card>

      {/* Method A */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge>الطريقة 1 — تعمل فورًا</Badge>
              <CardTitle className="text-base">تصدير Excel / CSV شامل</CardTitle>
            </div>
            <CardDescription>
              ملف Excel واحد بـ 18 ورقة (Settings, Categories, Brands, Suppliers, Customers, Products, Variants,
              Purchases, PurchaseItems, Sales, SaleItems, SaleReturns, SaleReturnItems, CustomerPayments,
              SupplierPayments, StockAdjustments, RegisterSessions, AuditLog)
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button onClick={downloadExcel} size="lg" className="h-auto justify-start py-4">
              <FileSpreadsheet className="size-5" />
              <div className="text-right">
                <div className="font-bold">تنزيل Excel (.xlsx)</div>
                <div className="text-xs opacity-90">18 ورقة عمل كاملة</div>
              </div>
              <Download className="ms-auto size-4" />
            </Button>
            <Button onClick={downloadCsv} variant="outline" size="lg" className="h-auto justify-start py-4">
              <FileSpreadsheet className="size-5" />
              <div className="text-right">
                <div className="font-bold">تنزيل CSV (Inventory)</div>
                <div className="text-xs opacity-90">جميع variants + مخزون</div>
              </div>
              <Download className="ms-auto size-4" />
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      <Separator />

      {/* Method B — Apps Script (RECOMMENDED, easiest) */}
      <Card className="border-emerald-200 dark:border-emerald-900/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-600">موصى بها</Badge>
            <CardTitle className="text-base">الطريقة 2 — Google Apps Script (الأسهل)</CardTitle>
          </div>
          <CardDescription>
            لا يحتاج Service Account أو مفاتيح خاصة. يعمل على أي حساب Google.
            أنشئ Web App داخل Google Sheet والصق الرابط هنا.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs">
            <p className="font-medium text-emerald-800 dark:text-emerald-300 mb-2">طريقة الإعداد (5 دقائق):</p>
            <ol className="space-y-1.5 list-decimal list-inside text-emerald-700 dark:text-emerald-400">
              <li>افتح Google Sheet الذي تريد ربطه بطيبة</li>
              <li>من القائمة: <b>Extensions → Apps Script</b> (الإضافات → برمجة التطبيقات)</li>
              <li>احذف أي كود موجود، والصق كود طيبة (download من <a href="/GoogleAppsScript.gs" target="_blank" className="underline font-semibold">هذا الرابط</a> أو انسخه من ملف public/GoogleAppsScript.gs)</li>
              <li>احفظ (Ctrl+S)، سمّه "Tayba Sync"</li>
              <li><b>Deploy → New deployment → Web app</b></li>
              <li>الإعدادات:
                <ul className="list-disc list-inside ms-4 mt-1">
                  <li><b>Execute as</b>: Me (تنفيذ باسمي)</li>
                  <li><b>Who has access</b>: Anyone (أي شخص)</li>
                </ul>
              </li>
              <li>اضغط <b>Deploy</b> → اقبل الأذونات (Authorize access)</li>
              <li>انسخ الـ <b>Web App URL</b> والصقه بالأسفل</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appsScriptUrl">رابط Apps Script Web App</Label>
            <Input
              id="appsScriptUrl"
              placeholder="https://script.google.com/macros/s/AKfycby.../exec"
              value={appsScriptUrl}
              onChange={(e) => setAppsScriptUrl(e.target.value)}
              dir="ltr"
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              الرابط يبدأ بـ <code className="font-mono">https://script.google.com/macros/s/</code>
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveAppsScriptUrl} variant="outline">
              <CloudUpload className="size-4" /> حفظ الرابط
            </Button>
            <Button
              onClick={() => appsScriptUrl && testAppsScriptMutation.mutate(appsScriptUrl)}
              disabled={testAppsScriptMutation.isPending || !appsScriptUrl}
              variant="secondary"
            >
              <Eye className="size-4" /> {testAppsScriptMutation.isPending ? 'جارٍ الاختبار...' : 'اختبار الاتصال'}
            </Button>
            <Button
              onClick={() => googleSyncMutation.mutate()}
              disabled={googleSyncMutation.isPending || !settings.appsScriptUrl}
            >
              <RefreshCw className={`size-4 ${googleSyncMutation.isPending ? 'animate-spin' : ''}`} />
              {googleSyncMutation.isPending ? 'جارٍ المزامنة...' : 'مزامنة الآن'}
            </Button>
          </div>

          {appsScriptTestResult && (
            <div className={`rounded-md border p-3 text-xs ${appsScriptTestResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300' : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300'}`}>
              <div className="flex items-start gap-2">
                {appsScriptTestResult.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
                <div>
                  <p className="font-medium">{appsScriptTestResult.ok ? 'تم الاتصال بنجاح' : 'فشل الاتصال'}</p>
                  <p className="mt-0.5 opacity-90">{appsScriptTestResult.message}</p>
                </div>
              </div>
            </div>
          )}

          {settings.appsScriptUrl && (
            <div className="flex items-center gap-2 rounded-md border bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="size-4" />
              Apps Script مُهيأ — كل عملية بيع/شراء ستُزامن تلقائياً
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Method C — Service Account (fallback if Apps Script doesn't work) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">الطريقة 3 — بديلة</Badge>
            <CardTitle className="text-base">مزامنة عبر Service Account (للمتقدمين)</CardTitle>
          </div>
          <CardDescription>
            لو Apps Script لا يعمل، استخدم Service Account. يتطلب Google Cloud Project + مفتاح JSON.
            <b className="text-amber-700 dark:text-amber-400"> ملاحظة:</b> قد تظهر خطأ "Service account key creation is disabled" — استخدم الطريقة 2 بدلاً منها.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="space-y-1">
                <p className="font-medium text-amber-800 dark:text-amber-300">تنبيه أمني</p>
                <p className="text-amber-700 dark:text-amber-400">
                  بيانات الاعتماد محفوظة في SQLite المحلي بدون تشفير. مناسب للتطبيقات المحلية فقط.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">بريد حساب الخدمة</Label>
            <Input id="email" placeholder="my-service@project.iam.gserviceaccount.com" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} dir="ltr" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="key">المفتاح الخاص (PEM)</Label>
              {settings.googlePrivateKeyMasked && !privateKey && (
                <span className="text-xs text-muted-foreground" dir="ltr">{settings.googlePrivateKeyMasked}</span>
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowPrivateKey((s) => !s)}>
                {showPrivateKey ? 'إخفاء' : 'إظهار'}
              </Button>
            </div>
            <Textarea
              id="key"
              placeholder="[REDACTED-SECRET]"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              rows={4}
              dir="ltr"
              className={showPrivateKey ? '' : 'font-mono text-[8px]'}
            />
            <p className="text-xs text-muted-foreground">اتركه فارغًا للاحتفاظ بالقيمة المحفوظة</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sheet">معرّف ملف Google Sheet</Label>
            <Input id="sheet" placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz..." value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} dir="ltr" />
            <p className="text-xs text-muted-foreground">
              تجده في الرابط: docs.google.com/spreadsheets/d/<span className="font-mono">[هذا الجزء]</span>/edit
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveGoogleCredentials} variant="outline">
              <CloudUpload className="size-4" /> حفظ بيانات الاعتماد
            </Button>
            <Button onClick={() => googleSyncMutation.mutate()} disabled={googleSyncMutation.isPending || !settings.googleClientEmail}>
              <RefreshCw className={`size-4 ${googleSyncMutation.isPending ? 'animate-spin' : ''}`} />
              {googleSyncMutation.isPending ? 'جارٍ المزامنة...' : 'مزامنة الآن (18 ورقة)'}
            </Button>
          </div>

          {settings.googleClientEmail && (
            <div className="flex items-center gap-2 rounded-md border bg-emerald-50 p-2 text-xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="size-4" />
              بيانات الاعتماد مهيأة ({settings.googleClientEmail})
              {settings.lastGoogleSyncAt && (
                <span className="text-muted-foreground">· آخر مزامنة: {new Date(settings.lastGoogleSyncAt).toLocaleString('ar-EG')}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Method C */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">الطريقة 3</Badge>
            <CardTitle className="text-base">رابط CSV مباشر (قراءة فقط)</CardTitle>
          </div>
          <CardDescription>الصق رابط Google Sheet منشور للويب كـ CSV</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="liveurl">رابط CSV المباشر</Label>
            <Input id="liveurl" placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv" value={liveCsvUrl} onChange={(e) => setLiveCsvUrl(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveLiveUrl} variant="outline"><LinkIcon className="size-4" /> حفظ الرابط</Button>
            <Button onClick={() => liveCsvUrl && liveFetchMutation.mutate(liveCsvUrl)} disabled={liveFetchMutation.isPending || !liveCsvUrl} variant="secondary">
              <Eye className="size-4" /> {liveFetchMutation.isPending ? 'جارٍ الجلب...' : 'عرض البيانات'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!viewData} onOpenChange={(o) => !o && setViewData(null)}>
        <DialogContent className="sm:max-w-[800px]">
          <DialogHeader>
            <DialogTitle>عرض بيانات Google Sheet</DialogTitle>
            <DialogDescription>{viewData?.count || 0} صف · {viewData?.url}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-auto rounded-md border table-sticky">
            {viewData && (
              <Table>
                <TableHeader>
                  <TableRow>
                    {viewData.headers.map((h, i) => <TableHead key={i}>{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewData.rows.map((r, i) => (
                    <TableRow key={i}>
                      {r.map((c, j) => <TableCell key={j} className="text-xs">{c}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setViewData(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
