import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth-middleware'
import { testAppsScriptConnection } from '@/lib/sync'
import { z } from 'zod'

const schema = z.object({
  url: z.string().url('رابط غير صحيح'),
})

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, message: parsed.error.issues[0]?.message || 'رابط غير صحيح' },
        { status: 400 }
      )
    }

    const result = await testAppsScriptConnection(parsed.data.url)
    return NextResponse.json(result)
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json(
      { ok: false, message: err.message || 'خطأ غير متوقع' },
      { status: 500 }
    )
  }
}
