/**
 * Comprehensive seed script — Phase 2 schema
 * Creates realistic clothing-store data with variants.
 *
 * DEV-ONLY. Never run this against the production database — it creates
 * accounts with passwords you must supply yourself (see below); it refuses
 * to run at all if you don't supply them, specifically so nobody can seed a
 * real deployment with guessable/known credentials by accident.
 *
 * Run: bun run scripts/seed.ts
 */
import { PrismaClient } from '@prisma/client'
import * as crypto from 'crypto'

const db = new PrismaClient()

// Simple password hashing (uses Node built-in; same as lib/auth.ts)
function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(pw, salt, 1000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim().length < 6) {
    console.error('')
    console.error(`✗ Refusing to seed: ${name} is not set (or is too short).`)
    console.error('  This script no longer ships with default/known passwords —')
    console.error('  set your own before running it, e.g.:')
    console.error('')
    console.error('  SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=... \\')
    console.error('  SEED_MANAGER_PASSWORD=... SEED_CASHIER_PASSWORD=... \\')
    console.error('  bun run scripts/seed.ts')
    console.error('')
    process.exit(1)
  }
  return value
}

async function main() {
  console.log('🌱 Seeding comprehensive store data...')
  console.log('⚠️  This is a DEV seed. For production, use the setup wizard on first launch.')
  console.log('')

  // ---- Bootstrap admin via setup endpoint (so password policy is enforced) ----
  // No default credentials on purpose — every password below must be supplied
  // via environment variables, or the script refuses to run.
  const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME || 'admin'
  const ADMIN_PASSWORD = requireEnv('SEED_ADMIN_PASSWORD')

  await db.user.create({
    data: {
      username: ADMIN_USERNAME,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      name: 'المدير العام',
      role: 'admin',
    },
  })
  console.log(`✓ Created admin: ${ADMIN_USERNAME}`)
  console.log('✓ Brand: طيبة')

  // ---- Additional staff users (passwords must come from the environment) ----
  const MANAGER_PASSWORD = requireEnv('SEED_MANAGER_PASSWORD')
  const CASHIER_PASSWORD = requireEnv('SEED_CASHIER_PASSWORD')

  await db.user.createMany({
    data: [
      {
        username: 'manager',
        passwordHash: hashPassword(MANAGER_PASSWORD),
        name: 'محمد المحاسب',
        role: 'manager',
      },
      {
        username: 'cashier',
        passwordHash: hashPassword(CASHIER_PASSWORD),
        name: 'أحمد الكاشير',
        role: 'cashier',
      },
    ],
  })
  console.log('✓ Created manager: manager')
  console.log('✓ Created cashier: cashier')

  // ---- Categories ----
  const [tshirts, pants, jackets, shoes, accessories] = await Promise.all([
    db.category.create({ data: { name: 'تيشيرتات' } }),
    db.category.create({ data: { name: 'بناطيل' } }),
    db.category.create({ data: { name: 'جواكت' } }),
    db.category.create({ data: { name: 'أحذية' } }),
    db.category.create({ data: { name: 'إكسسوارات' } }),
  ])
  console.log('✓ 5 categories')

  // ---- Brands ----
  const [zara, hm, local] = await Promise.all([
    db.brand.create({ data: { name: 'Zara' } }),
    db.brand.create({ data: { name: 'H&M' } }),
    db.brand.create({ data: { name: 'محلي' } }),
  ])
  console.log('✓ 3 brands')

  // ---- Suppliers ----
  const [s1, s2, s3] = await Promise.all([
    db.supplier.create({ data: { name: 'شركة الأناقة للملابس', phone: '01001234567', address: 'القاهرة - وسط البل', balance: 0 } }),
    db.supplier.create({ data: { name: 'مؤسسة النيل للأزياء', phone: '01112345678', address: 'الإسكندرية - المنشية', balance: 2500 } }),
    db.supplier.create({ data: { name: 'وكالة الموضة الحديثة', phone: '01223456789', address: 'الجيزة - فيصل', balance: 0 } }),
  ])
  console.log('✓ 3 suppliers (1 with balance)')

  // ---- Customers ----
  const [c1, c2, c3, c4, c5] = await Promise.all([
    db.customer.create({ data: { name: 'عميل نقدي', balance: 0, notes: 'العميل الافتراضي' } }),
    db.customer.create({ data: { name: 'محمود علي', phone: '01012345678', balance: 350, notes: 'عميل دائم' } }),
    db.customer.create({ data: { name: 'سارة أحمد', phone: '01112345679', balance: 0, loyaltyPoints: 50 } }),
    db.customer.create({ data: { name: 'خالد محمد', phone: '01223456780', balance: 1200, notes: 'آجل' } }),
    db.customer.create({ data: { name: 'فاطمة حسن', phone: '01512345681', balance: 0 } }),
  ])
  console.log('✓ 5 customers (2 with balances)')

  // ---- Products + Variants (parent + matrix) ----
  // T-Shirt with 4 variants (sizes × colors)
  const tshirt = await db.product.create({
    data: {
      name: 'تيشيرت قطن رجالي',
      description: 'تيشيرت قطن 100% بألوان عصرية',
      categoryId: tshirts.id,
      brandId: zara.id,
      gender: 'male',
      season: 'summer',
      material: 'قطن',
    },
  })
  const tshirtVariants = await db.$transaction([
    db.productVariant.create({ data: { productId: tshirt.id, sku: 'TS-RED-M', barcode: '6001234500011', size: 'M', color: 'أحمر', material: 'قطن', costPrice: 80, sellPrice: 150, quantity: 25, minQuantity: 5, reorderQty: 15 } }),
    db.productVariant.create({ data: { productId: tshirt.id, sku: 'TS-RED-L', barcode: '6001234500028', size: 'L', color: 'أحمر', material: 'قطن', costPrice: 80, sellPrice: 150, quantity: 20, minQuantity: 5, reorderQty: 15 } }),
    db.productVariant.create({ data: { productId: tshirt.id, sku: 'TS-BLU-M', barcode: '6001234500035', size: 'M', color: 'أزرق', material: 'قطن', costPrice: 80, sellPrice: 150, quantity: 4, minQuantity: 5, reorderQty: 15 } }),
    db.productVariant.create({ data: { productId: tshirt.id, sku: 'TS-BLU-L', barcode: '6001234500042', size: 'L', color: 'أزرق', material: 'قطن', costPrice: 80, sellPrice: 150, quantity: 18, minQuantity: 5, reorderQty: 15 } }),
  ])

  // Jeans — 3 variants
  const jeans = await db.product.create({
    data: {
      name: 'جينز سليم فيت',
      description: 'جينز سليم باللون الكحلي',
      categoryId: pants.id,
      brandId: hm.id,
      gender: 'male',
      season: 'all',
      material: 'دينيم',
    },
  })
  const jeansVariants = await db.$transaction([
    db.productVariant.create({ data: { productId: jeans.id, sku: 'JN-32-NV', barcode: '6001234500059', size: '32', color: 'كحلي', material: 'دينيم', costPrice: 200, sellPrice: 380, quantity: 15, minQuantity: 5, reorderQty: 10 } }),
    db.productVariant.create({ data: { productId: jeans.id, sku: 'JN-34-NV', barcode: '6001234500066', size: '34', color: 'كحلي', material: 'دينيم', costPrice: 200, sellPrice: 380, quantity: 12, minQuantity: 5, reorderQty: 10 } }),
    db.productVariant.create({ data: { productId: jeans.id, sku: 'JN-36-NV', barcode: '6001234500073', size: '36', color: 'كحلي', material: 'دينيم', costPrice: 200, sellPrice: 380, quantity: 3, minQuantity: 5, reorderQty: 10 } }),
  ])

  // Jacket — 2 variants
  const jacket = await db.product.create({
    data: {
      name: 'جاكيت شتوي رجالي',
      description: 'جاكيت دافئ للشتاء ببطانة داخلية',
      categoryId: jackets.id,
      brandId: zara.id,
      gender: 'male',
      season: 'winter',
      material: 'بوليستر',
    },
  })
  const jacketVariants = await db.$transaction([
    db.productVariant.create({ data: { productId: jacket.id, sku: 'JK-BLK-M', barcode: '6001234500080', size: 'M', color: 'أسود', material: 'بوليستر', costPrice: 350, sellPrice: 650, quantity: 10, minQuantity: 3, reorderQty: 8 } }),
    db.productVariant.create({ data: { productId: jacket.id, sku: 'JK-BLK-L', barcode: '6001234500097', size: 'L', color: 'أسود', material: 'بوليستر', costPrice: 350, sellPrice: 650, quantity: 8, minQuantity: 3, reorderQty: 8 } }),
  ])

  // Shoes — 3 variants
  const shoesP = await db.product.create({
    data: {
      name: 'حذاء رياضي',
      description: 'حذاء رياضي مريح للاستخدام اليومي',
      categoryId: shoes.id,
      brandId: local.id,
      gender: 'unisex',
      season: 'all',
      material: 'جلد صناعي',
    },
  })
  const shoesVariants = await db.$transaction([
    db.productVariant.create({ data: { productId: shoesP.id, sku: 'SH-42-WHT', barcode: '6001234500103', size: '42', color: 'أبيض', material: 'جلد صناعي', costPrice: 250, sellPrice: 480, quantity: 14, minQuantity: 4, reorderQty: 8 } }),
    db.productVariant.create({ data: { productId: shoesP.id, sku: 'SH-43-WHT', barcode: '6001234500110', size: '43', color: 'أبيض', material: 'جلد صناعي', costPrice: 250, sellPrice: 480, quantity: 9, minQuantity: 4, reorderQty: 8 } }),
    db.productVariant.create({ data: { productId: shoesP.id, sku: 'SH-44-WHT', barcode: '6001234500127', size: '44', color: 'أبيض', material: 'جلد صناعي', costPrice: 250, sellPrice: 480, quantity: 2, minQuantity: 4, reorderQty: 8 } }),
  ])

  // Accessories — cap
  const cap = await db.product.create({
    data: {
      name: 'كاب رياضي',
      description: 'كاب قطن بألوان متعددة',
      categoryId: accessories.id,
      brandId: local.id,
      gender: 'unisex',
      season: 'summer',
      material: 'قطن',
    },
  })
  const capVariants = await db.$transaction([
    db.productVariant.create({ data: { productId: cap.id, sku: 'CAP-BLK', barcode: '6001234500134', size: 'Free', color: 'أسود', material: 'قطن', costPrice: 40, sellPrice: 95, quantity: 30, minQuantity: 5, reorderQty: 10 } }),
    db.productVariant.create({ data: { productId: cap.id, sku: 'CAP-WHT', barcode: '6001234500141', size: 'Free', color: 'أبيض', material: 'قطن', costPrice: 40, sellPrice: 95, quantity: 28, minQuantity: 5, reorderQty: 10 } }),
  ])
  console.log('✓ 5 products with 14 variants total (4 low-stock)')

  // ---- Settings (store info + defaults) ----
  await db.setting.createMany({
    data: [
      { key: 'storeName', value: 'طيبة' },
      { key: 'storeAddress', value: 'القاهرة - شارع التحرير' },
      { key: 'storePhone', value: '0223456789' },
      { key: 'storeTaxNumber', value: '123-456-789' },
      { key: 'storeLogo', value: '' },
      { key: 'vatEnabled', value: 'false' },
      { key: 'vatRate', value: '14' },
      { key: 'vatInclusive', value: 'false' },
      { key: 'receiptFooter', value: 'شكراً لزيارتكم — نرجو لكم دوماً التميز' },
      { key: 'saleInvoicePrefix', value: 'INV' },
      { key: 'purchaseInvoicePrefix', value: 'PUR' },
      { key: 'returnPrefix', value: 'RET' },
      { key: 'saleCounter', value: '0' },
      { key: 'purchaseCounter', value: '0' },
      { key: 'returnCounter', value: '0' },
      { key: 'currency', value: 'EGP' },
      { key: 'loyaltyEnabled', value: 'true' },
      { key: 'loyaltyRate', value: '0.01' }, // 1 point per 100 EGP
      { key: 'googleClientEmail', value: '' },
      { key: 'googlePrivateKey', value: '' },
      { key: 'googleSpreadsheetId', value: '' },
      { key: 'googleLiveCsvUrl', value: '' },
    ],
  })
  console.log('✓ 22 settings (store info + counters)')

  // ---- Purchase 1 (today, paid in full) ----
  const today = new Date()
  const purchase1 = await db.purchase.create({
    data: {
      invoiceNo: 'PUR-000001',
      supplierId: s1.id,
      date: today,
      subtotal: 5000,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      total: 5000,
      paid: 5000,
      status: 'completed',
      notes: 'توريد تيشيرتات',
      items: {
        create: [
          { variantId: tshirtVariants[0].id, quantity: 25, unitCost: 80, total: 2000 },
          { variantId: tshirtVariants[1].id, quantity: 20, unitCost: 80, total: 1600 },
          { variantId: tshirtVariants[2].id, quantity: 4, unitCost: 80, total: 320 },
          { variantId: tshirtVariants[3].id, quantity: 18, unitCost: 80, total: 1080 },
        ],
      },
    },
  })
  console.log('✓ 1 purchase (5000 EGP, paid)')

  // ---- Purchase 2 (today, partial payment, supplier balance increased) ----
  const purchase2 = await db.purchase.create({
    data: {
      invoiceNo: 'PUR-000002',
      supplierId: s2.id,
      date: today,
      subtotal: 3000,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      total: 3000,
      paid: 500,
      status: 'completed',
      notes: 'توريد جينز — دفعة أولى',
      items: {
        create: [
          { variantId: jeansVariants[0].id, quantity: 15, unitCost: 200, total: 3000 },
        ],
      },
    },
  })
  // increase supplier balance by remaining
  await db.supplier.update({ where: { id: s2.id }, data: { balance: { increment: 2500 } } })
  await db.supplierPayment.create({
    data: { supplierId: s2.id, purchaseId: purchase2.id, amount: 500, method: 'cash' },
  })
  console.log('✓ 1 purchase (3000 EGP, 500 paid, 2500 outstanding)')

  // ---- Sales (5 — 3 today, 2 yesterday) ----
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const twoDaysAgo = new Date(today); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

  async function createSale(opts: {
    invoiceNo: string
    customerId?: string
    date: Date
    items: { variantId: string; quantity: number; unitPrice: number; unitCost: number }[]
    discount?: number
    paid?: number
    paymentMethod?: string
    customerIdBalance?: { customerId: string; amount: number }
  }) {
    const subtotal = opts.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
    const discount = opts.discount || 0
    const total = subtotal - discount
    const paid = opts.paid ?? total
    return db.sale.create({
      data: {
        invoiceNo: opts.invoiceNo,
        customerId: opts.customerId || null,
        date: opts.date,
        subtotal,
        discount,
        taxRate: 0,
        taxAmount: 0,
        total,
        paid,
        change: Math.max(0, paid - total),
        paymentMethod: opts.paymentMethod || 'cash',
        status: 'completed',
        items: {
          create: opts.items.map((i) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            unitCost: i.unitCost, // SNAPSHOT for accurate profit
            total: i.unitPrice * i.quantity,
          })),
        },
      },
    })
  }

  // Sale 1 — today, cash, customer c2
  await createSale({
    invoiceNo: 'INV-000001',
    customerId: c2.id,
    date: today,
    items: [
      { variantId: tshirtVariants[0].id, quantity: 2, unitPrice: 150, unitCost: 80 },
      { variantId: capVariants[0].id, quantity: 1, unitPrice: 95, unitCost: 40 },
    ],
    paymentMethod: 'cash',
  })
  // decrement variant quantities
  await db.productVariant.update({ where: { id: tshirtVariants[0].id }, data: { quantity: { decrement: 2 } } })
  await db.productVariant.update({ where: { id: capVariants[0].id }, data: { quantity: { decrement: 1 } } })

  // Sale 2 — today, card, customer c3
  await createSale({
    invoiceNo: 'INV-000002',
    customerId: c3.id,
    date: today,
    items: [
      { variantId: jeansVariants[0].id, quantity: 1, unitPrice: 380, unitCost: 200 },
    ],
    paymentMethod: 'card',
  })
  await db.productVariant.update({ where: { id: jeansVariants[0].id }, data: { quantity: { decrement: 1 } } })

  // Sale 3 — today, cash, walk-in
  await createSale({
    invoiceNo: 'INV-000003',
    customerId: c1.id,
    date: today,
    items: [
      { variantId: shoesVariants[0].id, quantity: 1, unitPrice: 480, unitCost: 250 },
      { variantId: tshirtVariants[1].id, quantity: 1, unitPrice: 150, unitCost: 80 },
    ],
    paymentMethod: 'cash',
    paid: 700,
  })
  await db.productVariant.update({ where: { id: shoesVariants[0].id }, data: { quantity: { decrement: 1 } } })
  await db.productVariant.update({ where: { id: tshirtVariants[1].id }, data: { quantity: { decrement: 1 } } })

  // Sale 4 — yesterday, cash, customer c4 (with outstanding balance)
  await createSale({
    invoiceNo: 'INV-000004',
    customerId: c4.id,
    date: yesterday,
    items: [
      { variantId: jacketVariants[0].id, quantity: 1, unitPrice: 650, unitCost: 350 },
    ],
    discount: 50,
    paid: 0,
    paymentMethod: 'transfer',
  })
  await db.productVariant.update({ where: { id: jacketVariants[0].id }, data: { quantity: { decrement: 1 } } })
  // increase customer balance by remaining (1200 = 650 - 50)
  await db.customer.update({ where: { id: c4.id }, data: { balance: { increment: 1200 } } })

  // Sale 5 — 2 days ago, cash
  await createSale({
    invoiceNo: 'INV-000005',
    customerId: c1.id,
    date: twoDaysAgo,
    items: [
      { variantId: capVariants[1].id, quantity: 2, unitPrice: 95, unitCost: 40 },
    ],
    paymentMethod: 'cash',
  })
  await db.productVariant.update({ where: { id: capVariants[1].id }, data: { quantity: { decrement: 2 } } })
  console.log('✓ 5 sales (3 today, 2 historical) with snapshot costs')

  // ---- Stock adjustment sample (damage) ----
  await db.stockAdjustment.create({
    data: {
      variantId: shoesVariants[2].id,
      type: 'damage',
      quantityChange: -1,
      reason: 'علبة مكسورة',
      notes: 'تم استلام الحذاء تالف',
    },
  })
  await db.productVariant.update({ where: { id: shoesVariants[2].id }, data: { quantity: { decrement: 1 } } })
  console.log('✓ 1 stock adjustment (damage)')

  // Update counters
  await db.setting.update({ where: { key: 'saleCounter' }, data: { value: '5' } })
  await db.setting.update({ where: { key: 'purchaseCounter' }, data: { value: '2' } })

  console.log('\n🎉 Seeding complete!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Dev logins (passwords are whatever you passed via env vars):')
  console.log(`  ${ADMIN_USERNAME} (admin)`)
  console.log(`  manager (manager)`)
  console.log(`  cashier (cashier)`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
