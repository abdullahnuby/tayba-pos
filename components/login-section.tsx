'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2, Lock, User } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'

interface LoginProps {
  onLogin: () => void
}

export function LoginSection({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    document.getElementById('login-username')?.focus()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) {
      toast.error('أدخل اسم المستخدم وكلمة المرور')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'فشل تسجيل الدخول')
        return
      }
      toast.success(`أهلاً ${data.name}!`)
      onLogin()
    } catch {
      toast.error('خطأ في الاتصال')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50/50 via-background to-amber-50/30 dark:from-emerald-950/30 dark:via-background dark:to-amber-950/10 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        <Card className="shadow-2xl border-border/50">
          <CardHeader className="text-center pb-6 pt-8">
            <img
              src="/tayba-logo.svg"
              alt="طيبة"
              className="mx-auto mb-4 size-20 rounded-3xl shadow-lg"
            />
            <CardTitle className="text-3xl font-bold tracking-tight">طيبة</CardTitle>
            <CardDescription className="text-base mt-1">
              نظام إدارة المحلات — سجل دخولك للمتابعة
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-8">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-username" className="text-sm font-medium">اسم المستخدم</Label>
                <div className="relative">
                  <User className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="login-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="اسم المستخدم"
                    className="pr-9 h-11"
                    autoComplete="username"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password" className="text-sm font-medium">كلمة المرور</Label>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pr-9 h-11"
                    autoComplete="current-password"
                  />
                </div>
              </div>
              <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
                {loading ? (
                  <><Loader2 className="size-4 animate-spin" /> جارٍ الدخول...</>
                ) : (
                  'تسجيل الدخول'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
