import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const url = new URL(req.url)
  const variantId = url.searchParams.get('variantId') || ''
  const type = url.searchParams.get('type') || ''
  const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize') || '100')))

  const where: Record<string, unknown> = {}
  if (variantId) where.variantId = variantId
  if (type && type !== 'all') where.type = type

  const [items, total] = await Promise.all([
    db.stockLedger.findMany({
      where,
      include: { variant: { include: { product: true } }, user: { select: { name: true } } },
      orderBy: { date: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.stockLedger.count({ where }),
  ])

  return NextResponse.json({ items, total, page, pageSize })
}
