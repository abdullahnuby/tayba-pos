import { PrismaD1 } from '@prisma/adapter-d1'
import { env as cloudflareEnv } from 'cloudflare:workers'

type D1Database = ConstructorParameters<typeof PrismaD1>[0]

type BatchResult = {
  success: boolean
  results?: any[]
  meta?: { changes?: number }
}

type Statement = {
  sql: string
  params?: any[]
}

export function getD1Binding(): D1Database | undefined {
  try {
    return (cloudflareEnv as { DB?: D1Database }).DB
  } catch {
    return undefined
  }
}

async function batch(d1: D1Database, statements: Statement[]): Promise<BatchResult[]> {
  const prepared = statements.map(({ sql, params = [] }) =>
    d1.prepare(sql).bind(...params)
  )

  const results = (await d1.batch(prepared)) as BatchResult[]
  const failed = results.findIndex((result) => !result.success)
  if (failed >= 0) {
    throw new Error(`D1 batch statement ${failed + 1} failed`)
  }
  return results
}

export async function d1Batch(
  d1: D1Database,
  statements: Statement[]
): Promise<BatchResult[]> {
  return batch(d1, statements)
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveInt(value: unknown, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} يجب أن يكون عددًا صحيحًا موجبًا`)
  }
  return parsed
}

function nowIso(input: unknown): string {
  if (input) {
    const date = new Date(String(input))
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

function id(): string {
  return crypto.randomUUID()
}

/**
 * Force the whole D1 batch to abort when a business-rule condition is true.
 * Setting.value is NOT NULL, so the conditional NULL insert fails and D1
 * rolls back every previous statement in the batch.
 */
function guardFailure(
  statements: Statement[],
  conditionSql: string,
  params: any[]
) {
  statements.push({
    sql: `
      INSERT INTO "Setting" (id, key, value)
      SELECT ?, ?, NULL
      WHERE ${conditionSql}
    `,
    params: [id(), `__d1_guard_${id()}`, ...params],
  })
}

function invoiceCounterStatements(statements: Statement[], counterKey: string) {
  statements.push({
    sql: `
      INSERT INTO "Setting" (id, key, value)
      VALUES (?, ?, '1')
      ON CONFLICT(key)
      DO UPDATE SET value = CAST(value AS INTEGER) + 1
    `,
    params: [id(), counterKey],
  })
}

function invoiceExpression(prefixKey: string, counterKey: string, fallback: string) {
  return {
    sql: `
      COALESCE(
        NULLIF((SELECT value FROM "Setting" WHERE key = ?), ''),
        ?
      ) || '-' || printf(
        '%06d',
        CAST((SELECT value FROM "Setting" WHERE key = ?) AS INTEGER)
      )
    `,
    params: [prefixKey, fallback, counterKey],
  }
}

export async function d1AtomicAction<T = any>(
  action: string,
  input: Record<string, any>,
  d1 = getD1Binding()
): Promise<T> {
  if (!d1) throw new Error('لا يوجد اتصال Cloudflare D1')

  switch (action) {
    case 'commit_sale': {
      const items = Array.isArray(input.items) ? input.items : []
      if (!items.length) {
        throw new Error('الفاتورة يجب أن تحتوي على منتج واحد على الأقل')
      }

      const subtotal = items.reduce(
        (sum: number, item: any) =>
          sum + number(item.unitPrice) * positiveInt(item.quantity, 'الكمية'),
        0
      )
      const discount = Math.max(0, number(input.discount))

      const vatEnabledResult = await d1
        .prepare('SELECT value FROM "Setting" WHERE key = ?')
        .bind('vatEnabled')
        .all<any>()
      const vatRateResult = await d1
        .prepare('SELECT value FROM "Setting" WHERE key = ?')
        .bind('vatRate')
        .all<any>()

      const taxEnabled =
        String(vatEnabledResult.results?.[0]?.value ?? 'false').toLowerCase() === 'true'
      const vatRate = number(vatRateResult.results?.[0]?.value, 14)
      const afterDiscount = Math.max(0, subtotal - discount)
      const taxAmount = taxEnabled ? afterDiscount * (vatRate / 100) : 0
      const total = afterDiscount + taxAmount
      const paid = Math.max(0, number(input.paid))
      const change = Math.max(0, paid - total)
      const status = input.status || 'completed'
      const completed = status === 'completed'

      const variantsById = new Map<string, any>()
      const quantities = new Map<string, number>()

      for (const item of items) {
        const variantId = String(item.variantId || '')
        if (!variantId) throw new Error('بعض بنود الفاتورة غير صحيحة')
        const qty = positiveInt(item.quantity, 'الكمية')
        const result = await d1
          .prepare('SELECT id, sku, costPrice, quantity FROM "ProductVariant" WHERE id = ?')
          .bind(variantId)
          .all<any>()
        const variant = result.results?.[0]
        if (!variant) throw new Error('بعض المنتجات غير موجودة')
        variantsById.set(variantId, variant)
        quantities.set(variantId, (quantities.get(variantId) || 0) + qty)
      }

      const saleId = id()
      const statements: Statement[] = []

      if (completed) {
        for (const [variantId, qty] of quantities) {
          guardFailure(
            statements,
            'NOT EXISTS (SELECT 1 FROM "ProductVariant" WHERE id = ? AND quantity >= ?)',
            [variantId, qty]
          )
        }
      }

      invoiceCounterStatements(statements, 'saleCounter')
      const invoice = invoiceExpression('saleInvoicePrefix', 'saleCounter', 'INV')

      statements.push({
        sql: `
          INSERT INTO "Sale" (
            id, invoiceNo, customerId, userId, date, subtotal, discount,
            taxRate, taxAmount, total, paid, change, paymentMethod, status, notes
          )
          SELECT ?, ${invoice.sql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        `,
        params: [
          saleId,
          ...invoice.params,
          input.customerId || null,
          input.userId || null,
          nowIso(input.date),
          subtotal,
          discount,
          taxEnabled ? vatRate : 0,
          taxAmount,
          total,
          paid,
          change,
          input.paymentMethod || 'cash',
          status,
          input.notes || null,
        ],
      })

      for (const item of items) {
        const variantId = String(item.variantId)
        const qty = positiveInt(item.quantity, 'الكمية')
        const variant = variantsById.get(variantId)
        const unitPrice = number(item.unitPrice)
        statements.push({
          sql: `
            INSERT INTO "SaleItem" (
              id, saleId, variantId, quantity, unitPrice, unitCost, total
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          params: [
            id(),
            saleId,
            variantId,
            qty,
            unitPrice,
            number(variant.costPrice),
            unitPrice * qty,
          ],
        })
      }

      if (completed) {
        for (const [variantId, qty] of quantities) {
          statements.push({
            sql: 'UPDATE "ProductVariant" SET quantity = quantity - ?, updatedAt = ? WHERE id = ?',
            params: [qty, new Date().toISOString(), variantId],
          })
        }

        if (input.customerId && total - paid > 0) {
          statements.push({
            sql: 'UPDATE "Customer" SET balance = balance + ?, updatedAt = ? WHERE id = ?',
            params: [total - paid, new Date().toISOString(), input.customerId],
          })
        }
      }

      statements.push({
        sql: 'SELECT * FROM "Sale" WHERE id = ?',
        params: [saleId],
      })
      statements.push({
        sql: 'SELECT * FROM "SaleItem" WHERE saleId = ? ORDER BY rowid',
        params: [saleId],
      })

      const results = await batch(d1, statements)
      const sale = results.at(-2)?.results?.[0]
      const saleItems = results.at(-1)?.results || []
      if (!sale) throw new Error('تعذر حفظ الفاتورة')
      return { ...sale, items: saleItems } as T
    }

    case 'commit_sale_return': {
      const items = Array.isArray(input.items) ? input.items : []
      if (!items.length) throw new Error('يجب تحديد بنود للإرجاع')

      const sale = (
        await d1.prepare('SELECT * FROM "Sale" WHERE id = ?').bind(input.saleId).all<any>()
      ).results?.[0]
      if (!sale) throw new Error('الفاتورة غير موجودة')
      if (['voided', 'draft'].includes(String(sale.status))) {
        throw new Error('لا يمكن إرجاع فاتورة ملغاة أو مسودة')
      }

      const saleItems = (
        await d1
          .prepare('SELECT * FROM "SaleItem" WHERE saleId = ? ORDER BY rowid')
          .bind(sale.id)
          .all<any>()
      ).results || []
      const saleItemMap = new Map<string, any>(saleItems.map((row: any) => [row.id, row]))

      const returnedRows = (
        await d1
          .prepare(`
            SELECT sri.saleItemId, COALESCE(SUM(sri.quantity), 0) AS returnedQty
            FROM "SaleReturnItem" sri
            JOIN "SaleReturn" sr ON sr.id = sri.saleReturnId
            WHERE sr.saleId = ?
            GROUP BY sri.saleItemId
          `)
          .bind(sale.id)
          .all<any>()
      ).results || []
      const returnedMap = new Map<string, number>(
        returnedRows.map((row: any) => [row.saleItemId, number(row.returnedQty)])
      )

      let subtotal = 0
      const normalizedItems: any[] = []
      for (const item of items) {
        const saleItem = saleItemMap.get(item.saleItemId)
        if (!saleItem) throw new Error('بند الفاتورة غير صحيح')

        const qty = positiveInt(item.quantity, 'كمية الإرجاع')
        const alreadyReturned = returnedMap.get(saleItem.id) || 0
        if (alreadyReturned + qty > Number(saleItem.quantity)) {
          throw new Error('كمية الإرجاع تتجاوز الكمية المباعة')
        }

        const unitPrice = number(item.unitPrice, number(saleItem.unitPrice))
        subtotal += unitPrice * qty
        normalizedItems.push({ saleItem, qty, unitPrice })
      }

      const allReturned = saleItems.every((saleItem: any) => {
        const previous = returnedMap.get(saleItem.id) || 0
        const added = normalizedItems
          .filter((item) => item.saleItem.id === saleItem.id)
          .reduce((sum, item) => sum + item.qty, 0)
        return previous + added >= Number(saleItem.quantity)
      })

      const returnId = id()
      const statements: Statement[] = []
      invoiceCounterStatements(statements, 'returnCounter')
      const invoice = invoiceExpression('returnPrefix', 'returnCounter', 'RET')

      statements.push({
        sql: `
          INSERT INTO "SaleReturn" (
            id, returnNo, saleId, customerId, date, subtotal, total, reason, notes, status
          )
          SELECT ?, ${invoice.sql}, ?, ?, ?, ?, ?, ?, ?, 'completed'
        `,
        params: [
          returnId,
          ...invoice.params,
          sale.id,
          sale.customerId || null,
          nowIso(input.date),
          0,
          0,
          input.reason || null,
          input.notes || null,
        ],
      })

      for (const item of normalizedItems) {
        guardFailure(
          statements,
          'NOT EXISTS (SELECT 1 FROM "ProductVariant" WHERE id = ?)',
          [item.saleItem.variantId]
        )
        statements.push({
          sql: `
            INSERT INTO "SaleReturnItem" (
              id, saleReturnId, saleItemId, variantId, quantity, unitPrice, total
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          params: [
            id(),
            returnId,
            item.saleItem.id,
            item.saleItem.variantId,
            item.qty,
            item.unitPrice,
            item.unitPrice * item.qty,
          ],
        })
        statements.push({
          sql: 'UPDATE "ProductVariant" SET quantity = quantity + ?, updatedAt = ? WHERE id = ?',
          params: [item.qty, new Date().toISOString(), item.saleItem.variantId],
        })
      }

      statements.push({
        sql: 'UPDATE "SaleReturn" SET subtotal = ?, total = ? WHERE id = ?',
        params: [subtotal, subtotal, returnId],
      })
      statements.push({
        sql: 'UPDATE "Sale" SET status = ? WHERE id = ?',
        params: [allReturned ? 'returned' : 'partial_return', sale.id],
      })
      statements.push({ sql: 'SELECT * FROM "SaleReturn" WHERE id = ?', params: [returnId] })
      statements.push({
        sql: 'SELECT * FROM "SaleReturnItem" WHERE saleReturnId = ? ORDER BY rowid',
        params: [returnId],
      })

      const results = await batch(d1, statements)
      const created = results.at(-2)?.results?.[0]
      const createdItems = results.at(-1)?.results || []
      if (!created) throw new Error('تعذر حفظ المرتجع')
      return { ...created, subtotal, total: subtotal, items: createdItems } as T
    }

    case 'commit_purchase': {
      const items = Array.isArray(input.items) ? input.items : []
      if (!items.length) {
        throw new Error('فاتورة الشراء يجب أن تحتوي على بند واحد على الأقل')
      }

      const subtotal = items.reduce(
        (sum: number, item: any) =>
          sum + number(item.unitCost) * positiveInt(item.quantity, 'الكمية'),
        0
      )
      const discount = Math.max(0, number(input.discount))

      const vatEnabledResult = await d1
        .prepare('SELECT value FROM "Setting" WHERE key = ?')
        .bind('vatEnabled')
        .all<any>()
      const vatRateResult = await d1
        .prepare('SELECT value FROM "Setting" WHERE key = ?')
        .bind('vatRate')
        .all<any>()
      const taxEnabled =
        String(vatEnabledResult.results?.[0]?.value ?? 'false').toLowerCase() === 'true'
      const vatRate = number(vatRateResult.results?.[0]?.value, 14)
      const afterDiscount = Math.max(0, subtotal - discount)
      const taxAmount = taxEnabled ? afterDiscount * (vatRate / 100) : 0
      const total = afterDiscount + taxAmount
      const paid = Math.max(0, number(input.paid))
      const completed = (input.status || 'completed') === 'completed'

      for (const item of items) {
        const variantId = String(item.variantId || '')
        if (!variantId) throw new Error('بعض بنود فاتورة الشراء غير صحيحة')
        const exists = (
          await d1
            .prepare('SELECT id FROM "ProductVariant" WHERE id = ?')
            .bind(variantId)
            .all<any>()
        ).results?.[0]
        if (!exists) throw new Error('بعض المنتجات غير موجودة')
      }

      const purchaseId = id()
      const statements: Statement[] = []
      invoiceCounterStatements(statements, 'purchaseCounter')
      const invoice = invoiceExpression('purchaseInvoicePrefix', 'purchaseCounter', 'PUR')

      statements.push({
        sql: `
          INSERT INTO "Purchase" (
            id, invoiceNo, supplierId, date, subtotal, discount,
            taxRate, taxAmount, total, paid, status, notes
          )
          SELECT ?, ${invoice.sql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        `,
        params: [
          purchaseId,
          ...invoice.params,
          input.supplierId,
          nowIso(input.date),
          subtotal,
          discount,
          taxEnabled ? vatRate : 0,
          taxAmount,
          total,
          paid,
          input.status || 'completed',
          input.notes || null,
        ],
      })

      for (const item of items) {
        const variantId = String(item.variantId)
        const qty = positiveInt(item.quantity, 'الكمية')
        const unitCost = Math.max(0, number(item.unitCost))

        statements.push({
          sql: `
            INSERT INTO "PurchaseItem" (
              id, purchaseId, variantId, quantity, unitCost, total,
              enteredQuantity, unit, unitFactor
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          params: [
            id(),
            purchaseId,
            variantId,
            qty,
            unitCost,
            unitCost * qty,
            number(item.enteredQuantity, qty),
            item.unit || 'piece',
            Math.max(1, Math.trunc(number(item.unitFactor, 1))),
          ],
        })

        if (completed) {
          statements.push({
            sql: `
              UPDATE "ProductVariant"
              SET quantity = quantity + ?,
                  costPrice = ((quantity * costPrice) + (? * ?)) / MAX(1, quantity + ?),
                  updatedAt = ?
              WHERE id = ?
            `,
            params: [
              qty,
              qty,
              unitCost,
              qty,
              new Date().toISOString(),
              variantId,
            ],
          })
        }
      }

      if (completed && total - paid > 0) {
        statements.push({
          sql: 'UPDATE "Supplier" SET balance = balance + ?, updatedAt = ? WHERE id = ?',
          params: [total - paid, new Date().toISOString(), input.supplierId],
        })
      }

      statements.push({ sql: 'SELECT * FROM "Purchase" WHERE id = ?', params: [purchaseId] })
      statements.push({
        sql: 'SELECT * FROM "PurchaseItem" WHERE purchaseId = ? ORDER BY rowid',
        params: [purchaseId],
      })

      const results = await batch(d1, statements)
      const created = results.at(-2)?.results?.[0]
      const createdItems = results.at(-1)?.results || []
      if (!created) throw new Error('تعذر حفظ فاتورة الشراء')
      return { ...created, items: createdItems } as T
    }

    case 'void_sale': {
      const sale = (
        await d1.prepare('SELECT * FROM "Sale" WHERE id = ?').bind(input.saleId).all<any>()
      ).results?.[0]
      if (!sale) throw new Error('الفاتورة غير موجودة')
      if (sale.status !== 'completed') throw new Error('يمكن إلغاء الفواتير المكتملة فقط')

      const items = (
        await d1
          .prepare('SELECT * FROM "SaleItem" WHERE saleId = ? ORDER BY rowid')
          .bind(sale.id)
          .all<any>()
      ).results || []

      const statements: Statement[] = []
      guardFailure(
        statements,
        'NOT EXISTS (SELECT 1 FROM "Sale" WHERE id = ? AND status = \'completed\')',
        [sale.id]
      )

      for (const item of items) {
        guardFailure(
          statements,
          'NOT EXISTS (SELECT 1 FROM "ProductVariant" WHERE id = ?)',
          [item.variantId]
        )
        statements.push({
          sql: 'UPDATE "ProductVariant" SET quantity = quantity + ?, updatedAt = ? WHERE id = ?',
          params: [item.quantity, new Date().toISOString(), item.variantId],
        })
      }

      const due = number(sale.total) - number(sale.paid)
      if (sale.customerId && due > 0) {
        statements.push({
          sql: 'UPDATE "Customer" SET balance = balance - ?, updatedAt = ? WHERE id = ?',
          params: [due, new Date().toISOString(), sale.customerId],
        })
      }

      statements.push({
        sql: 'UPDATE "Sale" SET status = ?, voidReason = ? WHERE id = ?',
        params: ['voided', input.voidReason || 'إلغاء بدون سبب', sale.id],
      })
      statements.push({ sql: 'SELECT * FROM "Sale" WHERE id = ?', params: [sale.id] })

      const results = await batch(d1, statements)
      return (results.at(-1)?.results?.[0] || null) as T
    }

    case 'resume_sale': {
      const sale = (
        await d1.prepare('SELECT * FROM "Sale" WHERE id = ?').bind(input.saleId).all<any>()
      ).results?.[0]
      if (!sale) throw new Error('الفاتورة غير موجودة')
      if (sale.status !== 'draft') throw new Error('يمكن استئناف الفواتير المسودة فقط')

      const items = (
        await d1
          .prepare('SELECT * FROM "SaleItem" WHERE saleId = ? ORDER BY rowid')
          .bind(sale.id)
          .all<any>()
      ).results || []

      const quantities = new Map<string, number>()
      for (const item of items) {
        quantities.set(
          item.variantId,
          (quantities.get(item.variantId) || 0) + number(item.quantity)
        )
      }

      const statements: Statement[] = []
      for (const [variantId, qty] of quantities) {
        guardFailure(
          statements,
          'NOT EXISTS (SELECT 1 FROM "ProductVariant" WHERE id = ? AND quantity >= ?)',
          [variantId, qty]
        )
      }
      for (const [variantId, qty] of quantities) {
        statements.push({
          sql: 'UPDATE "ProductVariant" SET quantity = quantity - ?, updatedAt = ? WHERE id = ?',
          params: [qty, new Date().toISOString(), variantId],
        })
      }
      statements.push({ sql: 'UPDATE "Sale" SET status = ? WHERE id = ?', params: ['completed', sale.id] })
      statements.push({ sql: 'SELECT * FROM "Sale" WHERE id = ?', params: [sale.id] })

      const results = await batch(d1, statements)
      return (results.at(-1)?.results?.[0] || null) as T
    }

    case 'commit_stock_adjustment': {
      const payload = input.payload ?? input
      const variantId = String(payload.variantId || '')
      const change = Number(payload.quantityChange || 0)
      if (!variantId || !Number.isInteger(change) || change === 0) {
        throw new Error('قيمة التعديل غير صحيحة')
      }

      const adjustmentId = id()
      const statements: Statement[] = []
      guardFailure(
        statements,
        'NOT EXISTS (SELECT 1 FROM "ProductVariant" WHERE id = ? AND quantity + ? >= 0)',
        [variantId, change]
      )
      statements.push({
        sql: `
          INSERT INTO "StockAdjustment" (
            id, variantId, productId, userId, type, quantityChange, reason, notes
          )
          SELECT ?, ?, productId, ?, ?, ?, ?, ?
          FROM "ProductVariant" WHERE id = ?
        `,
        params: [
          adjustmentId,
          variantId,
          payload.userId || null,
          payload.type || 'adjustment',
          change,
          payload.reason || null,
          payload.notes || null,
          variantId,
        ],
      })
      statements.push({
        sql: 'UPDATE "ProductVariant" SET quantity = quantity + ?, updatedAt = ? WHERE id = ?',
        params: [change, new Date().toISOString(), variantId],
      })
      statements.push({
        sql: 'SELECT * FROM "StockAdjustment" WHERE id = ?',
        params: [adjustmentId],
      })

      const results = await batch(d1, statements)
      return (results.at(-1)?.results?.[0] || null) as T
    }

    case 'void_purchase': {
      const purchase = (
        await d1.prepare('SELECT * FROM "Purchase" WHERE id = ?').bind(input.purchaseId).all<any>()
      ).results?.[0]
      if (!purchase) throw new Error('فاتورة الشراء غير موجودة')
      if (purchase.status !== 'completed') throw new Error('يمكن إلغاء فواتير الشراء المكتملة فقط')

      const items = (
        await d1
          .prepare('SELECT * FROM "PurchaseItem" WHERE purchaseId = ? ORDER BY rowid')
          .bind(purchase.id)
          .all<any>()
      ).results || []

      const statements: Statement[] = []
      guardFailure(
        statements,
        'NOT EXISTS (SELECT 1 FROM "Purchase" WHERE id = ? AND status = \'completed\')',
        [purchase.id]
      )
      for (const item of items) {
        guardFailure(
          statements,
          'NOT EXISTS (SELECT 1 FROM "ProductVariant" WHERE id = ? AND quantity >= ?)',
          [item.variantId, item.quantity]
        )
      }
      for (const item of items) {
        statements.push({
          sql: 'UPDATE "ProductVariant" SET quantity = quantity - ?, updatedAt = ? WHERE id = ?',
          params: [item.quantity, new Date().toISOString(), item.variantId],
        })
      }

      const due = number(purchase.total) - number(purchase.paid)
      if (purchase.supplierId && due > 0) {
        statements.push({
          sql: 'UPDATE "Supplier" SET balance = balance - ?, updatedAt = ? WHERE id = ?',
          params: [due, new Date().toISOString(), purchase.supplierId],
        })
      }

      statements.push({
        sql: 'UPDATE "Purchase" SET status = ?, notes = ? WHERE id = ?',
        params: [
          'voided',
          `${purchase.notes || ''} [void: ${input.voidReason || 'إلغاء بدون سبب'}]`,
          purchase.id,
        ],
      })
      statements.push({
        sql: 'SELECT * FROM "Purchase" WHERE id = ?',
        params: [purchase.id],
      })

      const results = await batch(d1, statements)
      return (results.at(-1)?.results?.[0] || null) as T
    }

    default:
      throw new Error(`Unsupported atomic action: ${action}`)
  }
}
