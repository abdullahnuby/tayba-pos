import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await authenticate(req, { skipRateLimit: true })
  if (auth instanceof Response) return auth

  const categories = await db.category.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { products: true } } },
  })
  return NextResponse.json(categories)
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const { name } = body
    if (!name) return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 })
    const cat = await db.category.create({ data: { name } })
    return NextResponse.json(cat, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'التصنيف موجود بالفعل' }, { status: 400 })
    }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
