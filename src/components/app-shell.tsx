'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun, Menu, TrendingUp, ShoppingCart, Package, Users, User, BarChart3, RefreshCw, LayoutDashboard, LogOut, RotateCcw, Banknote, Settings, FileClock, ClipboardList } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useAppStore, type SectionKey } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'
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
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
  group: 'operations' | 'inventory' | 'people' | 'management'
}

const GROUP_LABELS = {
  operations: 'التشغيل',
  inventory: 'المخزون',
  people: 'العملاء والموردون',
  management: 'الإدارة والتقارير',
} as const

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['admin', 'manager', 'cashier'], group: 'operations' },
  { key: 'sales', label: 'نقطة البيع', icon: TrendingUp, roles: ['admin', 'manager', 'cashier'], group: 'operations' },
  { key: 'products', label: 'المنتجات والمخزون', icon: Package, roles: ['admin', 'manager', 'cashier'], group: 'inventory' },
  { key: 'purchases', label: 'المشتريات', icon: ShoppingCart, roles: ['admin', 'manager'], group: 'inventory' },
  { key: 'returns', label: 'المرتجعات', icon: RotateCcw, roles: ['admin', 'manager', 'cashier'], group: 'operations' },
  { key: 'suppliers', label: 'الموردين', icon: Users, roles: ['admin', 'manager'], group: 'people' },
  { key: 'customers', label: 'العملاء', icon: User, roles: ['admin', 'manager', 'cashier'], group: 'people' },
  { key: 'register', label: 'الورديات والكاش', icon: Banknote, roles: ['admin', 'manager', 'cashier'], group: 'operations' },
  { key: 'stock-adjustments', label: 'تعديلات المخزون', icon: ClipboardList, roles: ['admin', 'manager'], group: 'inventory' },
  { key: 'reports', label: 'التقارير', icon: BarChart3, roles: ['admin', 'manager'], group: 'management' },
  { key: 'sync', label: 'المزامنة', icon: RefreshCw, roles: ['admin', 'manager'], group: 'management' },
  { key: 'audit', label: 'سجل العمليات', icon: FileClock, roles: ['admin'], group: 'management' },
  { key: 'users', label: 'المستخدمين', icon: Users, roles: ['admin'], group: 'management' },
  { key: 'settings', label: 'الإعدادات', icon: Settings, roles: ['admin'], group: 'management' },
]

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="size-9" />
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="تبديل السمة"
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}

function BrandMark({ className }: { className?: string }) {
  return (
    <img src="/favicon.svg" alt="طيبة" className={className} />
  )
}

function NavList({ user, onNavigate }: { user: SessionUser; onNavigate?: () => void }) {
  const activeSection = useAppStore((s) => s.activeSection)
  const setSection = useAppStore((s) => s.setSection)
  const items = NAV_ITEMS.filter((i) => i.roles.includes(user.role))
  const groups = (Object.keys(GROUP_LABELS) as NavItem['group'][]).map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0)

  return (
    <nav className="space-y-4 p-3" aria-label="القائمة الرئيسية">
      {groups.map(({ group, items: groupItems }) => (
        <div key={group}>
          <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            {GROUP_LABELS[group]}
          </p>
          <div className="space-y-0.5">
            {groupItems.map((item) => {
              const Icon = item.icon
              const active = activeSection === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setSection(item.key)
                    onNavigate?.()
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

function SectionRenderer({ section }: { section: SectionKey }) {
  switch (section) {
    case 'dashboard': return <DashboardSection />
    case 'products': return <ProductsSection />
    case 'purchases': return <PurchasesSection />
    case 'sales': return <SalesSection />
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

interface AppShellProps {
  user: SessionUser
  onLogout: () => void
}

export function AppShell({ user, onLogout }: AppShellProps) {
  const activeSection = useAppStore((s) => s.activeSection)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [today, setToday] = useState('')
  useEffect(() => {
    setToday(new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))
  }, [])

  const currentLabel = NAV_ITEMS.find((n) => n.key === activeSection)?.label || 'لوحة التحكم'

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Minimal sticky header — hidden on mobile/tablet while the POS screen (which has its own header) is active */}
      <header className={cn('sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl', activeSection === 'sales' && 'hidden lg:block')}>
        <div className="flex h-16 items-center gap-3 px-4 lg:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="فتح القائمة">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-0">
              <SheetTitle className="sr-only">القائمة الجانبية</SheetTitle>
              <div className="flex h-16 items-center gap-2.5 border-b px-4">
                <BrandMark className="size-9" />
                <div>
                  <p className="font-bold leading-tight">طيبة</p>
                  <p className="text-[10px] text-muted-foreground">نقطة البيع</p>
                </div>
              </div>
              <NavList user={user} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex items-center gap-2.5">
            <BrandMark className="size-9 hidden lg:block" />
            <div className="flex flex-col">
              <h1 className="text-base font-bold leading-tight">طيبة</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">{currentLabel}</p>
            </div>
          </div>

          <div className="ms-auto flex items-center gap-2">
            <span className="hidden rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex">
              POS
            </span>
            <span className="hidden text-xs text-muted-foreground lg:block">{today}</span>
            <div className="hidden items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs sm:flex">
              <span className="font-semibold">{user.name}</span>
              <span className="text-muted-foreground">
                {user.role === 'admin' ? 'مدير عام' : user.role === 'manager' ? 'محاسب' : 'كاشير'}
              </span>
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={onLogout} aria-label="تسجيل الخروج">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-s bg-sidebar/50 lg:block">
          <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
            <NavList user={user} />
            <div className="px-4 pb-4">
              <div className="rounded-xl border bg-card/50 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <BrandMark className="size-5" />
                  <p className="font-semibold">طيبة v3.0</p>
                </div>
                <p className="mt-1.5 text-muted-foreground leading-relaxed">
                  بياناتك محفوظة محليًا مع نسخ احتياطي عبر Google Sheets.
                </p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cn('mx-auto w-full max-w-7xl p-4 lg:p-8', activeSection === 'sales' && 'max-w-none p-0 lg:mx-auto lg:max-w-7xl lg:p-8')}
            >
              <SectionRenderer section={activeSection} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <footer className={cn('mt-auto border-t bg-background py-4', activeSection === 'sales' && 'hidden lg:block')}>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row lg:px-6">
          <p>© {new Date().getFullYear()} طيبة — نظام إدارة المحلات</p>
          <p>مسجل الدخول: {user.name}</p>
        </div>
      </footer>
    </div>
  )
}
