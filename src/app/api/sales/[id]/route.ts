import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  const sale = await db.sale.findUnique({ where: { id }, include: { customer: true, user: { select: { name: true, username: true } }, items: { include: { variant: { include: { product: true } } } }, returns: { include: { items: true } }, customerPayments: true } })
  if (!sale) return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 })
  if (user.role === 'cashier' && sale.userId !== user.id) return NextResponse.json({ error: 'لا تملك صلاحية هذه الفاتورة' }, { status: 403 })
  return NextResponse.json(sale)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const body = await req.json()
    const sale = await db.sale.findUnique({ where: { id }, include: { items: true } })
    if (!sale) return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 })
    if (user.role === 'cashier' && sale.userId !== user.id) return NextResponse.json({ error: 'لا تملك صلاحية هذه الفاتورة' }, { status: 403 })
    if (body.action === 'void') {
      if (user.role === 'cashier') return NextResponse.json({ error: 'الكاشير لا يملك إلغاء الفواتير' }, { status: 403 })
      if (sale.status !== 'completed') return NextResponse.json({ error: 'يمكن إلغاء الفواتير المكتملة فقط' }, { status: 400 })
      const updated = await atomicAction('void_sale', { payload: { saleId: id, voidReason: body.voidReason || 'إلغاء بدون سبب' } })
      await auditLog({ user, action: 'void', entity: 'sale', entityId: id, before: { status: sale.status }, after: { status: 'voided' } })
      return NextResponse.json(updated)
    }
    if (body.action === 'resume') {
      if (sale.status !== 'draft') return NextResponse.json({ error: 'يمكن استئناف الفواتير المسودة فقط' }, { status: 400 })
      const updated = await atomicAction('resume_sale', { payload: { saleId: id } })
      await auditLog({ user, action: 'update', entity: 'sale', entityId: id, before: { status: 'draft' }, after: { status: 'completed' } })
      return NextResponse.json(updated)
    }
    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 })
  } catch (e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 }) }
}
