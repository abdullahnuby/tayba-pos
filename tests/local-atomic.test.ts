import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { localAtomicAction } from '../src/lib/local-atomic.ts'
import { recognizedLineRevenue, recognizedSaleRevenue } from '../src/lib/reporting.ts'

const databaseUrl = process.env.DATABASE_URL || ''
if (process.env.ALLOW_TAYBA_TEST_DATABASE !== '1') {
  throw new Error('Refusing to run database tests without ALLOW_TAYBA_TEST_DATABASE=1')
}
if (!databaseUrl.includes('tayba-test.db')) {
  throw new Error('Refusing to run against a database that is not named tayba-test.db')
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

let variantId = ''
let supplierId = ''
let customerId = ''
let saleId = ''
let saleItemId = ''
let purchaseId = ''
let purchaseItemId = ''

before(async () => {
  // The CI job creates a dedicated blank test database before this file runs.
  await db.saleReturnItem.deleteMany()
  await db.purchaseReturnItem.deleteMany()
  await db.customerPayment.deleteMany()
  await db.supplierPayment.deleteMany()
  await db.saleReturn.deleteMany()
  await db.purchaseReturn.deleteMany()
  await db.saleItem.deleteMany()
  await db.purchaseItem.deleteMany()
  await db.sale.deleteMany()
  await db.purchase.deleteMany()
  await db.stockAdjustment.deleteMany()
  await db.registerSession.deleteMany()
  await db.auditLog.deleteMany()
  await db.productVariant.deleteMany()
  await db.product.deleteMany()
  await db.category.deleteMany()
  await db.brand.deleteMany()
  await db.supplier.deleteMany()
  await db.customer.deleteMany()
  await db.user.deleteMany()
  await db.setting.deleteMany()

  const category = await db.category.create({ data: { name: 'CI Test Category' } })
  const product = await db.product.create({
    data: { name: 'CI Test Product', categoryId: category.id },
  })
  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: 'CI-TEST-SKU',
      quantity: 10,
      costPrice: 5,
      sellPrice: 10,
    },
  })
  const supplier = await db.supplier.create({ data: { name: 'CI Test Supplier' } })
  const customer = await db.customer.create({ data: { name: 'CI Test Customer' } })
  variantId = variant.id
  supplierId = supplier.id
  customerId = customer.id
})

after(async () => {
  await db.$disconnect()
})

test('sale is atomic, decrements stock, and deduplicates repeated submissions', async () => {
  const payload = {
    items: [{ variantId, quantity: 2, unitPrice: 10 }],
    discount: 0,
    paid: 20,
    paymentMethod: 'cash',
    status: 'completed',
    idempotencyKey: 'ci-sale-repeat-key',
  }
  const first = await localAtomicAction<any>(db, 'commit_sale', { payload })
  const repeated = await localAtomicAction<any>(db, 'commit_sale', { payload })
  assert.equal(first.id, repeated.id)
  assert.equal(await db.sale.count(), 1)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, 8)
  saleId = first.id
  saleItemId = first.items[0].id
})

test('sale rejects insufficient stock without partially writing', async () => {
  const countBefore = await db.sale.count()
  const quantityBefore = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'commit_sale', {
      payload: {
        items: [{ variantId, quantity: 99, unitPrice: 10 }],
        discount: 0, paid: 0, status: 'completed',
      },
    }),
    /المخزون غير كاف/,
  )
  assert.equal(await db.sale.count(), countBefore)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, quantityBefore)
})

test('sale returns use source invoice prices, reject duplicate-line overreturns, and are idempotent', async () => {
  await assert.rejects(
    localAtomicAction(db, 'commit_sale_return', {
      payload: {
        saleId,
        items: [
          { saleItemId, quantity: 1 },
          { saleItemId, quantity: 2 },
        ],
        refundMethod: 'cash',
      },
    }),
    /يتجاوز الكمية المباعة/,
  )
  const first = await localAtomicAction<any>(db, 'commit_sale_return', {
    payload: {
      saleId,
      idempotencyKey: 'ci-return-repeat-key',
      refundMethod: 'cash',
      items: [{ saleItemId, quantity: 1 }],
    },
  })
  const repeated = await localAtomicAction<any>(db, 'commit_sale_return', {
    payload: {
      saleId,
      idempotencyKey: 'ci-return-repeat-key',
      refundMethod: 'cash',
      items: [{ saleItemId, quantity: 1 }],
    },
  })
  assert.equal(first.id, repeated.id)
  assert.equal(first.total, 10)
  assert.equal(first.refundAmount, 10)
  assert.equal(await db.saleReturn.count(), 1)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, 9)

  const finalReturn = await localAtomicAction<any>(db, 'commit_sale_return', {
    payload: {
      saleId,
      idempotencyKey: 'ci-return-final-key',
      refundMethod: 'cash',
      items: [{ saleItemId, quantity: 1 }],
    },
  })
  assert.equal(finalReturn.total, 10)
  assert.equal((await db.sale.findUniqueOrThrow({ where: { id: saleId } })).status, 'returned')
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, 10)
})

