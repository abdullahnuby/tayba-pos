'use client'

import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Menu, LogOut, Moon, Sun, TrendingUp, ShoppingCart, Package, Users, User, BarChart3, RefreshCw, LayoutDashboard, RotateCcw, Banknote, Settings, FileClock, ClipboardList } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAppStore, type SectionKey } from '@/lib/store'
import { DashboardSection } from '@/components/sections/dashboard-section'
import { ProductsSection } from '@/components/sections/products-section'
import { PurchasesSection } from '@/components/sections/purchases-section'
import { SalesSection } from '@/components/sections/sales-section'
import { SuppliersSection } from '@/components/sections/suppliers-section'
import { CustomersSection } from '@/components/sections/customers-section'
import { ReportsSection } from '@/components/sections/reports-section'
import { SyncSection } from '@/components/sections/sync-section'
import { ReturnsSection } from '@/components/sections/returns-section'
import { RegisterSection } from '@/components/sections/register-section'
import { StoreSettingsSection } from '@/components/sections/store-settings-section'
import { AuditLogSection } from '@/components/sections/audit-log-section'
import { UsersSection } from '@/components/sections/users-section'
import { StockAdjustmentsSection } from '@/components/sections/stock-adjustments-section'

export interface SessionUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'manager' | 'cashier'
}

interface NavItem {
  key: SectionKey
  label: string
  icon: ComponentType<{ className?: string }>
  roles: Array<SessionUser['role']>
  group: 'operations' | 'inventory' | 'people' | 'management'
}

const GROUP_LABELS = {
  operations: 'التشغيل',
  inventory: 'المخزون',
  people: 'العملاء والموردون',
  management: 'الإدارة والتقارير',
} as const

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['admin', 'manager'], group: 'operations' },
  { key: 'sales', label: 'نقطة البيع', icon: TrendingUp, roles: ['admin', 'manager', 'cashier'], group: 'operations' },
  { key: 'register', label: 'الوردية', icon: Banknote, roles: ['admin', 'manager', 'cashier'], group: 'operations' },
  { key: 'products', label: 'المنتجات والمخزون', icon: Package, roles: ['admin', 'manager'], group: 'inventory' },
  { key: 'purchases', label: 'المشتريات', icon: ShoppingCart, roles: ['admin', 'manager'], group: 'inventory' },
  { key: 'stock-adjustments', label: 'الجرد والتسويات', icon: ClipboardList, roles: ['admin', 'manager'], group: 'inventory' },
  { key: 'returns', label: 'المرتجعات', icon: RotateCcw, roles: ['admin', 'manager'], group: 'operations' },
  { key: 'suppliers', label: 'الموردون', icon: Users, roles: ['admin', 'manager'], group: 'people' },
  { key: 'customers', label: 'العملاء', icon: User, roles: ['admin', 'manager'], group: 'people' },
  { key: 'reports', label: 'التقارير', icon: BarChart3, roles: ['admin', 'manager'], group: 'management' },
  { key: 'sync', label: 'المزامنة', icon: RefreshCw, roles: ['admin', 'manager'], group: 'management' },
  { key: 'audit', label: 'سجل العمليات', icon: FileClock, roles: ['admin'], group: 'management' },
  { key: 'users', label: 'المستخدمون', icon: Users, roles: ['admin'], group: 'management' },
  { key: 'settings', label: 'الإعدادات', icon: Settings, roles: ['admin'], group: 'management' },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="size-9" />
  return <Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="تبديل السمة">{theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
}

function BrandMark({ className }: { className?: string }) {
  return <img src="/favicon.svg" alt="طيبة" className={className} />
}

