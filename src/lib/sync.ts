/**
 * Google Sheets is the source of truth.
 *
 * Sync features:
 * - Warm/refresh the Cloudflare KV cache from Google Sheets.
 * - Verify the Google Apps Script gateway.
 * - Test an Apps Script URL independently from the configured URL.
 */

import { cacheDelete } from '@/lib/cloudflare/cache'
import { sheetsPing, sheetsRead } from '@/lib/sheets-source'
import { db } from '@/lib/db'

export interface SyncConfig {
  method: 'apps_script' | null
  appsScriptUrl?: string
}

export interface AppsScriptConnectionResult {
  ok: boolean
  message: string
  url?: string
  status?: number
  response?: unknown
}

function configuredAppsScriptUrl(): string {
  return process.env.GOOGLE_APPS_SCRIPT_URL || ''
}

export async function getSyncConfig(): Promise<SyncConfig> {
  const envUrl = configuredAppsScriptUrl()

  if (envUrl) {
    return {
      method: 'apps_script',
      appsScriptUrl: envUrl,
    }
  }

  const row = await db.setting.findUnique({
    where: { key: 'appsScriptUrl' },
  })

  return row?.value
    ? {
        method: 'apps_script',
        appsScriptUrl: row.value,
      }
    : {
        method: null,
      }
}

export async function isGoogleConfigured(): Promise<boolean> {
  return (await getSyncConfig()).method === 'apps_script'
}

/**
 * Test a Google Apps Script Web App URL.
 *
 * This function is intentionally independent from sheetsPing()
 * because the admin endpoint allows the administrator to test
 * a URL before saving/using it.
 */
export async function testAppsScriptConnection(
  url: string
): Promise<AppsScriptConnectionResult> {
  const normalizedUrl = url.trim()

  if (!normalizedUrl) {
    return {
      ok: false,
      message: 'رابط Google Apps Script مطلوب',
    }
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(normalizedUrl)
  } catch {
    return {
      ok: false,
      message: 'رابط Google Apps Script غير صحيح',
    }
  }

  if (parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      message: 'يجب أن يكون رابط Google Apps Script باستخدام HTTPS',
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
      },
    })

    const text = await response.text()

    let responseData: unknown = text

    try {
      responseData = text ? JSON.parse(text) : null
    } catch {
      // Apps Script may return plain text or HTML.
      responseData = text
    }

    if (!response.ok) {
      return {
        ok: false,
        message: `Google Apps Script رد بحالة HTTP ${response.status}`,
        url: parsedUrl.toString(),
        status: response.status,
        response: responseData,
      }
    }

    return {
      ok: true,
      message: 'تم الاتصال بـ Google Apps Script بنجاح',
      url: parsedUrl.toString(),
      status: response.status,
      response: responseData,
    }
  } catch (error: unknown) {
    const err = error as {
      name?: string
      message?: string
    }

    if (err?.name === 'AbortError') {
      return {
        ok: false,
        message: 'انتهت مهلة الاتصال بـ Google Apps Script بعد 10 ثوانٍ',
        url: parsedUrl.toString(),
      }
    }

    return {
      ok: false,
      message:
        err?.message ||
        'تعذر الاتصال بـ Google Apps Script',
      url: parsedUrl.toString(),
    }
  } finally {
    clearTimeout(timeout)
  }
}

const ALL_SHEETS = [
  'Settings',
  'Categories',
  'Brands',
  'Suppliers',
  'Customers',
  'Products',
  'Variants',
  'Purchases',
  'PurchaseItems',
  'Sales',
  'SaleItems',
  'SaleReturns',
  'SaleReturnItems',
  'CustomerPayments',
  'SupplierPayments',
  'StockAdjustments',
  'RegisterSessions',
  'AuditLog',
]

export async function syncSheets(
  sheetNames: string[]
): Promise<{
  ok: boolean
  synced: string[]
  errors: string[]
}> {
  const errors: string[] = []
  const synced: string[] = []

  try {
    await sheetsPing()
  } catch (e: unknown) {
    const err = e as { message?: string }

    return {
      ok: false,
      synced: [],
      errors: [
        err?.message ||
          'Google Apps Script unavailable',
      ],
    }
  }

  for (const name of sheetNames) {
    try {
      await cacheDelete(`tayba:sheet:${name}`)
      await sheetsRead(name, { force: true })
      synced.push(name)
    } catch (e: unknown) {
      const err = e as { message?: string }

      errors.push(
        `${name}: ${err?.message || 'read failed'}`
      )
    }
  }

  const now = new Date().toISOString()

  await db.setting.upsert({
    where: {
      key: 'lastGoogleSyncAt',
    },
    update: {
      value: now,
    },
    create: {
      key: 'lastGoogleSyncAt',
      value: now,
    },
  })

  return {
    ok: errors.length === 0,
    synced,
    errors,
  }
}

export async function syncAllSheets() {
  return syncSheets(ALL_SHEETS)
}

export async function syncAfterSale(
  customerId?: string | null
) {
  void customerId

  await syncSheets([
    'Sales',
    'SaleItems',
    'Customers',
  ])
}

export async function syncAfterPurchase(
  supplierId?: string | null
) {
  void supplierId

  await syncSheets([
    'Purchases',
    'PurchaseItems',
    'Variants',
    'Suppliers',
  ])
}

export async function syncAfterReturn(
  customerId?: string | null
) {
  void customerId

  await syncSheets([
    'SaleReturns',
    'SaleReturnItems',
    'Variants',
    'Sales',
    'Customers',
  ])
}

export async function syncAfterCustomerPayment() {
  await syncSheets([
    'CustomerPayments',
    'Customers',
  ])
}

export async function syncAfterSupplierPayment() {
  await syncSheets([
    'SupplierPayments',
    'Suppliers',
  ])
}

export async function syncAfterAdjustment() {
  await syncSheets([
    'StockAdjustments',
    'Variants',
  ])
}

export async function syncAfterProduct() {
  await syncSheets([
    'Products',
    'Variants',
  ])
}

export async function getLastSyncAt() {
  const row = await db.setting.findUnique({
    where: {
      key: 'lastGoogleSyncAt',
    },
  })

  return row?.value || null
}