test('cash return reduces outstanding customer debt before refunding cash', async () => {
  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      customerId,
      items: [{ variantId, quantity: 1, unitPrice: 10 }],
      discount: 0,
      paid: 0,
      paymentMethod: 'credit',
      status: 'completed',
    },
  })
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance, 10)

  const returned = await localAtomicAction<any>(db, 'commit_sale_return', {
    payload: {
      saleId: sale.id,
      idempotencyKey: 'ci-credit-return-key',
      refundMethod: 'cash',
      items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
    },
  })
  assert.equal(returned.total, 10)
  assert.equal(returned.refundAmount, 0)
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance, 0)
})

test('partially paid sale return offsets unpaid balance before issuing a cash refund', async () => {
  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      customerId,
      items: [{ variantId, quantity: 2, unitPrice: 10 }],
      discount: 0,
      paid: 15,
      paymentMethod: 'cash',
      status: 'completed',
      idempotencyKey: 'ci-partial-paid-return',
    },
  })
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance, 5)

  const returned = await localAtomicAction<any>(db, 'commit_sale_return', {
    payload: {
      saleId: sale.id,
      idempotencyKey: 'ci-partial-paid-return-key',
      refundMethod: 'cash',
      items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
    },
  })
  assert.equal(returned.total, 10)
  assert.equal(returned.refundAmount, 5)
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance, 0)
  assert.equal((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).status, 'partial_return')
})

test('resuming a draft reserves stock and applies only the remaining customer debt', async () => {
  const beforeQuantity = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  const draft = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      customerId,
      items: [{ variantId, quantity: 1, unitPrice: 10 }],
      discount: 0,
      paid: 3,
      paymentMethod: 'cash',
      status: 'draft',
      idempotencyKey: 'ci-resume-draft',
    },
  })
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, beforeQuantity)
  const beforeBalance = (await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance
  await localAtomicAction(db, 'resume_sale', { payload: { saleId: draft.id } })
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, beforeQuantity - 1)
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance, beforeBalance + 7)
})

test('purchase aggregates repeated variant lines and deduplicates repeated submissions', async () => {
  const beforePurchaseVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { quantity: true, costPrice: true } })
  const payload = {
    idempotencyKey: 'ci-purchase-repeat-key',
    supplierId,
    items: [
      { variantId, quantity: 2, unitCost: 7, enteredQuantity: 2, unit: 'piece', unitFactor: 1 },
      { variantId, quantity: 3, unitCost: 9, enteredQuantity: 3, unit: 'piece', unitFactor: 1 },
    ],
    discount: 0,
    paid: 0,
    status: 'completed',
  }
  const purchase = await localAtomicAction<any>(db, 'commit_purchase', { payload })
  const repeated = await localAtomicAction<any>(db, 'commit_purchase', { payload })
  assert.equal(purchase.id, repeated.id)
  assert.equal(await db.purchase.count(), 1)
  purchaseId = purchase.id
  purchaseItemId = purchase.items[0].id
  assert.equal(purchase.items.length, 2)
  const afterPurchaseVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })
  assert.equal(afterPurchaseVariant.quantity, beforePurchaseVariant.quantity + 5)
  const expectedWeightedCost = (beforePurchaseVariant.quantity * beforePurchaseVariant.costPrice + 2 * 7 + 3 * 9) / (beforePurchaseVariant.quantity + 5)
  assert.ok(Math.abs(afterPurchaseVariant.costPrice - expectedWeightedCost) < 0.0001)
})

