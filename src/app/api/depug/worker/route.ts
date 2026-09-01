/**
 * TEMPORARY diagnostic endpoint for Cloudflare Worker runtime failures.
 * Returns only sanitized runtime/configuration information.
 */

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Unknown Error'
  return String(error)
}

export async function GET() {
  const result: Record<string, unknown> = {
    ok: true,
    timestamp: new Date().toISOString(),
    runtime: 'worker-diagnostic',
    checks: {},
  }

  const checks = result.checks as Record<string, unknown>

  try {
    checks.runtime = {
      ok: true,
      hasProcess: typeof process !== 'undefined',
      hasGlobalThis: typeof globalThis !== 'undefined',
      hasFetch: typeof fetch === 'function',
    }
  } catch (error) {
    checks.runtime = {
      ok: false,
      error: errorMessage(error),
    }
  }

  try {
    checks.environment = {
      ok: true,
      googleAppsScriptUrl: Boolean(process?.env?.GOOGLE_APPS_SCRIPT_URL),
      googleAppsScriptToken: Boolean(process?.env?.GOOGLE_APPS_SCRIPT_TOKEN),
      authSecret: Boolean(process?.env?.AUTH_SECRET),
      nodeEnv: process?.env?.NODE_ENV || 'unknown',
    }
  } catch (error) {
    checks.environment = {
      ok: false,
      error: errorMessage(error),
    }
  }

  try {
    const started = Date.now()
    const { db } = await import('@/lib/db')
    const count = await db.user.count()

    checks.db = {
      ok: true,
      userCount: Number(count),
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    checks.db = {
      ok: false,
      error: errorMessage(error),
    }
  }

  try {
    const started = Date.now()
    const auth = await import('@/lib/auth')

    checks.auth = {
      ok: true,
      exports: {
        verifySessionToken: typeof auth.verifySessionToken === 'function',
        createSessionToken: typeof auth.createSessionToken === 'function',
        getCurrentUser: typeof auth.getCurrentUser === 'function',
      },
      authSecretConfigured: Boolean(
        process?.env?.AUTH_SECRET
      ),
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    checks.auth = {
      ok: false,
      error: errorMessage(error),
    }
  }

  try {
    const started = Date.now()
    const { sheetsPing } = await import('@/lib/sheets-source')
    const ping = await sheetsPing()

    checks.googleSheets = {
      ok: true,
      response: ping,
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    checks.googleSheets = {
      ok: false,
      error: errorMessage(error),
    }
  }

  try {
    const started = Date.now()
    const { cachePut, cacheGet } =
      await import('@/lib/cloudflare/cache')

    const key = `tayba:debug:${Date.now()}`

    await cachePut(key, { ok: true }, 30)

    const value =
      await cacheGet<{ ok: boolean }>(key)

    checks.cache = {
      ok: value?.ok === true,
      roundTrip: value?.ok === true,
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    checks.cache = {
      ok: false,
      error: errorMessage(error),
    }
  }

  const failedChecks = Object.entries(checks)
    .filter(([, value]) => {
      return (
        Boolean(
          value &&
          typeof value === 'object' &&
          'ok' in value &&
          !(value as { ok?: boolean }).ok
        )
      )
    })
    .map(([name]) => name)

  result.failedChecks = failedChecks
  result.ok = failedChecks.length === 0

  return Response.json(result, {
    status: result.ok ? 200 : 500,
    headers: {
      'cache-control':
        'no-store, no-cache, must-revalidate',
      'content-type':
        'application/json; charset=utf-8',
    },
  })
}