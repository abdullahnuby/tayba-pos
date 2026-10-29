import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: 'سجل العمليات متاح للمدير العام فقط' }, { status: 403 })

  const url = new URL(req.url)
  const entity = url.searchParams.get('entity')
  const action = url.searchParams.get('action')
  const requestedLimit = Number(url.searchParams.get('limit') || '100')
  const limit = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100))

  const where: {
    entity?: string
    action?: string
  } = {}
  if (entity) where.entity = entity
  if (action) where.action = action

  const logs = await db.auditLog.findMany({
    where,
    include: { user: { select: { name: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({ items: logs })
}
