import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { localAtomicAction } from '../src/lib/local-atomic.ts'
import { recognizedLineRevenue, recognizedReturnRevenue, recognizedSaleRevenue } from '../src/lib/reporting.ts'

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

test('split returns reconcile exactly to invoice totals despite fractional unit prices', async () => {
  await db.setting.upsert({ where: { key: 'vatEnabled' }, update: { value: 'false' }, create: { key: 'vatEnabled', value: 'false' } })
  await db.setting.upsert({ where: { key: 'vatInclusive' }, update: { value: 'false' }, create: { key: 'vatInclusive', value: 'false' } })
  const stockBefore = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      items: [{ variantId, quantity: 3, unitPrice: 1 / 3 }],
      discount: 0,
      paid: 1,
      paymentMethod: 'cash',
      status: 'completed',
      idempotencyKey: 'ci-split-return-cents-sale',
    },
  })
  assert.equal(sale.total, 1)
  const saleReturns = []
  for (let index = 0; index < 3; index++) {
    saleReturns.push(await localAtomicAction<any>(db, 'commit_sale_return', {
      payload: {
        saleId: sale.id,
        idempotencyKey: `ci-split-return-cents-sale-${index}`,
        refundMethod: 'cash',
        items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
      },
    }))
  }
  assert.deepEqual(saleReturns.map((returned) => returned.total), [0.33, 0.33, 0.34])
  assert.equal(saleReturns.reduce((sum, returned) => sum + returned.total, 0), sale.total)
  assert.equal(saleReturns.reduce((sum, returned) => sum + returned.items.reduce((lineSum: number, item: any) => lineSum + item.total, 0), 0), sale.total)
  assert.equal(saleReturns.reduce((sum, returned) => sum + recognizedReturnRevenue(sale, returned.total), 0), recognizedSaleRevenue(sale))
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, stockBefore)

  const cleanSupplier = await db.supplier.create({ data: { name: 'CI split-return supplier' } })
  const purchase = await localAtomicAction<any>(db, 'commit_purchase', {
    payload: {
      idempotencyKey: 'ci-split-return-cents-purchase',
      supplierId: cleanSupplier.id,
      items: [{ variantId, quantity: 3, unitCost: 1 / 3, enteredQuantity: 3, unit: 'piece', unitFactor: 1 }],
      discount: 0,
      paid: 1,
      paymentMethod: 'cash',
      status: 'completed',
    },
  })
  assert.equal(purchase.total, 1)
  const purchaseReturns = []
  for (let index = 0; index < 3; index++) {
    purchaseReturns.push(await localAtomicAction<any>(db, 'commit_purchase_return', {
      payload: {
        purchaseId: purchase.id,
        supplierId: cleanSupplier.id,
        refundMethod: 'cash',
        items: [{ purchaseItemId: purchase.items[0].id, quantity: 1 }],
      },
    }))
  }
  assert.deepEqual(purchaseReturns.map((returned) => returned.total), [0.33, 0.33, 0.34])
  assert.equal(purchaseReturns.reduce((sum, returned) => sum + returned.total, 0), purchase.total)
  assert.equal(purchaseReturns.reduce((sum, returned) => sum + returned.items.reduce((lineSum: number, item: any) => lineSum + item.total, 0), 0), purchase.total)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, stockBefore)
  assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: cleanSupplier.id } })).balance, 0)
})

test('invoice line totals and balances are rounded to cents', async () => {
  await db.setting.upsert({ where: { key: 'vatEnabled' }, update: { value: 'false' }, create: { key: 'vatEnabled', value: 'false' } })
  await db.setting.upsert({ where: { key: 'vatInclusive' }, update: { value: 'false' }, create: { key: 'vatInclusive', value: 'false' } })

  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      items: [{ variantId, quantity: 3, unitPrice: 0.1 }],
      discount: 0,
      paid: 0.3,
      paymentMethod: 'cash',
      status: 'completed',
      idempotencyKey: 'ci-money-cents-rounding',
    },
  })
  assert.equal(sale.subtotal, 0.3)
  assert.equal(sale.total, 0.3)
  assert.equal(sale.paid, 0.3)
  assert.equal(sale.items[0].total, 0.3)
  assert.equal(sale.change, 0)
})

