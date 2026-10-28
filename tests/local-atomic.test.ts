import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { localAtomicAction } from '../src/lib/local-atomic.ts'

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
  variantId = variant.id
  supplierId = supplier.id
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

test('purchase aggregates repeated variant lines before calculating weighted cost', async () => {
  const purchase = await localAtomicAction<any>(db, 'commit_purchase', {
    payload: {
      supplierId,
      items: [
        { variantId, quantity: 2, unitCost: 7, enteredQuantity: 2, unit: 'piece', unitFactor: 1 },
        { variantId, quantity: 3, unitCost: 9, enteredQuantity: 3, unit: 'piece', unitFactor: 1 },
      ],
      discount: 0,
      paid: 0,
      status: 'completed',
    },
  })
  purchaseId = purchase.id
  purchaseItemId = purchase.items[0].id
  assert.equal(purchase.items.length, 2)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, 15)
  assert.ok(Math.abs((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).costPrice - (91 / 15)) < 0.0001)
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

  const quantityAfterReturn = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'commit_purchase_return', {
      payload: {
        purchaseId,
        supplierId,
        items: [{ purchaseItemId, quantity: 2 }],
      },
    }),
    /يتجاوز الكمية المشتراة/,
  )
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, quantityAfterReturn)
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
