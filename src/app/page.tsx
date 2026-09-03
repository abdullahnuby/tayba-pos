'use client'

import { useState, useEffect, useCallback } from 'react'
import { LoginSection } from '@/components/login-section'
import { SetupSection } from '@/components/setup-section'
import { AppShell } from '@/components/app-shell'

interface SessionUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'manager' | 'cashier'
}

type AppView = 'loading' | 'setup' | 'login' | 'app'

export default function Home() {
  const [view, setView] = useState<AppView>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)

  const checkSession = useCallback(async () => {
    try {
      // First check whether the system has ever been set up at all. If no
      // user exists yet, the ONLY way to create the first admin is the
      // setup wizard (which lets the store owner pick their own username
      // and password) — never an auto-created known-password account.
      const setupRes = await fetch('/api/auth/setup')
      if (setupRes.ok) {
        const setupData = await setupRes.json()
        if (setupData.needsSetup) {
          setView('setup')
          return
        }
      }

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

  if (view === 'setup') {
    return <SetupSection onSetupComplete={checkSession} />
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
