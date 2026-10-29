'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Database, Download, FileSpreadsheet, RefreshCw, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

type BackupRecord = { filename: string; sizeBytes: number; createdAt: string }
type BackupStatus = {
  ok: boolean
  source: 'local-sqlite'
  databaseExists: boolean
  databaseSizeBytes: number
  backups: BackupRecord[]
  maximumBackups: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجابايت`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json()
    return typeof body.error === 'string' ? body.error : 'تعذر إتمام العملية'
  } catch {
    return 'تعذر إتمام العملية'
  }
}

export function SyncSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/backup/database', { cache: 'no-store' })
      if (!response.ok) throw new Error(await responseError(response))
      setStatus(await response.json())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر قراءة حالة النسخ الاحتياطي')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const createBackup = async () => {
    setCreating(true)
    try {
      const response = await fetch('/api/backup/database', { method: 'POST', cache: 'no-store' })
      if (!response.ok) throw new Error(await responseError(response))
      const blob = await response.blob()
      const filename = response.headers.get('X-Backup-Filename') || `tayba-pos-backup-${new Date().toISOString().slice(0, 10)}.db`
      downloadBlob(blob, filename)
      toast.success('اتعملت نسخة SQLite محلية واتنزّلت على جهازك')
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'فشل إنشاء النسخة الاحتياطية')
    } finally {
      setCreating(false)
    }
  }

  const exportExcel = async () => {
    setExporting(true)
    try {
      const response = await fetch('/api/backup/export?format=xlsx', { cache: 'no-store' })
      if (!response.ok) throw new Error(await responseError(response))
      downloadBlob(await response.blob(), `tayba-operational-export-${new Date().toISOString().slice(0, 10)}.xlsx`)
      toast.success('تم تصدير البيانات التشغيلية إلى Excel')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'فشل تصدير البيانات')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">قاعدة البيانات والنسخ الاحتياطي</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          بيانات طيبة محفوظة على SQLite داخل جهاز التشغيل. لا توجد مزامنة مع Google Sheets أو خدمة تخزين سحابية.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-3"><Database className="h-6 w-6 text-primary" /></div>
            <div className="flex-1">
              <CardTitle>قاعدة البيانات المحلية</CardTitle>
              <CardDescription>الملف المحلي هو المصدر الوحيد للبيانات اليومية.</CardDescription>
            </div>
            <Badge variant={status?.databaseExists ? 'default' : 'destructive'}>
              {loading ? 'جاري الفحص' : status?.databaseExists ? 'متاحة' : 'غير مهيأة'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="font-medium">حجم قاعدة البيانات</div>
              <div className="text-sm text-muted-foreground">
                {loading ? '...' : status?.databaseExists ? formatBytes(status.databaseSizeBytes) : 'لم يتم إنشاء ملف البيانات بعد'}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`ms-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              تحديث الحالة
            </Button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={() => void createBackup()} disabled={creating || loading || !status?.databaseExists} className="flex-1">
              <ShieldCheck className="ms-2 h-4 w-4" />
              {creating ? 'جاري إنشاء النسخة...' : 'إنشاء نسخة SQLite وتنزيلها'}
            </Button>
            <Button variant="outline" onClick={() => void exportExcel()} disabled={exporting || loading} className="flex-1">
              <FileSpreadsheet className="ms-2 h-4 w-4" />
              {exporting ? 'جاري التصدير...' : 'تصدير البيانات التشغيلية إلى Excel'}
            </Button>
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            نسخة SQLite تحتوي على قاعدة البيانات كاملة، بما فيها المستخدمون والإعدادات وسجل العمليات. نسخة Excel مخصصة للمراجعة والتحليل وليست بديلًا عن ملف SQLite عند الاستعادة.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>النسخ المحلية المحفوظة</CardTitle>
          <CardDescription>
            يحتفظ البرنامج بآخر {status?.maximumBackups ?? 30} نسخة داخل مجلد backups، بالإضافة إلى الملف الذي تم تنزيله على جهازك.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">جاري قراءة النسخ...</div>
          ) : !status?.backups.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">لم يتم إنشاء نسخة محلية من خلال هذه الشاشة حتى الآن.</div>
          ) : (
            <div className="space-y-3">
              {status.backups.map((backup) => (
                <div key={backup.filename} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-all text-sm font-medium">{backup.filename}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(backup.createdAt).toLocaleString('ar-EG')} · {formatBytes(backup.sizeBytes)}
                    </div>
                  </div>
                  <Download className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
