'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { FileClock } from 'lucide-react'
import { formatDateTime } from '@/lib/format'
import { EmptyState } from '@/components/empty-state'

const ACTION_LABELS: Record<string, string> = {
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  void: 'إلغاء',
  return: 'مرتجع',
  payment: 'دفعة',
  login: 'دخول',
  logout: 'خروج',
  stock_adjust: 'تعديل مخزون',
  register_open: 'فتح وردية',
  register_close: 'إغلاق وردية',
}

const ENTITY_LABELS: Record<string, string> = {
  sale: 'بيع',
  purchase: 'شراء',
  product: 'منتج',
  customer: 'عميل',
  supplier: 'مورد',
  user: 'مستخدم',
  settings: 'إعدادات',
  variant: 'متغير',
  registerSession: 'وردية',
}

export function AuditLogSection() {
  const { data, isLoading } = useQuery<{ items: any[] }>({
    queryKey: ['audit-logs'],
    queryFn: async () => (await fetch('/api/audit-logs?limit=200')).json(),
  })
  const logs = data?.items || []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">سجل العمليات</h2>
        <p className="text-sm text-muted-foreground">كل العمليات الحساسة في النظام موثقة</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">آخر {logs.length} عملية</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : logs.length === 0 ? (
            <EmptyState title="لا توجد عمليات مسجلة" icon={FileClock} />
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-md border table-sticky">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المستخدم</TableHead>
                    <TableHead>الإجراء</TableHead>
                    <TableHead>الكيان</TableHead>
                    <TableHead>المعرّف</TableHead>
                    <TableHead>التفاصيل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => {
                    let details = ''
                    if (l.after) {
                      try {
                        const parsed = JSON.parse(l.after)
                        details = Object.entries(parsed).slice(0, 3).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
                      } catch {
                        details = l.after.slice(0, 100)
                      }
                    }
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs">{formatDateTime(l.createdAt)}</TableCell>
                        <TableCell className="text-xs">{l.user?.name || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {ACTION_LABELS[l.action] || l.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{ENTITY_LABELS[l.entity] || l.entity}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{l.entityId?.slice(-8) || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{details}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
