import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { id } = await params
  const purchase = await db.purchase.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { include: { variant: { include: { product: true } } } },
      returns: { include: { items: { include: { variant: { include: { product: true } } } } } },
      supplierPayments: true,
    },
  })
  if (!purchase) return NextResponse.json({ error: 'غير موجودة' }, { status: 404 })
  return NextResponse.json(purchase)
}

/**
 * PATCH supports:
 *  - { action: 'void', voidReason } — void a completed purchase (revert stock added by it,
 *    revert supplier balance). Blocked if any of the stock it added has already been sold
 *    below what would remain, so a purchase can't be un-done out from under live sales.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'] })
  if (auth instanceof Response) return auth

  const { id } = await params
  try {
    const user = await getCurrentUser()
    const body = await req.json()
    const { action, voidReason } = body

    const purchase = await db.purchase.findUnique({ where: { id } })
    if (!purchase) return NextResponse.json({ error: 'غير موجودة' }, { status: 404 })

    if (action === 'void') {
      if (purchase.status !== 'completed') {
        return NextResponse.json({ error: 'يمكن إلغاء فواتير الشراء المكتملة فقط' }, { status: 400 })
      }
      const updated = await atomicAction('void_purchase', { payload: { purchaseId: id, voidReason: voidReason || 'إلغاء بدون سبب' } })
      await auditLog({ user, action: 'void', entity: 'purchase', entityId: id, before: { status: purchase.status }, after: { status: 'voided', voidReason } })
      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 })
  } catch (e: unknown) {
    const err = e as { message?: string }
    return NextResponse.json({ error: err.message || 'خطأ' }, { status: 500 })
  }
}
