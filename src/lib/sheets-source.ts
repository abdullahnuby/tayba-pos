import { cacheGet, cachePut, cacheDelete } from '@/lib/cloudflare/cache'

export type SheetRow = Record<string, unknown>
export type SheetsRequest = {
  action: 'ping' | 'read' | 'read_many' | 'insert' | 'upsert' | 'update' | 'delete' | 'batch'
  token?: string
  sheet?: string
  key?: string
  value?: unknown
  rows?: SheetRow[]
  operations?: SheetsRequest[]
}

export type SheetsResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
}

type CloudflareRuntimeEnv = Record<string, unknown>

async function getConfig() {
  let runtime: CloudflareRuntimeEnv = {}

  try {
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)'
    ) as (specifier: string) => Promise<{ env?: CloudflareRuntimeEnv }>

    runtime = (await dynamicImport('cloudflare:workers')).env ?? {}
  } catch {
    // Local/Node fallback.
  }

  const url =
    String(runtime.GOOGLE_APPS_SCRIPT_URL ?? '') ||
    process.env.GOOGLE_APPS_SCRIPT_URL ||
    ''

  const token =
    String(runtime.GOOGLE_APPS_SCRIPT_TOKEN ?? '') ||
    process.env.GOOGLE_APPS_SCRIPT_TOKEN ||
    ''

  if (!url) throw new Error('GOOGLE_APPS_SCRIPT_URL is not configured')
  if (!token) throw new Error('GOOGLE_APPS_SCRIPT_TOKEN is not configured')

  return { url, token }
}

async function callSheets<T>(request: SheetsRequest): Promise<T> {
  const { url, token } = await getConfig()

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ ...request, token }),
  })

  const body = (await res.json().catch(() => ({}))) as SheetsResponse<T>

  if (!res.ok || !body.ok) {
    throw new Error(body.error || `Google Apps Script HTTP ${res.status}`)
  }

  return body.data as T
}

export async function sheetsPing() {
  return callSheets<{ timestamp: string }>({ action: 'ping' })
}

export async function sheetsRead(
  sheet: string,
  options?: {
    cacheKey?: string
    ttlSeconds?: number
    force?: boolean
  }
) {
  const cacheKey = options?.cacheKey || `tayba:sheet:${sheet}`

  if (!options?.force) {
    const cached = await cacheGet<SheetRow[]>(cacheKey)
    if (cached) return cached
  }

  const rows = await callSheets<SheetRow[]>({
    action: 'read',
    sheet,
  })

  await cachePut(cacheKey, rows, options?.ttlSeconds)
  return rows
}

export async function sheetsReadMany(
  sheets: string[],
  force = false
) {
  const result = await Promise.all(
    sheets.map((sheet) =>
      sheetsRead(sheet, { force })
    )
  )

  return Object.fromEntries(
    sheets.map((sheet, i) => [
      sheet,
      result[i],
    ])
  )
}

export async function sheetsWriteThrough(
  operations: SheetsRequest[]
) {
  const result = await callSheets<{
    results: unknown[]
  }>({
    action: 'batch',
    operations,
  })

  for (const op of operations) {
    if (op.sheet) {
      await cacheDelete(
        `tayba:sheet:${op.sheet}`
      )
    }
  }

  return result
}

export async function sheetsInvalidate(
  sheet: string
) {
  await cacheDelete(
    `tayba:sheet:${sheet}`
  )
}