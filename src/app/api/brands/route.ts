import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

  const brands = await db.brand.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(brands)
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { name } = await req.json()
  if (!name) return NextResponse.json({ error: 'الاسم مطلوب' }, { status: 400 })
  const brand = await db.brand.create({ data: { name } })
  return NextResponse.json(brand, { status: 201 })
}
