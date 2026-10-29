'use client'

import { useState, type FormEvent } from 'react'
import { Lock, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type PasswordChangeUser = { name: string; username: string }

export function ForcePasswordChange({ user, onComplete, onLogout }: {
  user: PasswordChangeUser
  onComplete: () => void | Promise<void>
  onLogout: () => void | Promise<void>
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('تأكيد كلمة المرور غير مطابق')
      return
    }
    if (currentPassword === newPassword) {
      toast.error('كلمة المرور الجديدة يجب أن تكون مختلفة')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'تعذر تغيير كلمة المرور')
      toast.success('تم تحديث كلمة المرور. تقدر تستخدم البرنامج الآن.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await onComplete()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تغيير كلمة المرور')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg shadow-xl">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="size-7" />
          </div>
          <CardTitle className="text-2xl">تأمين الحساب قبل المتابعة</CardTitle>
          <CardDescription className="leading-7">
            أهلًا {user.name}. لازم تعيّن كلمة مرور جديدة قبل استخدام النظام، ولن يُسمح بعمليات البيع أو الاطلاع على البيانات قبل إتمام الخطوة دي.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">كلمة المرور الحالية أو PIN القديم</Label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="h-11 pr-9" />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">للحسابات المنقولة من النسخة القديمة، استخدم PIN القديم مرة واحدة بدل كلمة المرور الحالية.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">كلمة المرور الجديدة</Label>
              <Input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} className="h-11" />
              <p className="text-xs leading-5 text-muted-foreground">8 أحرف على الأقل، وحرف إنجليزي كبير، ورقم، ورمز خاص.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">تأكيد كلمة المرور الجديدة</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="h-11" />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? <><Loader2 className="ms-2 size-4 animate-spin" /> جارٍ تأمين الحساب...</> : 'حفظ كلمة المرور والمتابعة'}
            </Button>
            <Button type="button" variant="ghost" className="w-full" disabled={loading} onClick={() => void onLogout()}>تسجيل الخروج</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
