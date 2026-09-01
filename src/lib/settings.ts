/**
 * Settings helpers — typed read/write of store-wide settings.
 * Caches reads but supports an in-transaction variant.
 */
import { db } from './db'

type Tx = Parameters<Parameters<typeof db['$transaction']>[0]>[0]

const cache = new Map<string, string>()

export async function getSetting(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key)!
  const row = await db.setting.findUnique({ where: { key } })
  const val = row?.value ?? null
  if (val !== null) cache.set(key, val)
  return val
}

/** Get setting inside a transaction (uses tx client). */
export async function getSettingTx(tx: Tx, key: string): Promise<string | null> {
  const row = await tx.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function getSettingNumber(key: string, fallback = 0): Promise<number> {
  const v = await getSetting(key)
  const n = Number(v)
  return isNaN(n) ? fallback : n
}

export async function getSettingNumberTx(tx: Tx, key: string, fallback = 0): Promise<number> {
  const v = await getSettingTx(tx, key)
  const n = Number(v)
  return isNaN(n) ? fallback : n
}

export async function getSettingBool(key: string, fallback = false): Promise<boolean> {
  const v = await getSetting(key)
  if (v === null) return fallback
  return v === 'true' || v === '1' || v === 'yes'
}

export async function getSettingBoolTx(tx: Tx, key: string, fallback = false): Promise<boolean> {
  const v = await getSettingTx(tx, key)
  if (v === null) return fallback
  return v === 'true' || v === '1' || v === 'yes'
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
  cache.set(key, value)
}

export async function setSettings(dict: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(dict)) {
    await setSetting(k, v)
  }
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany()
  const dict: Record<string, string> = {}
  for (const r of rows) dict[r.key] = r.value
  return dict
}

/**
 * Atomic counter — MUST be called inside a transaction to be truly atomic.
 * Uses an Apps Script/Sheets upsert under the script write lock.
 * Returns the next invoice number with prefix.
 */
export async function nextInvoiceNumber(
  tx: Tx,
  kind: 'sale' | 'purchase' | 'return'
): Promise<string> {
  const counterKey = kind === 'sale' ? 'saleCounter' : kind === 'purchase' ? 'purchaseCounter' : 'returnCounter'
  const prefixKey = kind === 'sale' ? 'saleInvoicePrefix' : kind === 'purchase' ? 'purchaseInvoicePrefix' : 'returnPrefix'

  const prefix = await getSettingTx(tx, prefixKey)
  const counterRow = await tx.setting.findUnique({ where: { key: counterKey } })
  const next = (counterRow ? Number(counterRow.value) + 1 : 1)

  const updated = await tx.setting.upsert({
    where: { key: counterKey },
    update: { value: String(next) },
    create: { key: counterKey, value: String(next) },
  })
  // Cache update (best-effort — doesn't affect tx)
  cache.set(counterKey, String(next))
  void updated
  return `${prefix || 'INV'}-${String(next).padStart(6, '0')}`
}

export function clearSettingsCache() {
  cache.clear()
}
