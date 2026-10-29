import { randomUUID } from 'node:crypto'

type AnyRecord = Record<string, any>
type DatabaseLike = {
  $transaction<T>(work: (tx: any) => Promise<T>): Promise<T>
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function money(value: unknown): number {
  const parsed = numeric(value)
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

function allocateMoney(total: number, bases: number[]): number[] {
  if (!bases.length) return []
  const weights = bases.map((value) => Math.max(0, numeric(value)))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  let allocated = 0
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return money(total - allocated)
    const share = money(weightTotal > 0
      ? total * weight / weightTotal
      : total / weights.length)
    allocated = money(allocated + share)
    return share
  })
}

function requiredPositiveInt(value: unknown, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} يجب أن يكون عددًا صحيحًا موجبًا`)
  }
  return parsed
}

function dateValue(value: unknown): Date {
  if (!value) return new Date()
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw new Error('التاريخ غير صحيح')
  return date
}

function id(): string {
  return randomUUID()
}

async function settingValue(tx: any, key: string, fallback: string): Promise<string> {
  const row = await tx.setting.findUnique({ where: { key } })
  return row?.value ?? fallback
}

async function nextInvoiceNumber(
  tx: any,
  counterKey: string,
  prefixKey: string,
  fallbackPrefix: string,
): Promise<string> {
  const counterRow = await tx.setting.findUnique({ where: { key: counterKey } })
  const next = Math.max(0, Math.trunc(numeric(counterRow?.value))) + 1
  await tx.setting.upsert({
    where: { key: counterKey },
    create: { id: id(), key: counterKey, value: String(next) },
    update: { value: String(next) },
  })
  const prefix = (await settingValue(tx, prefixKey, fallbackPrefix)).trim() || fallbackPrefix
  return `${prefix}-${String(next).padStart(6, '0')}`
}

async function taxSettings(tx: any): Promise<{ enabled: boolean; rate: number; inclusive: boolean }> {
  const [enabled, rawRate, inclusive] = await Promise.all([
    settingValue(tx, 'vatEnabled', 'false'),
    settingValue(tx, 'vatRate', '14'),
    settingValue(tx, 'vatInclusive', 'false'),
  ])
  return {
    enabled: enabled.toLowerCase() === 'true',
    rate: Math.max(0, Math.min(100, numeric(rawRate, 14))),
    inclusive: inclusive.toLowerCase() === 'true',
  }
}

function aggregateQuantities(items: AnyRecord[], idField: string, qtyField: string): Map<string, number> {
  const quantities = new Map<string, number>()
  for (const item of items) {
    const itemId = String(item[idField] || '')
    if (!itemId) throw new Error('بعض البنود غير صحيحة')
    const quantity = requiredPositiveInt(item[qtyField], 'الكمية')
    quantities.set(itemId, (quantities.get(itemId) || 0) + quantity)
  }
  return quantities
}

async function updateStock(tx: any, variantId: string, change: number): Promise<void> {
  const row = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, quantity: true },
  })
  if (!row) throw new Error('بعض المنتجات غير موجودة')
  const nextQuantity = row.quantity + change
  if (nextQuantity < 0) throw new Error('المخزون غير كافٍ لتنفيذ العملية')
  const updated = await tx.productVariant.updateMany({
    where: { id: variantId, quantity: { gte: Math.max(0, -change) } },
    data: { quantity: { increment: change }, updatedAt: new Date() },
  })
  if (updated.count !== 1) throw new Error('تغير المخزون أثناء العملية؛ أعد المحاولة')
}

export async function localAtomicAction<T = any>(
  database: DatabaseLike,
  action: string,
  rawInput: AnyRecord = {},
): Promise<T> {
  const input: AnyRecord = rawInput?.payload ?? rawInput

  switch (action) {
    case 'commit_sale': {
      return database.$transaction(async (tx) => {
        if (input.requiresOpenShift) {
          const openShift = await tx.registerSession.findFirst({
            where: { userId: String(input.userId || ''), status: 'open' },
            select: { id: true },
          })
          if (!openShift) throw new Error('الوردية اتقفلت قبل تسجيل الفاتورة؛ افتح وردية جديدة وحاول مرة أخرى')
        }

        const items = Array.isArray(input.items) ? input.items : []
        if (!items.length) throw new Error('الفاتورة يجب أن تحتوي على منتج واحد على الأقل')

        const status = input.status === 'draft' ? 'draft' : 'completed'
        const idempotencyKey = String(input.idempotencyKey || /\[idem:([^\]]+)\]/.exec(String(input.notes || ''))?.[1] || '').trim()
        if (idempotencyKey) {
          const existing = await tx.sale.findUnique({
            where: { idempotencyKey },
            include: { items: true },
          })
          if (existing) return existing
        }

        const normalized = items.map((item: AnyRecord) => ({
          variantId: String(item.variantId || ''),
          quantity: requiredPositiveInt(item.quantity, 'الكمية'),
          unitPrice: numeric(item.unitPrice, -1),
        }))
        if (normalized.some((item) => !item.variantId || item.unitPrice < 0)) {
          throw new Error('بيانات المنتجات أو الأسعار غير صحيحة')
        }

        const totals = new Map<string, number>()
        for (const item of normalized) totals.set(item.variantId, (totals.get(item.variantId) || 0) + item.quantity)

        const variants = await tx.productVariant.findMany({
          where: { id: { in: [...totals.keys()] } },
          select: { id: true, quantity: true, costPrice: true, sku: true },
        })
        if (variants.length !== totals.size) throw new Error('بعض المنتجات غير موجودة')
        const variantMap = new Map(variants.map((variant: AnyRecord) => [variant.id, variant]))
        if (status === 'completed') {
          for (const [variantId, quantity] of totals) {
            if ((variantMap.get(variantId) as AnyRecord).quantity < quantity) {
              throw new Error('المخزون غير كافٍ لإتمام الفاتورة')
            }
          }
        }

        const subtotal = money(normalized.reduce((sum, item) => sum + money(item.unitPrice * item.quantity), 0))
        const discount = money(input.discount)
        if (discount < 0 || discount > subtotal) throw new Error('قيمة الخصم غير صحيحة')
        const tax = await taxSettings(tx)
        const taxable = money(Math.max(0, subtotal - discount))
        const taxAmount = money(tax.enabled
          ? (tax.inclusive ? taxable - taxable / (1 + tax.rate / 100) : taxable * tax.rate / 100)
          : 0)
        const total = money(tax.enabled && tax.inclusive ? taxable : taxable + taxAmount)
        const paid = money(input.paid)
        if (paid < 0) throw new Error('المبلغ المدفوع غير صحيح')
        const paymentMethod = String(input.paymentMethod || 'cash')
        if (paymentMethod === 'credit' && paid > 0.001) {
          throw new Error('الفاتورة الآجلة لا يجوز أن تحتوي على مبلغ مدفوع؛ اختر طريقة الدفع الفعلية')
        }
        if (paid > total + 0.001 && paymentMethod !== 'cash') {
          throw new Error('لا يمكن تسجيل زيادة مدفوعة أو باقي نقدي مع البطاقة أو التحويل أو البيع الآجل')
        }
        if (status === 'completed' && total - Math.min(paid, total) > 0.001 && !input.customerId) {
          throw new Error('لا يمكن تسجيل مبلغ آجل أو متبقٍ من دون ربط الفاتورة بعميل')
        }
        if (input.customerId && !(await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } }))) {
          throw new Error('العميل غير موجود')
        }
        const saleId = id()
        const invoiceNo = await nextInvoiceNumber(tx, 'saleCounter', 'saleInvoicePrefix', 'INV')
        const sale = await tx.sale.create({
          data: {
            id: saleId,
            invoiceNo,
            customerId: input.customerId || null,
            userId: input.userId || null,
            date: dateValue(input.date),
            subtotal,
            discount,
            taxRate: tax.enabled ? tax.rate : 0,
            taxAmount,
            total,
            paid: Math.min(paid, total),
            initialPaid: Math.min(paid, total),
            change: money(Math.max(0, paid - total)),
            paymentMethod,
            status,
            notes: input.notes || null,
            idempotencyKey: idempotencyKey || null,
            items: {
              create: normalized.map((item) => ({
                id: id(),
                variantId: item.variantId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                unitCost: (variantMap.get(item.variantId) as AnyRecord).costPrice,
                total: money(item.unitPrice * item.quantity),
              })),
            },
          },
          include: { items: true },
        })

        if (status === 'completed') {
          for (const [variantId, quantity] of totals) await updateStock(tx, variantId, -quantity)
          const due = money(Math.max(0, total - Math.min(paid, total)))
          if (input.customerId && due > 0) {
            await tx.customer.update({ where: { id: input.customerId }, data: { balance: { increment: due }, updatedAt: new Date() } })
          }
        }
        return sale
      }) as Promise<T>
    }

    case 'commit_sale_return': {
      return database.$transaction(async (tx) => {
        const items = Array.isArray(input.items) ? input.items : []
        if (!items.length) throw new Error('يجب تحديد بنود للإرجاع')
        const idempotencyKey = String(input.idempotencyKey || '').trim()
        if (idempotencyKey) {
          const existing = await tx.saleReturn.findUnique({ where: { idempotencyKey }, include: { items: true } })
          if (existing) return existing
        }

        const sale = await tx.sale.findUnique({
          where: { id: String(input.saleId || '') },
          include: {
            items: true,
            returns: { where: { status: 'completed' }, select: { total: true } },
          },
        })
        if (!sale) throw new Error('الفاتورة غير موجودة')
        if (['voided', 'draft'].includes(sale.status)) throw new Error('لا يمكن إرجاع فاتورة ملغاة أو مسودة')

        const saleItemMap = new Map(sale.items.map((item: AnyRecord) => [item.id, item]))
        const returnTotals = await tx.saleReturnItem.groupBy({
          by: ['saleItemId'],
          where: { saleReturn: { is: { saleId: sale.id, status: 'completed' } } },
          _sum: { quantity: true },
        })
        const alreadyReturned = new Map<string, number>(returnTotals.map((row: AnyRecord) => [String(row.saleItemId), numeric(row._sum.quantity)]))
        const normalized = items.map((item: AnyRecord) => {
          const saleItem = saleItemMap.get(String(item.saleItemId || '')) as AnyRecord | undefined
          if (!saleItem) throw new Error('بند الفاتورة غير صحيح')
          const quantity = requiredPositiveInt(item.quantity, 'كمية الإرجاع')
          if ((alreadyReturned.get(saleItem.id) || 0) + quantity > saleItem.quantity) {
            throw new Error('كمية الإرجاع تتجاوز الكمية المباعة')
          }
          return { saleItem, quantity, unitPrice: saleItem.unitPrice }
        })
        const requestedBySaleItem = new Map<string, number>()
        for (const item of normalized) {
          requestedBySaleItem.set(item.saleItem.id, (requestedBySaleItem.get(item.saleItem.id) || 0) + item.quantity)
        }
        for (const [saleItemId, requestedQuantity] of requestedBySaleItem) {
          const saleItem = saleItemMap.get(saleItemId) as AnyRecord
          const prior = alreadyReturned.get(saleItemId) || 0
          if (prior + requestedQuantity > saleItem.quantity) {
            throw new Error('إجمالي كمية الإرجاع يتجاوز الكمية المباعة لهذا البند')
          }
        }

        const baseSubtotal = money(normalized.reduce((sum, item) => sum + money(item.unitPrice * item.quantity), 0))
        const originalSubtotal = numeric(sale.subtotal)
        const allReturned = sale.items.every((saleItem: AnyRecord) => {
          const previous = alreadyReturned.get(saleItem.id) || 0
          const additional = normalized.filter((item) => item.saleItem.id === saleItem.id).reduce((sum, item) => sum + item.quantity, 0)
          return previous + additional >= saleItem.quantity
        })
        const priorReturnTotal = sale.returns.reduce((sum: number, returned: AnyRecord) => sum + numeric(returned.total), 0)
        const total = allReturned
          ? money(numeric(sale.total) - priorReturnTotal)
          : money(originalSubtotal > 0 ? baseSubtotal * numeric(sale.total) / originalSubtotal : 0)
        const customerAccount = sale.customerId
          ? await tx.customer.findUnique({ where: { id: sale.customerId }, select: { balance: true } })
          : null
        // A customer payment may be posted to the account without assigning it
        // to a specific invoice. Use the account's authoritative current balance
        // so returns do not create a duplicate debt or a false cash refund.
        const accountDebt = money(Math.max(0, numeric(customerAccount?.balance)))
        const balanceOffset = money(sale.customerId ? Math.min(total, accountDebt) : 0)
        const refundMethod = String(input.refundMethod || 'cash')
        if (refundMethod === 'credit' && !sale.customerId) {
          throw new Error('لا يمكن إضافة رصيد مرتجع من دون ربط الفاتورة بعميل')
        }
        const refundAmount = money(refundMethod === 'credit' ? 0 : Math.max(0, total - balanceOffset))
        const balanceReduction = money(refundMethod === 'credit' ? total : balanceOffset)
        const returnLineTotals = allocateMoney(
          total,
          normalized.map((item) => item.unitPrice * item.quantity),
        )
        const returnId = id()
        const created = await tx.saleReturn.create({
          data: {
            id: returnId,
            returnNo: await nextInvoiceNumber(tx, 'returnCounter', 'returnPrefix', 'RET'),
            saleId: sale.id,
            customerId: sale.customerId,
            userId: input.userId || null,
            date: dateValue(input.date),
            subtotal: baseSubtotal,
            total,
            refundAmount,
            reason: input.reason || null,
            notes: input.notes || null,
            status: 'completed',
            refundMethod,
            idempotencyKey: idempotencyKey || null,
            items: {
              create: normalized.map((item, index) => ({
                id: id(),
                saleItemId: item.saleItem.id,
                variantId: item.saleItem.variantId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: returnLineTotals[index],
              })),
            },
          },
          include: { items: true },
        })
        for (const item of normalized) await updateStock(tx, item.saleItem.variantId, item.quantity)
        await tx.sale.update({ where: { id: sale.id }, data: { status: allReturned ? 'returned' : 'partial_return' } })
        if (sale.customerId && balanceReduction > 0) {
          await tx.customer.update({
            where: { id: sale.customerId },
            data: { balance: { decrement: balanceReduction }, updatedAt: new Date() },
          })
        }
        return created
      }) as Promise<T>
    }

    case 'commit_purchase': {
      return database.$transaction(async (tx) => {
        const idempotencyKey = String(input.idempotencyKey || '').trim()
        if (idempotencyKey) {
          const existing = await tx.purchase.findUnique({ where: { idempotencyKey }, include: { items: true } })
          if (existing) return existing
        }
        if (input.requiresOpenShift) {
          const openShift = await tx.registerSession.findFirst({
            where: { userId: String(input.userId || ''), status: 'open' },
            select: { id: true },
          })
          if (!openShift) throw new Error('الوردية اتقفلت قبل تسجيل الفاتورة؛ افتح وردية جديدة وحاول مرة أخرى')
        }
        const items = Array.isArray(input.items) ? input.items : []
        if (!items.length) throw new Error('فاتورة الشراء يجب أن تحتوي على بند واحد على الأقل')
        const normalized = items.map((item: AnyRecord) => ({
          variantId: String(item.variantId || ''),
          quantity: requiredPositiveInt(item.quantity, 'الكمية'),
          unitCost: numeric(item.unitCost, -1),
          enteredQuantity: numeric(item.enteredQuantity, numeric(item.quantity)),
          unit: String(item.unit || 'piece'),
          unitFactor: Math.max(1, Math.trunc(numeric(item.unitFactor, 1))),
        }))
        if (normalized.some((item) => !item.variantId || item.unitCost < 0)) throw new Error('بيانات فاتورة الشراء غير صحيحة')
        const supplier = await tx.supplier.findUnique({ where: { id: String(input.supplierId || '') } })
        if (!supplier) throw new Error('المورد غير موجود')
        const variantIds = [...new Set(normalized.map((item) => item.variantId))]
        const variants = await tx.productVariant.findMany({ where: { id: { in: variantIds } } })
        if (variants.length !== variantIds.length) throw new Error('بعض المنتجات غير موجودة')
        const tax = await taxSettings(tx)
        const subtotal = money(normalized.reduce((sum, item) => sum + money(item.unitCost * item.quantity), 0))
        const discount = money(input.discount)
        if (discount < 0 || discount > subtotal) throw new Error('قيمة الخصم غير صحيحة')
        const taxable = money(Math.max(0, subtotal - discount))
        const taxAmount = money(tax.enabled
          ? (tax.inclusive ? taxable - taxable / (1 + tax.rate / 100) : taxable * tax.rate / 100)
          : 0)
        const total = money(tax.enabled && tax.inclusive ? taxable : taxable + taxAmount)
        const paid = money(input.paid)
        if (paid < 0) throw new Error('المبلغ المدفوع غير صحيح')
        const paymentMethod = String(input.paymentMethod || 'cash')
        if (paymentMethod === 'credit' && paid > 0.001) {
          throw new Error('فاتورة الشراء الآجلة لا يجوز أن تحتوي على مبلغ مدفوع؛ اختر طريقة الدفع الفعلية')
        }
        if (paid > total + 0.001) throw new Error('المبلغ المدفوع للمورد يتجاوز إجمالي فاتورة الشراء')

        const purchaseId = id()
        const created = await tx.purchase.create({
          data: {
            id: purchaseId,
            invoiceNo: await nextInvoiceNumber(tx, 'purchaseCounter', 'purchaseInvoicePrefix', 'PUR'),
            supplierId: supplier.id,
            userId: input.userId || null,
            paymentMethod,
            initialPaid: Math.min(paid, total),
            idempotencyKey: idempotencyKey || null,
            date: dateValue(input.date),
            subtotal,
            discount,
            taxRate: tax.enabled ? tax.rate : 0,
            taxAmount,
            total,
            paid: Math.min(paid, total),
            status: input.status === 'draft' ? 'draft' : 'completed',
            notes: input.notes || null,
            items: {
              create: normalized.map((item) => ({
                id: id(),
                variantId: item.variantId,
                quantity: item.quantity,
                unitCost: item.unitCost,
                total: money(item.unitCost * item.quantity),
                enteredQuantity: item.enteredQuantity,
                unit: item.unit,
                unitFactor: item.unitFactor,
              })),
            },
          },
          include: { items: true },
        })
        if (created.status === 'completed') {
          const quantitiesByVariant = new Map<string, number>()
          const valueByVariant = new Map<string, number>()
          for (const item of normalized) {
            quantitiesByVariant.set(item.variantId, (quantitiesByVariant.get(item.variantId) || 0) + item.quantity)
            valueByVariant.set(item.variantId, (valueByVariant.get(item.variantId) || 0) + item.quantity * item.unitCost)
          }
          for (const [variantId, quantityAdded] of quantitiesByVariant) {
            const old = variants.find((variant: AnyRecord) => variant.id === variantId) as AnyRecord
            const nextQty = old.quantity + quantityAdded
            const nextCost = nextQty > 0
              ? (old.quantity * old.costPrice + (valueByVariant.get(variantId) || 0)) / nextQty
              : old.costPrice
            await tx.productVariant.update({
              where: { id: variantId },
              data: { quantity: nextQty, costPrice: nextCost, updatedAt: new Date() },
            })
          }
          const due = money(Math.max(0, total - Math.min(paid, total)))
          if (due > 0) await tx.supplier.update({ where: { id: supplier.id }, data: { balance: { increment: due }, updatedAt: new Date() } })
        }
        return created
      }) as Promise<T>
    }

    case 'commit_purchase_return': {
      return database.$transaction(async (tx) => {
        const items = Array.isArray(input.items) ? input.items : []
        if (!items.length) throw new Error('المرتجع يجب أن يحتوي على بند واحد على الأقل')
        const idempotencyKey = String(input.idempotencyKey || '').trim()
        if (idempotencyKey) {
          const existing = await tx.purchaseReturn.findUnique({ where: { idempotencyKey }, include: { items: true } })
          if (existing) return existing
        }
        const purchase = await tx.purchase.findUnique({
          where: { id: String(input.purchaseId || '') },
          include: { items: true, returns: { where: { status: 'completed' }, select: { total: true } } },
        })
        if (!purchase) throw new Error('فاتورة الشراء غير موجودة')
        if (purchase.status !== 'completed') throw new Error('لا يمكن إرجاع فاتورة شراء غير مكتملة')
        if (input.supplierId && input.supplierId !== purchase.supplierId) throw new Error('المورد لا يطابق فاتورة الشراء')

        const purchaseItemMap = new Map(purchase.items.map((item: AnyRecord) => [item.id, item]))
        const returnedRows = await tx.purchaseReturnItem.findMany({
          where: { purchaseReturn: { is: { purchaseId: purchase.id, status: 'completed' } } },
          select: { variantId: true, quantity: true, purchaseItemId: true },
        })
        const purchasedByVariant = new Map<string, number>()
        for (const row of purchase.items) {
          purchasedByVariant.set(row.variantId, (purchasedByVariant.get(row.variantId) || 0) + row.quantity)
        }
        const legacyReturnedByVariant = new Map<string, number>()
        const returnedByPurchaseItem = new Map<string, number>()
        for (const row of returnedRows) {
          if (row.purchaseItemId) {
            returnedByPurchaseItem.set(row.purchaseItemId, (returnedByPurchaseItem.get(row.purchaseItemId) || 0) + row.quantity)
          } else {
            legacyReturnedByVariant.set(row.variantId, (legacyReturnedByVariant.get(row.variantId) || 0) + row.quantity)
          }
        }
        // Older return rows did not point to a purchase line. Allocate their quantities
        // deterministically to lines of the same variant so the migration stays safe.
        const legacyAllocatedByItem = new Map<string, number>()
        const purchaseItemsByVariant = new Map<string, AnyRecord[]>()
        for (const row of [...purchase.items].sort((a: AnyRecord, b: AnyRecord) => a.id.localeCompare(b.id))) {
          const list = purchaseItemsByVariant.get(row.variantId) || []
          list.push(row)
          purchaseItemsByVariant.set(row.variantId, list)
        }
        for (const [variantId, rows] of purchaseItemsByVariant) {
          let legacyLeft = legacyReturnedByVariant.get(variantId) || 0
          for (const row of rows) {
            const availableForAllocation = Math.max(0, row.quantity - (returnedByPurchaseItem.get(row.id) || 0))
            const allocated = Math.min(legacyLeft, availableForAllocation)
            legacyAllocatedByItem.set(row.id, allocated)
            legacyLeft -= allocated
          }
          if (legacyLeft > 0) throw new Error('سجل مرتجعات سابق غير متطابق؛ راجع الفاتورة قبل إضافة مرتجع جديد')
        }

        const normalized = items.map((item: AnyRecord) => {
          const purchaseItem = purchaseItemMap.get(String(item.purchaseItemId || '')) as AnyRecord | undefined
          if (!purchaseItem) throw new Error('بند فاتورة الشراء غير صحيح')
          const quantity = requiredPositiveInt(item.quantity, 'كمية الإرجاع')
          return { purchaseItem, quantity }
        })
        const requestedByPurchaseItem = new Map<string, number>()
        const requestedByVariant = new Map<string, number>()
        for (const item of normalized) {
          requestedByPurchaseItem.set(item.purchaseItem.id, (requestedByPurchaseItem.get(item.purchaseItem.id) || 0) + item.quantity)
          requestedByVariant.set(item.purchaseItem.variantId, (requestedByVariant.get(item.purchaseItem.variantId) || 0) + item.quantity)
        }
        for (const [purchaseItemId, quantity] of requestedByPurchaseItem) {
          const purchaseItem = purchaseItemMap.get(purchaseItemId) as AnyRecord
          const already = (returnedByPurchaseItem.get(purchaseItemId) || 0) + (legacyAllocatedByItem.get(purchaseItemId) || 0)
          if (already + quantity > purchaseItem.quantity) throw new Error('كمية الإرجاع تتجاوز الكمية المشتراة لهذا البند')
        }
        for (const [variantId, quantity] of requestedByVariant) {
          const already = returnedRows.filter((row: AnyRecord) => row.variantId === variantId).reduce((sum: number, row: AnyRecord) => sum + row.quantity, 0)
          const purchased = purchasedByVariant.get(variantId) || 0
          if (already + quantity > purchased) throw new Error('كمية الإرجاع تتجاوز الكمية المشتراة')
        }
        const baseSubtotal = money(normalized.reduce((sum, item) => sum + money(item.purchaseItem.unitCost * item.quantity), 0))
        const allReturned = purchase.items.every((purchaseItem: AnyRecord) => {
          const already = (returnedByPurchaseItem.get(purchaseItem.id) || 0) + (legacyAllocatedByItem.get(purchaseItem.id) || 0)
          const additional = normalized.filter((item) => item.purchaseItem.id === purchaseItem.id).reduce((sum, item) => sum + item.quantity, 0)
          return already + additional >= purchaseItem.quantity
        })
        const priorReturnTotal = purchase.returns.reduce((sum: number, returned: AnyRecord) => sum + numeric(returned.total), 0)
        const returnTotal = allReturned
          ? money(numeric(purchase.total) - priorReturnTotal)
          : money(purchase.subtotal > 0 ? baseSubtotal * purchase.total / purchase.subtotal : 0)
        const refundMethod = String(input.refundMethod || 'credit')
        const supplierAccount = await tx.supplier.findUnique({
          where: { id: purchase.supplierId },
          select: { balance: true },
        })
        if (!supplierAccount) throw new Error('المورد غير موجود')
        // Account-level payments may be intentionally unallocated to one invoice.
        // Offset the live supplier balance first before authorizing an actual refund.
        const accountDebt = money(Math.max(0, numeric(supplierAccount.balance)))
        const maximumCashRefund = refundMethod === 'credit'
          ? 0
          : money(Math.max(0, returnTotal - Math.min(returnTotal, accountDebt)))
        const refundAmount = input.refundAmount == null
          ? maximumCashRefund
          : money(numeric(input.refundAmount, -1))
        if (!Number.isFinite(refundAmount) || refundAmount < 0 || refundAmount > maximumCashRefund + 0.001) {
          throw new Error('قيمة الاسترداد تتجاوز المبلغ المدفوع للمورد؛ يجب خصم المستحق أولًا')
        }
        const quantities = new Map<string, number>()
        for (const item of normalized) quantities.set(item.purchaseItem.variantId, (quantities.get(item.purchaseItem.variantId) || 0) + item.quantity)
        for (const [variantId, quantity] of quantities) {
          const variant = await tx.productVariant.findUnique({ where: { id: variantId }, select: { quantity: true } })
          if (!variant || variant.quantity < quantity) throw new Error('المخزون غير كافٍ لتنفيذ المرتجع')
        }
        const returnLineTotals = allocateMoney(
          returnTotal,
          normalized.map((item) => item.purchaseItem.unitCost * item.quantity),
        )
        const created = await tx.purchaseReturn.create({
          data: {
            id: id(),
            returnNo: await nextInvoiceNumber(tx, 'purchaseReturnCounter', 'purchaseReturnPrefix', 'PRET'),
            purchaseId: purchase.id,
            supplierId: purchase.supplierId,
            userId: input.userId || null,
            date: dateValue(input.date),
            total: returnTotal,
            reason: input.reason || null,
            notes: input.notes || null,
            status: 'completed',
            refundMethod,
            refundAmount,
            idempotencyKey: idempotencyKey || null,
            items: {
              create: normalized.map((item, index) => ({
                id: id(),
                purchaseItemId: item.purchaseItem.id,
                variantId: item.purchaseItem.variantId,
                quantity: item.quantity,
                unitCost: item.purchaseItem.unitCost,
                total: returnLineTotals[index],
              })),
            },
          },
          include: { items: true },
        })
        for (const [variantId, quantity] of quantities) await updateStock(tx, variantId, -quantity)
        const supplierBalanceReduction = refundMethod === 'credit'
          ? returnTotal
          : Math.min(returnTotal, accountDebt)
        if (supplierBalanceReduction > 0) {
          await tx.supplier.update({
            where: { id: purchase.supplierId },
            data: { balance: { decrement: supplierBalanceReduction }, updatedAt: new Date() },
          })
        }
        return created
      }) as Promise<T>
    }

    case 'void_sale': {
      return database.$transaction(async (tx) => {
        const sale = await tx.sale.findUnique({ where: { id: String(input.saleId || '') }, include: { items: true, returns: true } })
        if (!sale) throw new Error('الفاتورة غير موجودة')
        if (sale.status !== 'completed') throw new Error('يمكن إلغاء الفواتير المكتملة فقط')
        if (sale.returns.length) throw new Error('لا يمكن إلغاء فاتورة لها مرتجعات مسجلة')
        if (numeric(sale.paid) > 0.001) {
          throw new Error('لا يمكن إلغاء فاتورة تم تحصيل مبلغ منها؛ سجّل مرتجعًا بطريقة الاسترداد الصحيحة')
        }
        if (sale.customerId) {
          const unallocatedCollections = await tx.customerPayment.count({
            where: { customerId: sale.customerId, saleId: null },
          })
          if (unallocatedCollections > 0) {
            throw new Error('لا يمكن إلغاء الفاتورة لوجود تحصيلات للعميل غير موزعة على فواتير؛ راجع كشف الحساب أولًا')
          }
        }
        for (const item of sale.items) await updateStock(tx, item.variantId, item.quantity)
        const due = money(Math.max(0, numeric(sale.total) - numeric(sale.paid)))
        if (sale.customerId && due > 0) {
          await tx.customer.update({ where: { id: sale.customerId }, data: { balance: { decrement: due }, updatedAt: new Date() } })
        }
        return tx.sale.update({ where: { id: sale.id }, data: { status: 'voided', voidReason: input.voidReason || 'إلغاء بدون سبب' } })
      }) as Promise<T>
    }

    case 'resume_sale': {
      return database.$transaction(async (tx) => {
        if (input.requiresOpenShift) {
          const openShift = await tx.registerSession.findFirst({
            where: { userId: String(input.userId || ''), status: 'open' },
            select: { id: true },
          })
          if (!openShift) throw new Error('الوردية اتقفلت قبل استئناف الفاتورة؛ افتح وردية جديدة وحاول مرة أخرى')
        }

        const sale = await tx.sale.findUnique({ where: { id: String(input.saleId || '') }, include: { items: true } })
        if (!sale) throw new Error('الفاتورة غير موجودة')
        if (sale.status !== 'draft') throw new Error('يمكن استئناف الفواتير المسودة فقط')
        const remainingDue = money(Math.max(0, numeric(sale.total) - numeric(sale.paid)))
        if (remainingDue > 0.001 && !sale.customerId) {
          throw new Error('لا يمكن استئناف فاتورة عليها مبلغ متبقٍ من دون ربطها بعميل')
        }
        const totals = new Map<string, number>()
        for (const item of sale.items) totals.set(item.variantId, (totals.get(item.variantId) || 0) + item.quantity)
        for (const [variantId, quantity] of totals) {
          const variant = await tx.productVariant.findUnique({ where: { id: variantId }, select: { quantity: true } })
          if (!variant || variant.quantity < quantity) throw new Error('المخزون غير كافٍ لإتمام الفاتورة')
        }
        for (const [variantId, quantity] of totals) await updateStock(tx, variantId, -quantity)
        if (sale.customerId) {
          const due = money(Math.max(0, numeric(sale.total) - numeric(sale.paid)))
          if (due > 0) await tx.customer.update({ where: { id: sale.customerId }, data: { balance: { increment: due }, updatedAt: new Date() } })
        }
        return tx.sale.update({ where: { id: sale.id }, data: { status: 'completed' } })
      }) as Promise<T>
    }

    case 'commit_stock_adjustment': {
      return database.$transaction(async (tx) => {
        const payload = input.payload ?? input
        const variantId = String(payload.variantId || '')
        const change = Number(payload.quantityChange)
        if (!variantId || !Number.isSafeInteger(change) || change === 0) throw new Error('قيمة التعديل غير صحيحة')
        await updateStock(tx, variantId, change)
        const variant = await tx.productVariant.findUnique({ where: { id: variantId }, select: { productId: true } })
        return tx.stockAdjustment.create({
          data: {
            id: id(),
            variantId,
            productId: variant.productId,
            userId: payload.userId || null,
            type: payload.type || 'adjustment',
            quantityChange: change,
            reason: payload.reason || null,
            notes: payload.notes || null,
          },
        })
      }) as Promise<T>
    }

    case 'commit_stock_adjustments': {
      return database.$transaction(async (tx) => {
        const rawKey = String(input.idempotencyKey || '').trim()
        const settingKey = rawKey ? `idempotency:stock-adjustment:${rawKey}` : ''
        if (settingKey) {
          const existing = await tx.setting.findUnique({ where: { key: settingKey } })
          if (existing) {
            try {
              const ids = JSON.parse(existing.value) as string[]
              if (!Array.isArray(ids) || ids.some((value) => typeof value !== 'string')) throw new Error('invalid ids')
              return tx.stockAdjustment.findMany({ where: { id: { in: ids } }, include: { variant: true } })
            } catch {
              throw new Error('مفتاح منع التكرار مرتبط بسجل غير صالح؛ راجع سجل العمليات')
            }
          }
        }

        const items = Array.isArray(input.items) ? input.items : []
        if (!items.length) throw new Error('لم يتم إرسال أصناف للتعديل')
        const normalized = items.map((item: AnyRecord) => {
          const variantId = String(item.variantId || '')
          const quantityChange = Number(item.quantityChange)
          if (!variantId || !Number.isSafeInteger(quantityChange) || quantityChange === 0) {
            throw new Error('بيانات تعديل المخزون غير صحيحة')
          }
          return {
            variantId,
            quantityChange,
            userId: input.userId || null,
            type: item.type || (input.mode === 'opening' ? 'adjustment' : 'stocktake'),
            reason: item.reason || (input.mode === 'opening' ? 'رصيد افتتاحي' : 'جرد'),
            notes: item.notes || null,
          }
        })
        const changes = new Map<string, number>()
        for (const item of normalized) {
          changes.set(item.variantId, (changes.get(item.variantId) || 0) + item.quantityChange)
        }
        const variants = await tx.productVariant.findMany({
          where: { id: { in: [...changes.keys()] } },
          select: { id: true, quantity: true, productId: true },
        })
        if (variants.length !== changes.size) throw new Error('بعض المنتجات غير موجودة')
        const variantMap = new Map(variants.map((variant: AnyRecord) => [variant.id, variant]))
        for (const [variantId, change] of changes) {
          const variant = variantMap.get(variantId) as AnyRecord
          if (variant.quantity + change < 0) throw new Error('لا يمكن أن يصبح المخزون بالسالب')
        }
        for (const [variantId, change] of changes) {
          const updated = await tx.productVariant.updateMany({
            where: { id: variantId, quantity: { gte: Math.max(0, -change) } },
            data: { quantity: { increment: change }, updatedAt: new Date() },
          })
          if (updated.count !== 1) throw new Error('تغير المخزون أثناء الجرد؛ أعد المحاولة')
        }
        const created: AnyRecord[] = []
        for (const item of normalized) {
          const variant = variantMap.get(item.variantId) as AnyRecord
          created.push(await tx.stockAdjustment.create({
            data: {
              id: id(),
              variantId: item.variantId,
              productId: variant.productId,
              userId: item.userId,
              type: item.type,
              quantityChange: item.quantityChange,
              reason: item.reason,
              notes: item.notes,
            },
          }))
        }
        if (settingKey) {
          await tx.setting.upsert({
            where: { key: settingKey },
            create: { id: id(), key: settingKey, value: JSON.stringify(created.map((row) => row.id)) },
            update: { value: JSON.stringify(created.map((row) => row.id)) },
          })
        }
        return created
      }) as Promise<T>
    }

    case 'void_purchase': {
      return database.$transaction(async (tx) => {
        const purchase = await tx.purchase.findUnique({ where: { id: String(input.purchaseId || '') }, include: { items: true, returns: true, supplierPayments: true } })
        if (!purchase) throw new Error('فاتورة الشراء غير موجودة')
        if (purchase.status !== 'completed') throw new Error('يمكن إلغاء فواتير الشراء المكتملة فقط')
        if (purchase.returns.length || purchase.supplierPayments.length || numeric(purchase.paid) > 0) {
          throw new Error('لا يمكن إلغاء فاتورة شراء عليها مرتجع أو دفعات؛ استخدم مرتجع الشراء وتسوية المورد')
        }
        const unallocatedPayments = await tx.supplierPayment.count({
          where: { supplierId: purchase.supplierId, purchaseId: null },
        })
        if (unallocatedPayments > 0) {
          throw new Error('لا يمكن إلغاء فاتورة الشراء لوجود دفعات للمورد غير موزعة على فواتير؛ استخدم مرتجع الشراء وراجع كشف المورد')
        }
        const totals = new Map<string, number>()
        for (const item of purchase.items) totals.set(item.variantId, (totals.get(item.variantId) || 0) + item.quantity)
        for (const [variantId, quantity] of totals) {
          const variant = await tx.productVariant.findUnique({ where: { id: variantId }, select: { quantity: true } })
          if (!variant || variant.quantity < quantity) throw new Error('المخزون الحالي لا يسمح بإلغاء فاتورة الشراء')
        }
        for (const [variantId, quantity] of totals) await updateStock(tx, variantId, -quantity)
        const due = money(Math.max(0, numeric(purchase.total) - numeric(purchase.paid)))
        if (due > 0) await tx.supplier.update({ where: { id: purchase.supplierId }, data: { balance: { decrement: due }, updatedAt: new Date() } })
        return tx.purchase.update({
          where: { id: purchase.id },
          data: { status: 'voided', notes: `${purchase.notes || ''} [void: ${input.voidReason || 'إلغاء بدون سبب'}]`.trim() },
        })
      }) as Promise<T>
    }

    default:
      throw new Error(`Unsupported local atomic action: ${action}`)
  }
}