test('pack-unit sale and purchase totals remain exact after base-unit conversion', async () => {
  await db.setting.upsert({ where: { key: 'vatEnabled' }, update: { value: 'false' }, create: { key: 'vatEnabled', value: 'false' } })
  await db.setting.upsert({ where: { key: 'vatInclusive' }, update: { value: 'false' }, create: { key: 'vatInclusive', value: 'false' } })
  const product = await db.product.findFirstOrThrow()
  const packVariant = await db.productVariant.create({
    data: { productId: product.id, sku: 'CI-PACK-PRECISION', quantity: 100, costPrice: 4, sellPrice: 2 },
  })

  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      items: [{ variantId: packVariant.id, quantity: 12, unitPrice: 20 / 12 }],
      discount: 0,
      paid: 20,
      paymentMethod: 'cash',
      status: 'completed',
      idempotencyKey: 'ci-dozen-sale-total',
    },
  })
  assert.equal(sale.subtotal, 20)
  assert.equal(sale.total, 20)
  assert.equal(sale.items[0].total, 20)
  assert.ok(Math.abs(sale.items[0].unitPrice * sale.items[0].quantity - 20) < 0.001)

  const purchase = await localAtomicAction<any>(db, 'commit_purchase', {
    payload: {
      supplierId,
      items: [{ variantId: packVariant.id, quantity: 24, unitCost: 100 / 24, enteredQuantity: 1, unit: 'carton', unitFactor: 24 }],
      discount: 0,
      paid: 100,
      paymentMethod: 'cash',
      status: 'completed',
      idempotencyKey: 'ci-carton-purchase-total',
    },
  })
  assert.equal(purchase.subtotal, 100)
  assert.equal(purchase.total, 100)
  assert.equal(purchase.items[0].total, 100)
  assert.ok(Math.abs(purchase.items[0].unitCost * purchase.items[0].quantity - 100) < 0.001)
})

test('credit invoices reject nonzero paid amounts to protect the cash drawer ledger', async () => {
  const salesBefore = await db.sale.count()
  const purchasesBefore = await db.purchase.count()
  const quantityBefore = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity

  await assert.rejects(
    localAtomicAction(db, 'commit_sale', {
      payload: {
        customerId,
        items: [{ variantId, quantity: 1, unitPrice: 10 }],
        discount: 0,
        paid: 1,
        paymentMethod: 'credit',
        status: 'completed',
      },
    }),
    /الفاتورة الآجلة لا يجوز/,
  )
  await assert.rejects(
    localAtomicAction(db, 'commit_purchase', {
      payload: {
        supplierId,
        items: [{ variantId, quantity: 1, unitCost: 5 }],
        discount: 0,
        paid: 1,
        paymentMethod: 'credit',
        status: 'completed',
      },
    }),
    /فاتورة الشراء الآجلة لا يجوز/,
  )

  assert.equal(await db.sale.count(), salesBefore)
  assert.equal(await db.purchase.count(), purchasesBefore)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, quantityBefore)
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

test('non-cash overpayment is rejected without writing an invoice or changing stock', async () => {
  const beforeCount = await db.sale.count()
  const beforeQuantity = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'commit_sale', {
      payload: {
        items: [{ variantId, quantity: 1, unitPrice: 10 }],
        discount: 0,
        paid: 11,
        paymentMethod: 'card',
        status: 'completed',
      },
    }),
    /لا يمكن تسجيل زيادة مدفوعة/,
  )
  assert.equal(await db.sale.count(), beforeCount)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, beforeQuantity)
})

test('sale returns use source invoice prices, reject duplicate-line overreturns, and are idempotent', async () => {
  const quantityBeforeReturns = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
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
  const returnCountBefore = await db.saleReturn.count()
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
  assert.equal(await db.saleReturn.count(), returnCountBefore + 1)
  const quantityAfterFirstReturn = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  assert.equal(quantityAfterFirstReturn, quantityBeforeReturns + 1)

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
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, quantityBeforeReturns + 2)
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

test('draft sale with unpaid balance cannot resume without a customer', async () => {
  const beforeQuantity = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  const draft = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      items: [{ variantId, quantity: 1, unitPrice: 10 }],
      discount: 0,
      paid: 3,
      paymentMethod: 'cash',
      status: 'draft',
      idempotencyKey: 'ci-unassigned-unpaid-draft',
    },
  })
  await assert.rejects(
    localAtomicAction(db, 'resume_sale', { payload: { saleId: draft.id } }),
    /من دون ربطها بعميل/,
  )
  assert.equal((await db.sale.findUniqueOrThrow({ where: { id: draft.id } })).status, 'draft')
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, beforeQuantity)
})

