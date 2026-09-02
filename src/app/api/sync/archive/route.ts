import { NextResponse } from 'next/server'
import { archiveLocalDatabase } from '@/lib/archive'
import { authenticate } from '@/lib/auth-middleware'

export async function POST(req: Request) {
  const auth = await authenticate(req as any, {
    roles: ['admin', 'manager'],
    rateLimitScope: 'sync',
  })
  if (auth instanceof Response) return auth

  try {
    return NextResponse.json(await archiveLocalDatabase())
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'فشل أرشفة قاعدة البيانات' },
      { status: 500 }
    )
  }
}
