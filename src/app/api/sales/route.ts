import { NextRequest, NextResponse } from 'next/server'
import { atomicAction, db } from '@/lib/db'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import { checkSaleItemPrice } from '@/lib/pricing'

const saleItemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().min(0.01, 'السعر يجب أن يكون موجبًا'),  // min 0.01 — no free items
})

const saleSchema = z.object({
  customerId: z.string().optional().nullable(),
  date: z.string().optional(),
  discount: z.number().min(0).default(0),
  paymentMethod: z.string().default('cash'),
  paid: z.number().min(0).default(0),
  notes: z.string().optional().nullable(),
  status: z.enum(['draft', 'completed']).default('completed'),
  managerPin: z.string().optional(),  // for price overrides
  items: z.array(saleItemSchema).min(1, 'الفاتورة يجب أن تحتوي على منتج واحد على الأقل'),
})

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const search = url.searchParams.get('search') || ''
  const status = url.searchParams.get('status')
  const page = Number(url.searchParams.get('page') || '1')
  const pageSize = Number(url.searchParams.get('pageSize') || '50')

  const where: {
    OR?: Array<{ invoiceNo?: { contains: string }; customer?: { name: { contains: string } } }>
    status?: string
  } = {}
  if (search) {
    where.OR = [
      { invoiceNo: { contains: search } },
      { customer: { name: { contains: search } } },
    ]
  }
  if (status && status !== 'all') where.status = status

  const [sales, total] = await Promise.all([
    db.sale.findMany({
      where,
      include: { customer: true, items: { include: { variant: { include: { product: true } } } } },
      orderBy: { date: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.sale.count({ where }),
  ])
  return NextResponse.json({ items: sales, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    }
    const body = await req.json()
    const parsed = saleSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'بيانات غير صحيحة' },
        { status: 400 }
      )
    }
    const data = parsed.data

    // --- Price validation (BLOCKER #2 fix) ---
    // If cashier tries to override price, require manager PIN
    let managerOverride = false
    if (user.role === 'cashier') {
      for (const it of data.items) {
        const check = await checkSaleItemPrice(it.variantId, it.unitPrice, user.role)
        if (!check.ok) {
          // If managerPin provided, verify it
          if (check.needsManagerApproval && data.managerPin) {
            const { verifyManagerPin } = await import('@/lib/auth')
            const valid = await verifyManagerPin(data.managerPin)
            if (!valid) {
              return NextResponse.json({ error: 'PIN المدير غير صحيح' }, { status: 403 })
            }
            managerOverride = true
            break  // PIN verified once covers all items in this sale
          }
          return NextResponse.json({ error: check.error }, { status: 400 })
        }
      }
    }

    // Variant lookup
    const variantIds = [...new Set(data.items.map((i) => i.variantId))]
    const variants = await db.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, quantity: true, costPrice: true, sellPrice: true, sku: true, product: { select: { name: true } } },
    })
    const variantMap = new Map(variants.map((v) => [v.id, v]))
    if (variants.length !== variantIds.length) {
      return NextResponse.json({ error: 'بعض المنتجات غير موجودة' }, { status: 400 })
    }

    // Validate stock (for completed sales)
    if (data.status === 'completed') {
      for (const it of data.items) {
        const v = variantMap.get(it.variantId)!
        if (v.quantity < it.quantity) {
          return NextResponse.json(
            { error: `المخزون غير كافٍ لـ ${v.product.name} (${v.sku}): متوفر ${v.quantity}` },
            { status: 400 }
          )
        }
      }
    }

    // Validate discount bounds
    const subtotal = data.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
    if (data.discount > subtotal) {
      return NextResponse.json(
        { error: `الخصم (${data.discount}) لا يمكن أن يتجاوز الإجمالي الفرعي (${subtotal})` },
        { status: 400 }
      )
    }
    // Cashier discount limit: max 10% without manager PIN
    if (user.role === 'cashier' && !managerOverride && data.discount > subtotal * 0.10) {
      return NextResponse.json(
        { error: `خصم ${data.discount} يتجاوز 10% — يتطلب موافقة المدير` },
        { status: 403 }
      )
    }

    const result = await atomicAction<{
      id: string
      invoiceNo: string
      total: number
      status: string
    }>('commit_sale', {
      payload: {
        userId: user.id,
        customerId: data.customerId || null,
        date: data.date || new Date().toISOString(),
        subtotal,
        discount: data.discount,
        paid: data.paid,
        paymentMethod: data.paymentMethod,
        status: data.status,
        notes: data.notes || null,
        items: data.items,
      },
    })

    await auditLog({
      user,
      action: 'create',
      entity: 'sale',
      entityId: result.id,
      after: { invoiceNo: result.invoiceNo, total: result.total, status: data.status, managerOverride },
    })

    // Auto-sync to Google Sheets (best-effort, only if completed)
    if (data.status === 'completed') {
      try {
        const { syncAfterSale } = await import('@/lib/sync')
        await syncAfterSale(data.customerId)
      } catch (syncErr) {
        console.error('Auto-sync failed (sale):', syncErr)
        // Don't fail the sale — sync can be retried manually
      }
    }

    return NextResponse.json(result, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'تعارض في رقم الفاتورة — حاول مرة أخرى' }, { status: 409 })
    }
    return NextResponse.json({ error: err.message || 'خطأ في حفظ الفاتورة' }, { status: 500 })
  }
}
