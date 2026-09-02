import { db } from './db'
import { hashPassword, verifyPassword } from './auth'

const PIN_PREFIX = 'cashierPin:'

function normalizeDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

export function normalizePin(value: string) {
  return normalizeDigits(String(value ?? '')).trim()
}

export function validatePin(value: string) {
  const pin = normalizePin(value)
  if (!/^\d{2,6}$/.test(pin)) {
    throw new Error('PIN يجب أن يكون من رقمين إلى 6 أرقام')
  }
  return pin
}

export async function hasCashierPin(userId: string) {
  const setting = await db.setting.findUnique({
    where: { key: `${PIN_PREFIX}${userId}` },
  })
  return Boolean(setting?.value)
}

export async function verifyCashierPin(userId: string, value: string) {
  const pin = validatePin(value)
  const setting = await db.setting.findUnique({
    where: { key: `${PIN_PREFIX}${userId}` },
  })
  if (!setting?.value) return false
  return verifyPassword(pin, setting.value)
}

export async function setCashierPin(userId: string, value: string) {
  const pin = validatePin(value)
  const passwordHash = await hashPassword(pin)

  await db.setting.upsert({
    where: { key: `${PIN_PREFIX}${userId}` },
    create: { key: `${PIN_PREFIX}${userId}`, value: passwordHash },
    update: { value: passwordHash },
  })
}
