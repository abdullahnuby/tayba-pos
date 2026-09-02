/**
 * Google Sheets is the source of truth.
 *
 * Sync features:
 * - Warm/refresh the Cloudflare KV cache from Google Sheets.
 * - Verify the Google Apps Script gateway.
 * - Test an Apps Script URL independently from the configured URL.
 */

import { archiveLocalDatabase } from '@/lib/archive'
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
  const config = await getSyncConfig()
  const token = process.env.GOOGLE_APPS_SCRIPT_TOKEN || await getSetting('appsScriptToken')
  return config.method === 'apps_script' && Boolean(token)
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

export async function syncAllSheets() {
  return archiveLocalDatabase()
}

export async function syncAfterSale(
  customerId?: string | null
) {
  void customerId
}

export async function syncAfterPurchase(
  supplierId?: string | null
) {
  void supplierId
}

export async function syncAfterReturn(
  customerId?: string | null
) {
  void customerId
}

export async function syncAfterCustomerPayment() {
}

export async function syncAfterSupplierPayment() {
}

export async function syncAfterAdjustment() {
}

export async function syncAfterProduct() {
}

export async function getLastSyncAt() {
  const row = await db.setting.findUnique({
    where: {
      key: 'lastGoogleArchiveAt',
    },
  })

  return row?.value || null
}