/** Format helpers — Arabic-friendly number formatting. */

/** Format currency — Western Arabic numerals (0-9) for clarity in receipts. */
export function formatEGP(value: number | undefined | null): string {
  if (value == null) return '0'
  const n = Number(value)
  if (!isFinite(n)) return '0'
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** Format with Egyptian Pound suffix. */
export function formatMoney(value: number | undefined | null): string {
  return `${formatEGP(value)} ج.م`
}

/** Format currency for Arabic-Indic display (٠-٩). */
export function formatEGPArabic(value: number | undefined | null): string {
  if (value == null) return '٠'
  const n = Number(value)
  if (!isFinite(n)) return '٠'
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function todayISO(): string {
  // Use local date to avoid timezone shifting the day
  const d = new Date()
  const tzOffset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10)
}

export function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const tzOffset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10)
}

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cash', label: 'نقدي' },
  { value: 'card', label: 'بطاقة' },
  { value: 'transfer', label: 'تحويل' },
  { value: 'credit', label: 'آجل' },
]

export function paymentMethodLabel(value: string): string {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label || value
}

export const SALES_STATUSES: { value: string; label: string; color: string }[] = [
  { value: 'draft', label: 'مسودة (معلّقة)', color: 'secondary' },
  { value: 'completed', label: 'مكتملة', color: 'default' },
  { value: 'voided', label: 'ملغاة', color: 'destructive' },
  { value: 'returned', label: 'مُرتجعة', color: 'outline' },
  { value: 'partial_return', label: 'مرتجع جزئي', color: 'outline' },
]

export function saleStatusLabel(value: string): string {
  return SALES_STATUSES.find((s) => s.value === value)?.label || value
}

export function saleStatusBadgeVariant(value: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const found = SALES_STATUSES.find((s) => s.value === value)
  if (!found) return 'outline'
  if (found.color === 'destructive') return 'destructive'
  if (found.color === 'secondary') return 'secondary'
  if (found.color === 'default') return 'default'
  return 'outline'
}

export const STOCK_ADJUSTMENT_TYPES: { value: string; label: string; sign: 'in' | 'out' | 'either' }[] = [
  { value: 'damage', label: 'تالف', sign: 'out' },
  { value: 'theft', label: 'مسروق', sign: 'out' },
  { value: 'stocktake', label: 'جرد', sign: 'either' },
  { value: 'sample', label: 'عينة', sign: 'out' },
  { value: 'transfer_in', label: 'تحويل وارد', sign: 'in' },
  { value: 'transfer_out', label: 'تحويل صادر', sign: 'out' },
  { value: 'adjustment', label: 'تعديل يدوي', sign: 'either' },
]

export function stockAdjustmentTypeLabel(value: string): string {
  return STOCK_ADJUSTMENT_TYPES.find((t) => t.value === value)?.label || value
}

export const USER_ROLES: { value: string; label: string }[] = [
  { value: 'admin', label: 'مدير عام' },
  { value: 'manager', label: 'محاسب / مدير' },
  { value: 'cashier', label: 'كاشير' },
]

export function roleLabel(value: string): string {
  return USER_ROLES.find((r) => r.value === value)?.label || value
}