test('purchase returns are linked to source lines and cannot exceed purchased quantity', async () => {
  const first = await localAtomicAction<any>(db, 'commit_purchase_return', {
    payload: {
      purchaseId,
      supplierId,
      refundMethod: 'cash',
      refundAmount: 7,
      items: [{ purchaseItemId, quantity: 1 }],
    },
  })
  assert.equal(first.items[0].purchaseItemId, purchaseItemId)
  assert.equal(first.total, 7)
  assert.equal(first.refundAmount, 7)
  assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).balance, 34)

  const creditReturn = await localAtomicAction<any>(db, 'commit_purchase_return', {
    payload: {
      purchaseId,
      supplierId,
      refundMethod: 'credit',
      items: [{ purchaseItemId, quantity: 1 }],
    },
  })
  assert.equal(creditReturn.refundAmount, 0)
  assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).balance, 27)

  const quantityAfterReturn = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'commit_purchase_return', {
      payload: {
        purchaseId,
        supplierId,
        items: [{ purchaseItemId, quantity: 2 }],
      },
    }),
    /تتجاوز الكمية المشتراة/,
  )
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, quantityAfterReturn)
})

test('voiding an unpaid purchase reverses its inventory and supplier balance atomically', async () => {
  const beforeQuantity = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  const beforeSupplierBalance = (await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).balance
  const purchase = await localAtomicAction<any>(db, 'commit_purchase', {
    payload: {
      idempotencyKey: 'ci-unpaid-purchase-void',
      supplierId,
      items: [{ variantId, quantity: 1, unitCost: 10, enteredQuantity: 1, unit: 'piece', unitFactor: 1 }],
      discount: 0,
      paid: 0,
      paymentMethod: 'cash',
      status: 'completed',
    },
  })
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, beforeQuantity + 1)
  assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).balance, beforeSupplierBalance + 10)

  const voided = await localAtomicAction<any>(db, 'void_purchase', { payload: { purchaseId: purchase.id, voidReason: 'CI unpaid reversal' } })
  assert.equal(voided.status, 'voided')
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, beforeQuantity)
  assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).balance, beforeSupplierBalance)
})

test('voiding a paid purchase is blocked rather than leaving an unrecorded cash refund', async () => {
  const purchase = await localAtomicAction<any>(db, 'commit_purchase', {
    payload: {
      idempotencyKey: 'ci-paid-purchase-void',
      supplierId,
      items: [{ variantId, quantity: 1, unitCost: 12, enteredQuantity: 1, unit: 'piece', unitFactor: 1 }],
      discount: 0,
      paid: 12,
      paymentMethod: 'cash',
      status: 'completed',
    },
  })
  const quantityBeforeVoid = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'void_purchase', { payload: { purchaseId: purchase.id, voidReason: 'CI paid reversal' } }),
    /لا يمكن إلغاء فاتورة شراء عليها مرتجع أو دفعات/,
  )
  assert.equal((await db.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).status, 'completed')
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, quantityBeforeVoid)
})

test('repeated bulk inventory requests with the same key apply only once', async () => {
  const before = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  const payload = {
    idempotencyKey: 'ci-stock-adjustment-key',
    items: [{ variantId, quantityChange: 1, type: 'stocktake', reason: 'CI repeat request' }],
    mode: 'stocktake',
  }
  const first = await localAtomicAction<any[]>(db, 'commit_stock_adjustments', { payload })
  const repeated = await localAtomicAction<any[]>(db, 'commit_stock_adjustments', { payload })
  assert.equal(first.length, 1)
  assert.equal(repeated.length, 1)
  assert.equal(first[0].id, repeated[0].id)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, before + 1)
})

test('profit reporting excludes VAT and allocates invoice discount proportionally', () => {
  const exclusiveSale = { subtotal: 200, total: 228, taxAmount: 28 }
  assert.equal(recognizedSaleRevenue(exclusiveSale), 200)
  assert.equal(recognizedLineRevenue(exclusiveSale, { total: 100 }), 100)
  assert.equal(
    recognizedLineRevenue(exclusiveSale, { total: 100 }) * 2,
    recognizedSaleRevenue(exclusiveSale),
  )

  // 200 of item prices less a 10 discount with VAT-inclusive prices:
  // invoice total is 190, of which 23.333... is VAT.
  const inclusiveSale = { subtotal: 200, total: 190, taxAmount: 190 - (190 / 1.14) }
  const firstLine = recognizedLineRevenue(inclusiveSale, { total: 100 })
  const secondLine = recognizedLineRevenue(inclusiveSale, { total: 100 })
  assert.ok(Math.abs(firstLine + secondLine - (190 / 1.14)) < 0.0001)
})

