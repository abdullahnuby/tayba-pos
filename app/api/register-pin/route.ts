import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, requireUser } from '@/lib/auth'
import { hasCashierPin, setCashierPin, validateCashierPin } from '@/lib/cashier-pin'
import { auditLog } from '@/lib/audit'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    return NextResponse.json({
      role: user.role,
      hasPin: user.role === 'cashier' ? await hasCashierPin(user.id) : false,
    })
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: 'خطأ' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(['cashier'])
    const body = await req.json()
    const validation = validateCashierPin(String(body.pin || ''))

    if (!validation.ok || !validation.pin) {
      return NextResponse.json({ error: validation.error || 'PIN غير صحيح' }, { status: 400 })
    }

    const confirm = validateCashierPin(String(body.confirmPin || ''))
    if (!confirm.ok || !confirm.pin || confirm.pin !== validation.pin) {
      return NextResponse.json({ error: 'تأكيد PIN غير مطابق' }, { status: 400 })
    }

    await setCashierPin(user.id, validation.pin)
    await auditLog({
      user,
      action: 'register_pin_set',
      entity: 'user',
      entityId: user.id,
      after: { pinConfigured: true },
    })

    return NextResponse.json({ ok: true, hasPin: true })
  } catch (e) {
    if (e instanceof Response) return e
    return NextResponse.json({ error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 })
  }
}
