import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

  const { id } = await params
  const customer = await db.customer.findUnique({
    where: { id },
    include: { sales: { include: { items: true }, orderBy: { date: 'desc' } } },
  })
  if (!customer) return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 })
  return NextResponse.json(customer)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

  const { id } = await params
  try {
    const body = await req.json()
    const data: Record<string, unknown> = {}
    for (const key of ['name', 'phone', 'address', 'notes']) {
      if (body[key] !== undefined) data[key] = body[key]
    }
    const customer = await db.customer.update({ where: { id }, data })
    return NextResponse.json(customer)
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { id } = await params
  try {
    await db.customer.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'P2003') {
      return NextResponse.json({ error: 'لا يمكن حذف العميل لأنه مرتبط بمبيعات' }, { status: 400 })
    }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
