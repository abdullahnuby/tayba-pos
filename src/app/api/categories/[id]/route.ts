import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { id } = await params
  try {
    const count = await db.product.count({ where: { categoryId: id } })
    if (count > 0) {
      return NextResponse.json({ error: 'لا يمكن حذف التصنيف لأنه يحتوي على منتجات' }, { status: 400 })
    }
    await db.category.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ في الحذف' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { id } = await params
  try {
    const body = await req.json()
    const cat = await db.category.update({ where: { id }, data: { name: body.name } })
    return NextResponse.json(cat)
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
