'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Loader2, Lock, User, Store, CheckCircle2, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'

interface SetupProps {
  onSetupComplete: () => void
}

export function SetupSection({ onSetupComplete }: SetupProps) {
  const router = useRouter()
  const [form, setForm] = useState({
    username: 'admin',
    password: '',
    name: 'المدير العام',
    storeName: 'طيبة',
    storeAddress: '',
    storePhone: '',
    vatEnabled: false,
    vatRate: 14,
  })
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState(1)

  useEffect(() => {
    document.getElementById('setup-password')?.focus()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username || !form.password || !form.name || !form.storeName) {
      toast.error('كل الحقول المطلوبة يجب أن تُملأ')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'فشل الإعداد')
        return
      }
      toast.success('تم إعداد النظام! سجل دخول الآن.')
      onSetupComplete()
    } catch {
      toast.error('خطأ في الاتصال')
    } finally {
      setLoading(false)
    }
  }

  function next() {
    if (step === 1 && (!form.username || !form.password || !form.name)) {
      toast.error('أكمل بيانات المدير')
      return
    }
    if (step === 1 && form.password.length < 8) {
      toast.error('كلمة المرور يجب أن تكون 8 أحرف على الأقل، تحتوي على حرف كبير، رقم، ورمز خاص')
      return
    }
    if (step === 1 && !/[A-Z]/.test(form.password)) {
      toast.error('كلمة المرور يجب أن تحتوي على حرف لاتيني كبير')
      return
    }
    if (step === 1 && !/[0-9]/.test(form.password)) {
      toast.error('كلمة المرور يجب أن تحتوي على رقم')
      return
    }
    if (step === 1 && !/[^a-zA-Z0-9]/.test(form.password)) {
      toast.error('كلمة المرور يجب أن تحتوي على رمز خاص')
      return
    }
    if (step === 2 && !form.storeName) {
      toast.error('اسم المحل مطلوب')
      return
    }
    setStep(step + 1)
  }

  function back() {
    setStep(Math.max(1, step - 1))
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-background to-amber-50 dark:from-emerald-950/40 dark:via-background dark:to-amber-950/20 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <Card className="border-2 shadow-xl">
          <CardHeader className="text-center pb-6 pt-8">
            <img
              src="/tayba-logo.svg"
              alt="طيبة"
              className="mx-auto mb-4 size-20 rounded-3xl shadow-lg"
            />
            <CardTitle className="text-3xl font-bold tracking-tight">طيبة</CardTitle>
            <CardDescription className="text-base mt-1">
              الخطوة {step} من 3 — إعداد النظام لأول مرة
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {/* Step 1: Admin user */}
              {step === 1 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <User className="size-4" /> بيانات المدير
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-username">اسم المستخدم *</Label>
                    <Input
                      id="setup-username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      dir="ltr"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-name">الاسم الكامل *</Label>
                    <Input
                      id="setup-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-password">كلمة المرور *</Label>
                    <Input
                      id="setup-password"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="8+ أحرف، حرف كبير، رقم، رمز"
                      dir="ltr"
                    />
                    <div className="rounded-md border bg-muted/30 p-2 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1 mb-1">
                        <AlertCircle className="size-3" /> سياسة كلمة المرور:
                      </div>
                      <ul className="space-y-0.5 list-disc list-inside">
                        <li className={form.password.length >= 8 ? 'text-emerald-600' : ''}>8 أحرف على الأقل</li>
                        <li className={/[A-Z]/.test(form.password) ? 'text-emerald-600' : ''}>حرف لاتيني كبير (A-Z)</li>
                        <li className={/[0-9]/.test(form.password) ? 'text-emerald-600' : ''}>رقم (0-9)</li>
                        <li className={/[^a-zA-Z0-9]/.test(form.password) ? 'text-emerald-600' : ''}>رمز خاص (@$!%*#?&)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Store info */}
              {step === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Store className="size-4" /> بيانات المحل
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-store">اسم المحل *</Label>
                    <Input
                      id="setup-store"
                      value={form.storeName}
                      onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-addr">العنوان</Label>
                    <Input
                      id="setup-addr"
                      value={form.storeAddress}
                      onChange={(e) => setForm({ ...form, storeAddress: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-phone">الهاتف</Label>
                    <Input
                      id="setup-phone"
                      value={form.storePhone}
                      onChange={(e) => setForm({ ...form, storePhone: e.target.value })}
                      dir="ltr"
                    />
                  </div>
                </div>
              )}

              {/* Step 3: VAT settings */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Store className="size-4" /> إعدادات الضريبة (VAT)
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label>تفعيل ضريبة القيمة المضافة</Label>
                      <p className="text-xs text-muted-foreground">14% في مصر — اختر "نعم" إذا كنت مسجلاً</p>
                    </div>
                    <Switch
                      checked={form.vatEnabled}
                      onCheckedChange={(c) => setForm({ ...form, vatEnabled: c })}
                    />
                  </div>
                  {form.vatEnabled && (
                    <div className="space-y-1.5">
                      <Label htmlFor="setup-vat">نسبة الضريبة (%)</Label>
                      <Input
                        id="setup-vat"
                        type="number"
                        step="0.1"
                        value={form.vatRate}
                        onChange={(e) => setForm({ ...form, vatRate: Number(e.target.value) })}
                        dir="ltr"
                      />
                    </div>
                  )}
                  <div className="rounded-md border bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs">
                    <div className="flex items-center gap-1 mb-1 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="size-4" /> جاهز للإعداد
                    </div>
                    <p className="text-muted-foreground">
                      سيتم إنشاء حساب <b>{form.username}</b> كمدير عام باسم <b>{form.name}</b> لمحل <b>{form.storeName}</b>.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                {step > 1 && (
                  <Button type="button" variant="outline" onClick={back} className="flex-1">
                    السابق
                  </Button>
                )}
                {step < 3 ? (
                  <Button type="button" onClick={next} className="flex-1">
                    التالي
                  </Button>
                ) : (
                  <Button type="submit" disabled={loading} className="flex-1">
                    {loading ? (
                      <><Loader2 className="size-4 animate-spin" /> جارٍ الإعداد...</>
                    ) : (
                      <><CheckCircle2 className="size-4" /> إعداد النظام</>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
