import { db } from './db'
import { hashPassword, verifyPassword } from './auth'

const PIN_PREFIX = 'cashierPin:'

function normalizePin(pin: string): string {
  return String(pin || '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

export function validateCashierPin(pin: string): { ok: boolean; pin?: string; error?: string } {
  const normalized = normalizePin(pin)
  if (!/^[0-9]{2,6}$/.test(normalized)) {
    return { ok: false, error: 'PIN الوردية يجب أن يكون من رقمين إلى 6 أرقام فقط' }
  }
  return { ok: true, pin: normalized }
}

export async function hasCashierPin(userId: string): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: `${PIN_PREFIX}${userId}` } })
  return Boolean(row?.value)
}

export async function verifyCashierPin(userId: string, pin: string): Promise<boolean> {
  const validation = validateCashierPin(pin)
  if (!validation.ok || !validation.pin) return false

  const row = await db.setting.findUnique({ where: { key: `${PIN_PREFIX}${userId}` } })
  if (!row?.value) return false

  return verifyPassword(validation.pin, row.value)
}

export async function setCashierPin(userId: string, pin: string): Promise<void> {
  const validation = validateCashierPin(pin)
  if (!validation.ok || !validation.pin) {
    throw new Error(validation.error || 'PIN غير صحيح')
  }

  await db.setting.upsert({
    where: { key: `${PIN_PREFIX}${userId}` },
    update: { value: hashPassword(validation.pin) },
    create: { key: `${PIN_PREFIX}${userId}`, value: hashPassword(validation.pin) },
  })
}
