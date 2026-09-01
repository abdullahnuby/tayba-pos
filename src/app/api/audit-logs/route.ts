import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const entity = url.searchParams.get('entity')
  const action = url.searchParams.get('action')
  const limit = Number(url.searchParams.get('limit') || '100')

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