test('purchase aggregates repeated variant lines and deduplicates repeated submissions', async () => {
  const purchaseCountBefore = await db.purchase.count()
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
  assert.equal(await db.purchase.count(), purchaseCountBefore + 1)
  purchaseId = purchase.id
  purchaseItemId = purchase.items[0].id
  assert.equal(purchase.items.length, 2)
  const afterPurchaseVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })
  assert.equal(afterPurchaseVariant.quantity, beforePurchaseVariant.quantity + 5)
  const expectedWeightedCost = (beforePurchaseVariant.quantity * beforePurchaseVariant.costPrice + 2 * 7 + 3 * 9) / (beforePurchaseVariant.quantity + 5)
  assert.ok(Math.abs(afterPurchaseVariant.costPrice - expectedWeightedCost) < 0.0001)
})

test('purchase returns are linked to source lines and cannot exceed purchased quantity', async () => {
  await assert.rejects(
    localAtomicAction(db, 'commit_purchase_return', {
      payload: {
        purchaseId,
        supplierId,
        refundMethod: 'cash',
        refundAmount: 7,
        items: [{ purchaseItemId, quantity: 1 }],
      },
    }),
    /تجاوز المبلغ المدفوع للمورد/,
  )
  const first = await localAtomicAction<any>(db, 'commit_purchase_return', {
    payload: {
      purchaseId,
      supplierId,
      refundMethod: 'cash',
      items: [{ purchaseItemId, quantity: 1 }],
    },
  })
  assert.equal(first.items[0].purchaseItemId, purchaseItemId)
  assert.equal(first.total, 7)
  assert.equal(first.refundAmount, 0)
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

test('cash purchase return refunds paid goods when supplier account has no outstanding debt', async () => {
  const cleanSupplier = await db.supplier.create({ data: { name: 'CI supplier with no account debt' } })
  const beforeBalance = cleanSupplier.balance
  const purchase = await localAtomicAction<any>(db, 'commit_purchase', {
    payload: {
      idempotencyKey: 'ci-fully-paid-purchase-return',
      supplierId: cleanSupplier.id,
      items: [{ variantId, quantity: 2, unitCost: 10, enteredQuantity: 2, unit: 'piece', unitFactor: 1 }],
      discount: 0,
      paid: 20,
      paymentMethod: 'cash',
      status: 'completed',
    },
  })
  const returned = await localAtomicAction<any>(db, 'commit_purchase_return', {
    payload: {
      purchaseId: purchase.id,
      supplierId: cleanSupplier.id,
      refundMethod: 'cash',
      items: [{ purchaseItemId: purchase.items[0].id, quantity: 1 }],
    },
  })
  assert.equal(returned.total, 10)
  assert.equal(returned.refundAmount, 10)
  assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: cleanSupplier.id } })).balance, beforeBalance)
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
  assert.equal(sale.taxAmount, 12.28)
})

