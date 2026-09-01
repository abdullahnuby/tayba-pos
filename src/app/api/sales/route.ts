import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { checkSaleItemPrice } from '@/lib/pricing'

const item = z.object({ variantId: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().min(0.01) })
const schema = z.object({ customerId: z.string().optional().nullable(), date: z.string().optional(), discount: z.number().min(0).default(0), paymentMethod: z.enum(['cash','card','transfer','credit']).default('cash'), paid: z.number().min(0).default(0), notes: z.string().optional().nullable(), status: z.enum(['draft','completed']).default('completed'), managerPin: z.string().optional(), items: z.array(item).min(1), idempotencyKey: z.string().max(120).optional() })

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  const url = new URL(req.url)
  const search = url.searchParams.get('search') || ''
  const status = url.searchParams.get('status')
  const page = Math.max(1, Number(url.searchParams.get('page') || 1))
  const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get('pageSize') || 50)))
  const where: any = {}
  if (user.role === 'cashier') where.userId = user.id
  if (status && status !== 'all') where.status = status
  if (search) where.OR = [{ invoiceNo: { contains: search } }, { customer: { name: { contains: search } } }]
  const [sales, total] = await Promise.all([db.sale.findMany({ where, include: { customer: true, items: { include: { variant: { include: { product: true } } } } }, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), db.sale.count({ where })])
  return NextResponse.json({ items: sales, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const data = schema.parse(await req.json())

    if (user.role === 'cashier') {
      const open = await db.registerSession.findFirst({ where: { userId: user.id, status: 'open' } })
      if (!open) return NextResponse.json({ error: 'افتح الوردية أولاً قبل إصدار الفواتير' }, { status: 403 })
    }

    let managerOverride = false
    if (user.role === 'cashier') {
      for (const it of data.items) {
        const check = await checkSaleItemPrice(it.variantId, it.unitPrice, user.role)
        if (!check.ok) {
          if (check.needsManagerApproval && data.managerPin) {
            const { verifyManagerPin } = await import('@/lib/auth')
            if (!(await verifyManagerPin(data.managerPin))) return NextResponse.json({ error: 'PIN المدير غير صحيح' }, { status: 403 })
            managerOverride = true
            break
          }
          return NextResponse.json({ error: check.error }, { status: 400 })
        }
      }
    }

    const variantIds = [...new Set(data.items.map(i => i.variantId))]
    const variants = await db.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, quantity: true, sellPrice: true, sku: true, product: { select: { name: true } } } })
    if (variants.length !== variantIds.length) return NextResponse.json({ error: 'بعض المنتجات غير موجودة' }, { status: 400 })
    const map = new Map(variants.map(v => [v.id, v]))
    if (data.status === 'completed') for (const it of data.items) { const v = map.get(it.variantId)!; if (v.quantity < it.quantity) return NextResponse.json({ error: `المخزون غير كافٍ لـ ${v.product.name} (${v.sku})` }, { status: 400 }) }

    const subtotal = data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
    if (data.discount > subtotal) return NextResponse.json({ error: 'الخصم أكبر من الإجمالي' }, { status: 400 })
    if (user.role === 'cashier' && !managerOverride && data.discount > subtotal * 0.1) return NextResponse.json({ error: 'خصم أكثر من 10% يحتاج موافقة المدير' }, { status: 403 })

    // Prevent accidental repeated POSTs in the same short window when the browser retries.
    if (data.idempotencyKey) {
      const recent = await db.sale.findFirst({ where: { userId: user.id, notes: { contains: `[idem:${data.idempotencyKey}]` } }, orderBy: { date: 'desc' } })
      if (recent) return NextResponse.json(recent, { status: 200 })
    }

    const result = await atomicAction('commit_sale', { payload: { userId: user.id, customerId: data.customerId || null, date: data.date || new Date().toISOString(), subtotal, discount: data.discount, paid: data.paid, paymentMethod: data.paymentMethod, status: data.status, notes: `${data.notes || ''}${data.idempotencyKey ? ` [idem:${data.idempotencyKey}]` : ''}`.trim() || null, items: data.items } })
    await auditLog({ user, action: 'create', entity: 'sale', entityId: (result as any).id, after: { invoiceNo: (result as any).invoiceNo, total: (result as any).total, status: data.status, managerOverride } })
    if (data.status === 'completed') { try { const { syncAfterSale } = await import('@/lib/sync'); await syncAfterSale(data.customerId) } catch {} }
    return NextResponse.json(result, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'P2002') return NextResponse.json({ error: 'تعارض في رقم الفاتورة — حاول مرة أخرى' }, { status: 409 })
    return NextResponse.json({ error: err.message || 'خطأ في حفظ الفاتورة' }, { status: 500 })
  }
}