test('VAT-inclusive settings keep the entered total inclusive of VAT', async () => {
  await db.setting.upsert({ where: { key: 'vatEnabled' }, update: { value: 'true' }, create: { key: 'vatEnabled', value: 'true' } })
  await db.setting.upsert({ where: { key: 'vatRate' }, update: { value: '14' }, create: { key: 'vatRate', value: '14' } })
  await db.setting.upsert({ where: { key: 'vatInclusive' }, update: { value: 'true' }, create: { key: 'vatInclusive', value: 'true' } })

  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      items: [{ variantId, quantity: 1, unitPrice: 100 }],
      discount: 0,
      paid: 100,
      paymentMethod: 'cash',
      status: 'completed',
      idempotencyKey: 'ci-vat-inclusive-sale',
    },
  })
  assert.equal(sale.total, 100)
  assert.ok(Math.abs(sale.taxAmount - (100 - 100 / 1.14)) < 0.0001)
})

test('voiding a paid sale is blocked so refunds cannot disappear from cash accounting', async () => {
  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      items: [{ variantId, quantity: 1, unitPrice: 10 }],
      discount: 0,
      paid: 10,
      paymentMethod: 'cash',
      status: 'completed',
      idempotencyKey: 'ci-paid-void-sale',
    },
  })
  const quantityBeforeVoid = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'void_sale', { payload: { saleId: sale.id, voidReason: 'CI test' } }),
    /تم تحصيل مبلغ منها/,
  )
  assert.equal((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).status, 'completed')
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, quantityBeforeVoid)
})

test('voiding an unpaid credit sale restores stock and removes recorded customer debt', async () => {
  const beforeVoidBalance = (await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance
  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      customerId,
      items: [{ variantId, quantity: 1, unitPrice: 10 }],
      discount: 0,
      paid: 0,
      paymentMethod: 'credit',
      status: 'completed',
      idempotencyKey: 'ci-unpaid-void-sale',
    },
  })
  const beforeVoidQuantity = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance, beforeVoidBalance + 10)

  const voided = await localAtomicAction<any>(db, 'void_sale', { payload: { saleId: sale.id, voidReason: 'CI credit reversal' } })
  assert.equal(voided.status, 'voided')
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, beforeVoidQuantity + 1)
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance, beforeVoidBalance)
})

test('SQLite backup snapshot passes integrity check and can be opened independently', async () => {
  const backupPath = resolve(process.cwd(), 'data', 'tayba-test-snapshot.db')
  await unlink(backupPath).catch(() => undefined)
  const beforeCounts = {
    sales: await db.sale.count(),
    purchases: await db.purchase.count(),
    saleReturns: await db.saleReturn.count(),
    purchaseReturns: await db.purchaseReturn.count(),
    adjustments: await db.stockAdjustment.count(),
  }

  try {
    const escapedPath = backupPath.replace(/'/g, "''")
    await db.$executeRawUnsafe(`VACUUM INTO '${escapedPath}'`)
    const snapshotDb = new PrismaClient({ datasources: { db: { url: `file:${backupPath}` } } })
    try {
      const integrity = await snapshotDb.$queryRawUnsafe<Array<{ quick_check: string }>>('PRAGMA quick_check')
      assert.equal(integrity[0]?.quick_check, 'ok')
      assert.deepEqual({
        sales: await snapshotDb.sale.count(),
        purchases: await snapshotDb.purchase.count(),
        saleReturns: await snapshotDb.saleReturn.count(),
        purchaseReturns: await snapshotDb.purchaseReturn.count(),
        adjustments: await snapshotDb.stockAdjustment.count(),
      }, beforeCounts)
    } finally {
      await snapshotDb.$disconnect()
    }
  } finally {
    await unlink(backupPath).catch(() => undefined)
  }
})

test('bulk stock adjustment is all-or-nothing if one variant is invalid', async () => {
  const beforeQuantity = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  const beforeCount = await db.stockAdjustment.count()
  await assert.rejects(
    localAtomicAction(db, 'commit_stock_adjustments', {
      payload: {
        mode: 'stocktake',
        items: [
          { variantId, quantityChange: 2, type: 'stocktake' },
          { variantId: 'does-not-exist', quantityChange: -1, type: 'stocktake' },
        ],
      },
    }),
    /بعض المنتجات غير موجودة/,
  )
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, beforeQuantity)
  assert.equal(await db.stockAdjustment.count(), beforeCount)
})
