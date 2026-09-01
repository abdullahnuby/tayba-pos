import { db } from '@/lib/db'

export async function getSetting(key: string): Promise<string | null> {
  const s = await db.setting.findUnique({ where: { key } })
  return s?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

export interface GoogleConfig {
  clientEmail: string
  privateKey: string
  spreadsheetId: string
}

export async function getGoogleConfig(): Promise<GoogleConfig | null> {
  const [clientEmail, privateKey, spreadsheetId] = await Promise.all([
    getSetting('googleClientEmail'),
    getSetting('googlePrivateKey'),
    getSetting('googleSpreadsheetId'),
  ])
  if (!clientEmail || !privateKey || !spreadsheetId) return null
  return { clientEmail, privateKey, spreadsheetId }
}
