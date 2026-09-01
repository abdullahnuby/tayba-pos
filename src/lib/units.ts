export type UnitCode = 'piece' | 'quarter-dozen' | 'half-dozen' | 'dozen' | 'pair' | 'pack' | 'box' | 'meter' | 'kg' | 'liter'

export const UNITS: { code: UnitCode; label: string; short: string; defaultFactor: number }[] = [
  { code: 'piece', label: 'قطعة', short: 'قطعة', defaultFactor: 1 },
  { code: 'quarter-dozen', label: 'ربع دستة', short: 'ربع دستة', defaultFactor: 3 },
  { code: 'half-dozen', label: 'نص دستة', short: 'نص دستة', defaultFactor: 6 },
  { code: 'dozen', label: 'دستة', short: 'دستة', defaultFactor: 12 },
  { code: 'pair', label: 'زوج', short: 'زوج', defaultFactor: 2 },
  { code: 'pack', label: 'باك', short: 'باك', defaultFactor: 6 },
  { code: 'box', label: 'كرتونة', short: 'كرتونة', defaultFactor: 24 },
  { code: 'meter', label: 'متر', short: 'م', defaultFactor: 1 },
  { code: 'kg', label: 'كيلو', short: 'كجم', defaultFactor: 1 },
  { code: 'liter', label: 'لتر', short: 'لتر', defaultFactor: 1 },
]

export const UNIT_MAP = Object.fromEntries(UNITS.map((u) => [u.code, u])) as Record<UnitCode, typeof UNITS[number]>

export function unitLabel(code?: string | null) {
  return UNIT_MAP[code as UnitCode]?.label || code || 'قطعة'
}

export function unitShort(code?: string | null) {
  return UNIT_MAP[code as UnitCode]?.short || code || 'قطعة'
}
