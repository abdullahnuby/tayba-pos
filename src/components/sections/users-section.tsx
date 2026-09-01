'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { UserPlus, KeyRound, Trash2, Users as UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

interface AppUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'manager' | 'cashier'
  active: boolean
  createdAt?: string
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'مدير عام',
  manager: 'محاسب',
  cashier: 'كاشير',
}

export function UsersSection() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: async () => (await fetch('/api/users')).json(),
  })

  const [addOpen, setAddOpen] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', name: '', role: 'cashier' })

  const [resetTarget, setResetTarget] = useState<AppUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'فشل إنشاء المستخدم')
      return body
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('تم إنشاء المستخدم — لازم يغيّر كلمة السر أول ما يدخل')
      setAddOpen(false)
      setNewUser({ username: '', password: '', name: '', role: 'cashier' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'فشل التعديل')
      return body
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'فشل الحذف')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('تم حذف المستخدم')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function submitReset() {
    if (!resetTarget) return
    if (resetPassword.length < 6) {
      toast.error('كلمة السر لازم تكون 6 أحرف على الأقل')
      return
    }
    patchMutation.mutate(
      { id: resetTarget.id, data: { password: resetPassword } },
      {
        onSuccess: () => {
          toast.success('تم تغيير كلمة السر — المستخدم لازم يغيّرها تاني أول ما يدخل')
          setResetTarget(null)
          setResetPassword('')
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UsersIcon className="size-6 text-primary" />
            المستخدمين
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            إدارة حسابات الدخول للنظام — إنشاء، تعطيل، تغيير الصلاحية وكلمة السر
          </p>
        </div>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="size-4" />
              مستخدم جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إنشاء مستخدم جديد</DialogTitle>
              <DialogDescription>هيتطلب منه تغيير كلمة السر أول ما يسجل دخول</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>الاسم</Label>
                <Input
                  value={newUser.name}
                  onChange={(e) => setNewUser((s) => ({ ...s, name: e.target.value }))}
                  placeholder="اسم الموظف"
                />
              </div>
              <div className="space-y-2">
                <Label>اسم المستخدم (للدخول)</Label>
                <Input
                  value={newUser.username}
                  onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))}
                  placeholder="username"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>كلمة السر المبدئية</Label>
                <Input
                  type="text"
                  value={newUser.password}
                  onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
                  placeholder="6 أحرف على الأقل"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>الصلاحية</Label>
                <Select
                  value={newUser.role}
                  onValueChange={(v) => setNewUser((s) => ({ ...s, role: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cashier">كاشير</SelectItem>
                    <SelectItem value="manager">محاسب</SelectItem>
                    <SelectItem value="admin">مدير عام</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !newUser.username || !newUser.password || !newUser.name}
              >
                إنشاء الحساب
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">كل المستخدمين</CardTitle>
          <CardDescription>البيانات متخزنة على Google Sheet</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">جاري التحميل...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>اسم المستخدم</TableHead>
                  <TableHead>الصلاحية</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell dir="ltr" className="text-muted-foreground">{u.username}</TableCell>
                    <TableCell>
                      <Select
                        value={u.role}
                        onValueChange={(v) => patchMutation.mutate({ id: u.id, data: { role: v } })}
                      >
                        <SelectTrigger className="w-32 h-8">
                          <SelectValue>{ROLE_LABEL[u.role]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cashier">كاشير</SelectItem>
                          <SelectItem value="manager">محاسب</SelectItem>
                          <SelectItem value="admin">مدير عام</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={u.active}
                          onCheckedChange={(checked) =>
                            patchMutation.mutate({ id: u.id, data: { active: checked } })
                          }
                        />
                        <Badge variant={u.active ? 'default' : 'secondary'}>
                          {u.active ? 'مفعّل' : 'معطّل'}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Dialog
                          open={resetTarget?.id === u.id}
                          onOpenChange={(open) => {
                            if (!open) {
                              setResetTarget(null)
                              setResetPassword('')
                            } else {
                              setResetTarget(u)
                            }
                          }}
                        >
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="تغيير كلمة السر">
                              <KeyRound className="size-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>تغيير كلمة سر {u.name}</DialogTitle>
                              <DialogDescription>هيتطلب منه تغييرها تاني أول دخول</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2 py-2">
                              <Label>كلمة السر الجديدة</Label>
                              <Input
                                dir="ltr"
                                value={resetPassword}
                                onChange={(e) => setResetPassword(e.target.value)}
                                placeholder="6 أحرف على الأقل"
                              />
                            </div>
                            <DialogFooter>
                              <Button onClick={submitReset} disabled={patchMutation.isPending}>
                                حفظ
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="حذف المستخدم">
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف {u.name}؟</AlertDialogTitle>
                              <AlertDialogDescription>
                                الإجراء ده نهائي. لو عايز توقف دخوله بس، استخدم زر التعطيل بدل الحذف.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>إلغاء</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(u.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                حذف نهائي
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
