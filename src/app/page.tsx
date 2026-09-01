'use client'

import { useState, useEffect, useCallback } from 'react'
import { LoginSection } from '@/components/login-section'
import { AppShell } from '@/components/app-shell'

interface SessionUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'manager' | 'cashier'
}

type AppView = 'loading' | 'login' | 'app'

export default function Home() {
  const [view, setView] = useState<AppView>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)

  const checkSession = useCallback(async () => {
    try {
      // Fixed admin account is auto-created on the Google Sheet on first
      // login attempt (see ensureSeedAdmin in /api/auth/login) — no setup wizard needed.
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        if (data.user) {
          setUser(data.user)
          setView('app')
        } else {
          setView('login')
        }
      } else {
        setView('login')
      }
    } catch {
      setView('login')
    }
  }, [])

  useEffect(() => {
    checkSession()
  }, [checkSession])

  if (view === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-8 animate-pulse rounded-full bg-primary/30" />
      </div>
    )
  }

  if (view === 'login' || !user) {
    return <LoginSection onLogin={checkSession} />
  }

  return <AppShell user={user} onLogout={async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setView('login')
  }} />
}