function NavList({ user, onNavigate }: { user: SessionUser; onNavigate?: () => void }) {
  const activeSection = useAppStore((s) => s.activeSection)
  const setSection = useAppStore((s) => s.setSection)
  const items = NAV_ITEMS.filter((i) => i.roles.includes(user.role))
  const groups = (Object.keys(GROUP_LABELS) as NavItem['group'][]).map(group => ({ group, items: items.filter(i => i.group === group) })).filter(g => g.items.length)
  return (
    <nav className="space-y-4 p-3" aria-label="القائمة الرئيسية">
      {groups.map(({ group, items }) => (
        <div key={group}>
          <p className="mb-1.5 px-3 text-[10px] font-bold tracking-wider text-muted-foreground/70">{GROUP_LABELS[group]}</p>
          <div className="space-y-0.5">
            {items.map(item => {
              const Icon = item.icon
              const active = activeSection === item.key
              return <button key={item.key} onClick={() => { setSection(item.key); onNavigate?.() }} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition outline-none', active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground')} aria-current={active ? 'page' : undefined}><Icon className="size-4 shrink-0" /><span className="truncate">{item.label}</span></button>
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

function SectionRenderer({ section, user }: { section: SectionKey; user: SessionUser }) {
  switch (section) {
    case 'dashboard': return <DashboardSection />
    case 'products': return <ProductsSection />
    case 'purchases': return <PurchasesSection />
    case 'sales': return <SalesSection user={user} />
    case 'suppliers': return <SuppliersSection />
    case 'customers': return <CustomersSection />
    case 'returns': return <ReturnsSection />
    case 'register': return <RegisterSection />
    case 'stock-adjustments': return <StockAdjustmentsSection />
    case 'reports': return <ReportsSection />
    case 'sync': return <SyncSection />
    case 'audit': return <AuditLogSection />
    case 'users': return <UsersSection />
    case 'settings': return <StoreSettingsSection />
    default: return <DashboardSection />
  }
}

export function AppShell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const activeSection = useAppStore(s => s.activeSection)
  const setSection = useAppStore(s => s.setSection)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [today, setToday] = useState('')
  useEffect(() => { setToday(new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })) }, [])

  // A cashier can never enter administration from a stale persisted section.
  useEffect(() => {
    if (user.role === 'cashier' && activeSection !== 'sales' && activeSection !== 'register') setSection('register')
  }, [user.role, activeSection, setSection])

  const currentLabel = useMemo(() => NAV_ITEMS.find(n => n.key === activeSection)?.label || 'الوردية', [activeSection])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className={cn('sticky top-0 z-40 border-b bg-background/90 backdrop-blur-xl', activeSection === 'sales' && 'hidden lg:block')}>
        <div className="flex h-16 items-center gap-3 px-4 lg:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="فتح القائمة"><Menu className="size-5" /></Button></SheetTrigger>
            <SheetContent side="right" className="w-72 p-0"><SheetTitle className="sr-only">القائمة الجانبية</SheetTitle><div className="flex h-16 items-center gap-2 border-b px-4"><BrandMark className="size-9" /><div><p className="font-bold">طيبة</p><p className="text-[10px] text-muted-foreground">نقطة البيع</p></div></div><div className="h-[calc(100dvh-4rem)] overflow-y-auto"><NavList user={user} onNavigate={() => setMobileOpen(false)} /></div></SheetContent>
          </Sheet>
          <div className="flex items-center gap-2.5"><BrandMark className="hidden size-9 lg:block" /><div><h1 className="font-bold">طيبة</h1><p className="hidden text-xs text-muted-foreground sm:block">{currentLabel}</p></div></div>
          <div className="ms-auto flex items-center gap-2"><span className="hidden text-xs text-muted-foreground lg:block">{today}</span><div className="hidden rounded-full bg-secondary px-3 py-1.5 text-xs sm:block"><b>{user.name}</b> <span className="text-muted-foreground">· {user.role === 'admin' ? 'مدير' : user.role === 'manager' ? 'مدير/محاسب' : 'كاشير'}</span></div><ThemeToggle /><Button variant="ghost" size="icon" onClick={onLogout} aria-label="تسجيل الخروج"><LogOut className="size-4" /></Button></div>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className="hidden w-60 shrink-0 border-s bg-sidebar/50 lg:block"><div className="sticky top-16 h-[calc(100dvh-4rem)] overflow-y-auto"><NavList user={user} /></div></aside>
        <main className="min-w-0 flex-1"><div className={cn('mx-auto w-full max-w-7xl p-4 lg:p-8', activeSection === 'sales' && 'max-w-none p-0 lg:p-8')}><SectionRenderer section={activeSection} user={user} /></div></main>
      </div>
      <footer className={cn('border-t py-3 text-center text-xs text-muted-foreground', activeSection === 'sales' && 'hidden lg:block')}>© {new Date().getFullYear()} طيبة — نظام إدارة المحلات</footer>
    </div>
  )
}
