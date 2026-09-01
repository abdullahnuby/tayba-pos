import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sale = await db.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      user: { select: { name: true, username: true } },
      items: { include: { variant: { include: { product: true } } } },
      returns: { include: { items: { include: { variant: { include: { product: true } } } } } },
      customerPayments: true,
    },
  })
  if (!sale) return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 })
  return NextResponse.json(sale)
}

/**
 * PATCH supports:
 *  - { action: 'void', voidReason } — void a completed sale (revert stock, revert customer balance)
 *  - { action: 'resume' } — convert draft → completed (decrement stock, apply balance)
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await getCurrentUser()
    const body = await req.json()
    const { action, voidReason } = body

    const sale = await db.sale.findUnique({
      where: { id },
      include: { items: true },
    })
    if (!sale) return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 })

    if (action === 'void') {
      if (sale.status !== 'completed') {
        return NextResponse.json({ error: 'يمكن إلغاء الفواتير المكتملة فقط' }, { status: 400 })
      }
      // Atomic on the Sheets side: stock restore + customer balance revert + status change
      // all happen inside one locked action with snapshot/rollback, instead of three
      // separate uncoordinated calls that could partially fail.
      const updated = await atomicAction('void_sale', { payload: { saleId: id, voidReason: voidReason || 'إلغاء بدون سبب' } })
      await auditLog({ user, action: 'void', entity: 'sale', entityId: id, before: { status: sale.status }, after: { status: 'voided', voidReason } })
      return NextResponse.json(updated)
    }

    if (action === 'resume') {
      if (sale.status !== 'draft') {
        return NextResponse.json({ error: 'يمكن استئناف الفواتير المسودة فقط' }, { status: 400 })
      }
      // Stock check + decrement + balance update happen atomically under one lock on the
      // Sheets side, closing the race window where two resumes could both pass a stock
      // check taken in a separate, earlier request.
      const updated = await atomicAction('resume_sale', { payload: { saleId: id } }).catch((e: unknown) => {
        const err = e as { message?: string }
        throw new Error(err.message || 'تعذر استئناف الفاتورة')
      })
      await auditLog({ user, action: 'update', entity: 'sale', entityId: id, before: { status: 'draft' }, after: { status: 'completed' } })
      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await getCurrentUser()
    const sale = await db.sale.findUnique({ where: { id }, include: { items: true } })
    if (!sale) return NextResponse.json({ error: 'غير موجودة' }, { status: 404 })
    if (sale.status === 'completed') {
      return NextResponse.json({ error: 'لا يمكن حذف فاتورة مكتملة — استخدم إلغاء (void)' }, { status: 400 })
    }
    await db.sale.delete({ where: { id } })
    await auditLog({ user, action: 'delete', entity: 'sale', entityId: id, before: { invoiceNo: sale.invoiceNo } })
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