test('VAT-inclusive purchase invoices keep the entered total inclusive of VAT', async () => {
  await db.setting.upsert({ where: { key: 'vatEnabled' }, update: { value: 'true' }, create: { key: 'vatEnabled', value: 'true' } })
  await db.setting.upsert({ where: { key: 'vatRate' }, update: { value: '14' }, create: { key: 'vatRate', value: '14' } })
  await db.setting.upsert({ where: { key: 'vatInclusive' }, update: { value: 'true' }, create: { key: 'vatInclusive', value: 'true' } })

  const purchase = await localAtomicAction<any>(db, 'commit_purchase', {
    payload: {
      idempotencyKey: 'ci-vat-inclusive-purchase',
      supplierId,
      items: [{ variantId, quantity: 1, unitCost: 100, enteredQuantity: 1, unit: 'piece', unitFactor: 1 }],
      discount: 0,
      paid: 100,
      paymentMethod: 'cash',
      status: 'completed',
    },
  })
  assert.equal(purchase.total, 100)
  assert.equal(purchase.taxAmount, 12.28)
  assert.equal(purchase.initialPaid, 100)
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

test('cashier sale transaction refuses to write after its register shift has closed', async () => {
  const cashier = await db.user.create({
    data: {
      username: 'ci-shift-cashier',
      passwordHash: 'test-only-hash',
      name: 'CI Shift Cashier',
      role: 'cashier',
    },
  })
  const session = await db.registerSession.create({
    data: { userId: cashier.id, openingFloat: 0, status: 'open' },
  })
  const firstSale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      userId: cashier.id,
      requiresOpenShift: true,
      idempotencyKey: 'ci-open-shift-sale',
      items: [{ variantId, quantity: 1, unitPrice: 10 }],
      discount: 0,
      paid: 10,
      paymentMethod: 'cash',
      status: 'completed',
    },
  })
  assert.ok(firstSale.id)
  await db.registerSession.update({
    where: { id: session.id },
    data: { status: 'closed', closedAt: new Date(), closingFloat: 10, expectedCash: 10, difference: 0 },
  })
  const salesCountBeforeRetry = await db.sale.count()
  const stockBeforeRetry = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'commit_sale', {
      payload: {
        userId: cashier.id,
        requiresOpenShift: true,
        idempotencyKey: 'ci-closed-shift-sale',
        items: [{ variantId, quantity: 1, unitPrice: 10 }],
        discount: 0,
        paid: 10,
        paymentMethod: 'cash',
        status: 'completed',
      },
    }),
    /الوردية اتقفلت قبل تسجيل الفاتورة/,
  )
  assert.equal(await db.sale.count(), salesCountBeforeRetry)
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, stockBeforeRetry)
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
test('sale cash refund uses current account balance after an unallocated customer payment', async () => {
  const returnCustomer = await db.customer.create({ data: { name: 'CI isolated return customer' } })
  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      customerId: returnCustomer.id,
      items: [{ variantId, quantity: 1, unitPrice: 10 }],
      discount: 0,
      paid: 0,
      paymentMethod: 'credit',
      status: 'completed',
      idempotencyKey: 'ci-return-after-unallocated-customer-payment',
    },
  })
  await db.customer.update({ where: { id: customerId }, data: { balance: { decrement: 10 } } })
  await db.customerPayment.create({
    data: {
      customerId: returnCustomer.id,
      saleId: null,
      amount: 10,
      method: 'cash',
      notes: 'unallocated account collection before return',
    },
  })
  const returned = await localAtomicAction<any>(db, 'commit_sale_return', {
    payload: {
      saleId: sale.id,
      idempotencyKey: 'ci-return-after-account-payment',
      refundMethod: 'cash',
      items: [{ saleItemId: sale.items[0].id, quantity: 1 }],
    },
  })
  assert.equal(returned.refundAmount, 10)
  assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).balance, 0)
})

test('voiding a sale is blocked when customer collections are not allocated to invoices', async () => {
  const sale = await localAtomicAction<any>(db, 'commit_sale', {
    payload: {
      customerId,
      items: [{ variantId, quantity: 1, unitPrice: 10 }],
      discount: 0,
      paid: 0,
      paymentMethod: 'credit',
      status: 'completed',
      idempotencyKey: 'ci-void-sale-unallocated-payment',
    },
  })
  await db.customer.update({ where: { id: customerId }, data: { balance: { decrement: 5 } } })
  await db.customerPayment.create({
    data: {
      customerId,
      saleId: null,
      amount: 5,
      method: 'cash',
      notes: 'unallocated payment for CI test',
    },
  })
  const stockBefore = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'void_sale', { payload: { saleId: sale.id, voidReason: 'CI unallocated collection' } }),
    /تحصيلات للعميل غير موزعة على فواتير/,
  )
  assert.equal((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).status, 'completed')
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, stockBefore)
})

test('voiding a purchase is blocked when supplier payments are not allocated to invoices', async () => {
  const balanceBefore = (await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).balance
  const purchase = await localAtomicAction<any>(db, 'commit_purchase', {
    payload: {
      idempotencyKey: 'ci-void-purchase-unallocated-payment',
      supplierId,
      items: [{ variantId, quantity: 1, unitCost: 10, enteredQuantity: 1, unit: 'piece', unitFactor: 1 }],
      discount: 0,
      paid: 0,
      paymentMethod: 'cash',
      status: 'completed',
    },
  })
  await db.supplier.update({ where: { id: supplierId }, data: { balance: { decrement: 5 } } })
  await db.supplierPayment.create({
    data: {
      supplierId,
      purchaseId: null,
      amount: 5,
      method: 'cash',
      notes: 'unallocated payment for CI test',
    },
  })
  const stockBefore = (await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity
  await assert.rejects(
    localAtomicAction(db, 'void_purchase', { payload: { purchaseId: purchase.id, voidReason: 'CI unallocated payment' } }),
    /دفعات للمورد غير موزعة على فواتير/,
  )
  assert.equal((await db.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).status, 'completed')
  assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).quantity, stockBefore)
  assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).balance, balanceBefore + 5)
})

