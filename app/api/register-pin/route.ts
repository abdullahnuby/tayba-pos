import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { hasCashierPin, setCashierPin, validatePin } from '@/lib/cashier-pin'
import { db } from '@/lib/db'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const role = String(user.role ?? '').toLowerCase()
  const isCashier = role === 'cashier' || role === 'كاشير'

  return NextResponse.json({
    role: user.role,
    isCashier,
    hasPin: isCashier ? await hasCashierPin(user.id) : false,
  })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const role = String(user.role ?? '').toLowerCase()
  const isCashier = role === 'cashier' || role === 'كاشير'
  if (!isCashier) {
    return NextResponse.json({ error: 'هذه العملية متاحة للكاشير فقط' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const pin = validatePin(body.pin)
    const confirmPin = validatePin(body.confirmPin)

    if (pin !== confirmPin) {
      return NextResponse.json({ error: 'تأكيد PIN غير مطابق' }, { status: 400 })
    }

    await setCashierPin(user.id, pin)

    await db.auditLog.create({
      data: {
        action: 'register_pin_set',
        userId: user.id,
        details: 'Cashier register PIN was set/changed',
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'تعذر حفظ PIN' }, { status: 400 })
  }
}
