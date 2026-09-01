import { NextResponse } from 'next/server'
import { sheetsPing } from '@/lib/sheets-source'
import { cachePut, cacheGet } from '@/lib/cloudflare/cache'

export const runtime = 'edge'

export async function GET() {
  const started = Date.now()
  try {
    const google = await sheetsPing()
    const probeKey = `tayba:health:${Date.now()}`
    await cachePut(probeKey, { ok: true }, 30)
    const cache = await cacheGet<{ ok: boolean }>(probeKey)
    return NextResponse.json({
      ok: true,
      sourceOfTruth: 'google-sheets',
      googleAppsScript: google,
      cloudflareCache: !!cache?.ok,
      latencyMs: Date.now() - started,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      sourceOfTruth: 'google-sheets',
      error: error instanceof Error ? error.message : 'Infrastructure check failed',
      latencyMs: Date.now() - started,
    }, { status: 503 })
  }
}
