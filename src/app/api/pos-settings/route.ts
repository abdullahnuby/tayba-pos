import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

/**
 * Only the values needed to price an invoice are exposed to the POS.
 * The full store-settings API remains management-only.
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const rows = await db.setting.findMany({
    where: { key: { in: ['vatEnabled', 'vatRate', 'vatInclusive', 'currency'] } },
    select: { key: true, value: true },
  })
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return NextResponse.json({
    vatEnabled: values.vatEnabled === 'true',
    vatRate: Math.max(0, Math.min(100, Number(values.vatRate) || 14)),
    vatInclusive: values.vatInclusive === 'true',
    currency: values.currency || 'EGP',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
