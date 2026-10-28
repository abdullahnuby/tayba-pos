import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { checkSaleItemPrice } from '@/lib/pricing'

const item = z.object({ variantId: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().min(0.01) })
function sanitizeCashierSale(sale: any) {
  if (!sale) return sale
  return {
    ...sale,
    customer: sale.customer ? { id: sale.customer.id, name: sale.customer.name, phone: sale.customer.phone } : null,
    items: Array.isArray(sale.items) ? sale.items.map((item: any) => {
      const safeItem: Record<string, any> = { ...item }
      delete safeItem.unitCost
      if (!item.variant) return safeItem
      const safeVariant: Record<string, unknown> = { ...item.variant }
      delete safeVariant.costPrice
      delete safeVariant.minQuantity
      delete safeVariant.reorderQty
      delete safeVariant.purchaseUnit
      delete safeVariant.purchaseUnitFactor
      delete safeVariant.baseUnit
      return { ...safeItem, variant: safeVariant }
    }) : sale.items,
  }
}

const schema = z.object({ customerId: z.string().optional().nullable(), date: z.string().optional(), discount: z.number().min(0).default(0), paymentMethod: z.enum(['cash','card','transfer','credit']).default('cash'), paid: z.number().min(0).default(0), notes: z.string().optional().nullable(), status: z.enum(['draft','completed']).default('completed'), managerPin: z.string().optional(), items: z.array(item).min(1), idempotencyKey: z.string().min(8).max(120).optional() })

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  const url = new URL(req.url)
  const search = url.searchParams.get('search') || ''
  const status = url.searchParams.get('status')
  const rawPage = Number(url.searchParams.get('page') || '1')
  const rawPageSize = Number(url.searchParams.get('pageSize') || '50')
  const page = Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1)
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(rawPageSize) ? Math.floor(rawPageSize) : 50))
  const where: any = {}
  if (user.role === 'cashier') where.userId = user.id
  if (status && status !== 'all') where.status = status
  if (search) where.OR = [{ invoiceNo: { contains: search } }, { customer: { name: { contains: search } } }]
  const [sales, total] = await Promise.all([db.sale.findMany({ where, include: { customer: true, items: { include: { variant: { include: { product: true } } } } }, orderBy: { date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), db.sale.count({ where })])
  const items = user.role === 'cashier' ? sales.map(sanitizeCashierSale) : sales

  return NextResponse.json({ items, total, page, pageSize }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    const data = schema.parse(await req.json())
    const rawIdempotencyKey = data.idempotencyKey || req.headers.get('Idempotency-Key') || undefined
    if (rawIdempotencyKey && (rawIdempotencyKey.length < 8 || rawIdempotencyKey.length > 120)) {
      return NextResponse.json({ error: 'مفتاح منع التكرار يجب أن يكون بين 8 و120 حرفًا' }, { status: 400 })
    }
    const idempotencyKey = rawIdempotencyKey ? `${user.id}:${rawIdempotencyKey}` : undefined

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
    const map = new Map<string, (typeof variants)[number]>(variants.map((v) => [v.id, v] as const))
    if (data.status === 'completed') for (const it of data.items) { const v = map.get(it.variantId)!; if (v.quantity < it.quantity) return NextResponse.json({ error: `المخزون غير كافٍ لـ ${v.product.name} (${v.sku})` }, { status: 400 }) }

    const subtotal = Math.round((data.items.reduce((sum, item) => (
      sum + Math.round((item.unitPrice * item.quantity + Number.EPSILON) * 100) / 100
    ), 0) + Number.EPSILON) * 100) / 100
    if (data.discount > subtotal) return NextResponse.json({ error: 'الخصم أكبر من الإجمالي' }, { status: 400 })
    if (user.role === 'cashier' && !managerOverride && data.discount > subtotal * 0.1) return NextResponse.json({ error: 'خصم أكثر من 10% يحتاج موافقة المدير' }, { status: 403 })

    // Prevent accidental repeated POSTs in the same short window when the browser retries.
    if (idempotencyKey) {
      const recent = await db.sale.findFirst({
        where: { userId: user.id, OR: [{ idempotencyKey }, { notes: { contains: `[idem:${rawIdempotencyKey}]` } }] },
        orderBy: { date: 'desc' },
        include: { customer: true, items: { include: { variant: { include: { product: true } } } } },
      })
      if (recent) return NextResponse.json(user.role === 'cashier' ? sanitizeCashierSale(recent) : recent, { status: 200 })
    }

    const result = await atomicAction('commit_sale', { payload: { userId: user.id, requiresOpenShift: user.role === 'cashier', customerId: data.customerId || null, date: data.date || new Date().toISOString(), subtotal, discount: data.discount, paid: data.paid, paymentMethod: data.paymentMethod, status: data.status, idempotencyKey, notes: `${data.notes || ''}${rawIdempotencyKey ? ` [idem:${rawIdempotencyKey}]` : ''}`.trim() || null, items: data.items } })
    // atomicAction returns the raw created rows (no relations) — re-fetch with the same
    // includes used everywhere else (customer, items.variant.product) so the receipt screen
    // that renders immediately after checkout has the fields it expects instead of crashing
    // on `item.variant.product.name`.
    const full = await db.sale.findUnique({
      where: { id: (result as { id: string }).id },
      include: { customer: true, items: { include: { variant: { include: { product: true } } } } },
    })
    const response = user.role === 'cashier' ? sanitizeCashierSale(full || result) : (full || result)
    await auditLog({ user, action: 'create', entity: 'sale', entityId: (result as any).id, after: { invoiceNo: (result as any).invoiceNo, total: (result as any).total, status: data.status, managerOverride } })
    return NextResponse.json(response, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'P2002') return NextResponse.json({ error: 'تعارض في رقم الفاتورة — حاول مرة أخرى' }, { status: 409 })
    return NextResponse.json({ error: err.message || 'خطأ في حفظ الفاتورة' }, { status: 500 })
  }
}
