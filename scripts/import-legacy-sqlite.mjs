#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, basename, relative, resolve, sep, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED_TABLES = [
  'users', 'categories', 'brands', 'products', 'product_variants', 'suppliers', 'customers',
  'sales', 'sale_items', 'sale_returns', 'sale_return_items', 'purchases', 'purchase_items',
  'purchase_returns', 'purchase_return_items', 'register_sessions', 'customer_payments',
  'supplier_payments', 'settings', 'stock_movements', 'audit_logs',
]
const RETIRED_SETTING = /^(google|appsScript|autoSyncEnabled|lastGoogle|lastArchive|lastRestore|sync)/i
const quote = (value) => '"' + String(value).replaceAll('"', '""') + "'"
const qid = (value) => '"' + String(value).replaceAll('"', '""') + '"'
const number = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const moneyCents = (value) => Math.round((number(value) + Number.EPSILON) * 100)

function dateValue(value, fallback = null) {
  if (value == null || value === '') return fallback
  let input = String(value).trim()
  if (!input.includes('T')) input = input.replace(' ', 'T')
  if (!/(Z|[+-]\\d{2}:\\d{2})$/i.test(input)) input += 'Z'
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) throw new Error(`تاريخ قديم غير قابل للقراءة: ${String(value)}`)
  return parsed.toISOString().replace('T', ' ').replace('Z', '')
}

/**
 * Reconnect missing legacy SaleItem foreign keys only when the invoice,
 * variant, price and remaining sold quantity identify a single safe match.
 * The original rows are also retained byte-for-byte in legacy archive tables.
 */
export function resolveReturnItemLinks(sales, saleItems, saleReturns, returnItems) {
  const salesById = new Map(sales.map((row) => [row.id, row]))
  const returnHeaders = new Map(saleReturns.map((row) => [row.id, row]))
  const itemsById = new Map(saleItems.map((row) => [row.id, row]))
  const returnedByItem = new Map()
  const unresolved = []
  const repairs = []
  const mapped = []
  const ordered = [...returnItems].sort((a, b) => {
    const da = String(returnHeaders.get(a.sale_return_id)?.date || '')
    const db = String(returnHeaders.get(b.sale_return_id)?.date || '')
    return da.localeCompare(db) || String(a.id).localeCompare(String(b.id))
  })

  for (const row of ordered) {
    const header = returnHeaders.get(row.sale_return_id)
    const sale = header ? salesById.get(header.sale_id) : null
    const quantity = number(row.quantity, NaN)
    if (!header || !sale || !Number.isSafeInteger(quantity) || quantity <= 0) {
      unresolved.push({ id: row.id, reason: 'المرتجع أو الفاتورة الأصلية أو الكمية غير صالحة' })
      continue
    }

    let matched = itemsById.get(row.sale_item_id)
    if (matched) {
      if (matched.sale_id !== sale.id || matched.variant_id !== row.variant_id || moneyCents(matched.unit_price) !== moneyCents(row.unit_price)) {
        unresolved.push({ id: row.id, reason: 'رابط بند البيع موجود لكنه لا يطابق الفاتورة أو الصنف أو السعر' })
        continue
      }
      const used = returnedByItem.get(matched.id) || 0
      if (used + quantity > number(matched.quantity)) {
        unresolved.push({ id: row.id, reason: 'إجمالي المرتجع يتجاوز الكمية المباعة في البند الأصلي' })
        continue
      }
    } else {
      const options = saleItems.filter((candidate) =>
        candidate.sale_id === sale.id &&
        candidate.variant_id === row.variant_id &&
        moneyCents(candidate.unit_price) === moneyCents(row.unit_price) &&
        (returnedByItem.get(candidate.id) || 0) + quantity <= number(candidate.quantity)
      )
      const exact = options.filter((candidate) => number(candidate.quantity) === quantity)
      const matches = exact.length === 1 ? exact : exact.length === 0 && options.length === 1 ? options : []
      if (matches.length !== 1) {
        unresolved.push({ id: row.id, reason: matches.length ? 'يوجد أكثر من تطابق محتمل' : 'تعذر ربط بند المرتجع ببند بيع واحد دون تخمين' })
        continue
      }
      matched = matches[0]
      repairs.push({
        returnItemId: row.id,
        originalSaleItemId: row.sale_item_id,
        repairedSaleItemId: matched.id,
        saleInvoiceNo: sale.invoice_no,
        returnNo: header.return_no,
      })
    }

    returnedByItem.set(matched.id, (returnedByItem.get(matched.id) || 0) + quantity)
    mapped.push({ ...row, sale_item_id: matched.id, _legacy_sale_item_id: row.sale_item_id })
  }

  return { mapped, repairs, unresolved }
}

function rowsFor(db, table) {
  return db.prepare(`SELECT * FROM ${qid(table)}`).all()
}

function countTables(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
  return Object.fromEntries(names.map((name) => [name, rowsFor(db, name).length]))
}

function inspectSource(sourceDb) {
  const tables = new Set(dbTableNames(sourceDb))
  const missing = REQUIRED_TABLES.filter((name) => !tables.has(name))
  if (missing.length) throw new Error(`النسخة لا تحتوي الجداول المطلوبة: ${missing.join(', ')}`)
  const integrity = sourceDb.prepare('PRAGMA integrity_check').all().map((row) => Object.values(row)[0])
  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    throw new Error(`فحص سلامة نسخة المصدر فشل: ${integrity.join('; ')}`)
  }
  const tablesCounts = countTables(sourceDb)
  const data = Object.fromEntries(Object.keys(tablesCounts).map((name) => [name, rowsFor(sourceDb, name)]))
  const linkPlan = resolveReturnItemLinks(data.sales, data.sale_items, data.sale_returns, data.sale_return_items)
  const foreignKeyIssues = sourceDb.prepare('PRAGMA foreign_key_check').all()
  const otherForeignKeyIssues = foreignKeyIssues.filter((issue) => issue.table !== 'sale_return_items')
  const saleReturnsById = new Map(data.sale_returns.map((row) => [row.id, row]))
  const lineSums = new Map()
  for (const item of linkPlan.mapped) lineSums.set(item.sale_return_id, (lineSums.get(item.sale_return_id) || 0) + number(item.total))
  const returnAmountIssues = data.sale_returns.filter((header) => {
    const count = data.sale_return_items.filter((line) => line.sale_return_id === header.id).length
    return count > 0 && Math.abs(moneyCents(lineSums.get(header.id) || 0) - moneyCents(header.total)) > 0
  }).map((header) => ({
    returnNo: header.return_no,
    headerTotal: number(header.total),
    lineTotal: number(lineSums.get(header.id) || 0),
  }))
  const duplicateIssues = []
  for (const [table, column] of [['users','username'],['product_variants','sku'],['product_variants','barcode'],['sales','invoice_no'],['purchases','invoice_no'],['sale_returns','return_no'],['purchase_returns','return_no']]) {
    const seen = new Set()
    for (const row of data[table]) {
      const value = row[column]
      if (value == null || value === '') continue
      if (seen.has(value)) duplicateIssues.push({ table, column, duplicate: String(value) })
      seen.add(value)
    }
  }
  const activeSettings = data.settings.filter((row) => !RETIRED_SETTING.test(row.key))
  const usersWithoutPassword = data.users.filter((user) => !user.password_hash && user.pin_hash).length
  const openSessions = data.register_sessions.filter((session) => session.status === 'open').length
  const blockers = [
    ...linkPlan.unresolved.map((issue) => ({ type: 'unresolved-sale-return-item', ...issue })),
    ...otherForeignKeyIssues.map((issue) => ({ type: 'legacy-foreign-key', table: issue.table, rowid: issue.rowid, parent: issue.parent })),
    ...returnAmountIssues.map((issue) => ({ type: 'return-total-mismatch', ...issue })),
    ...duplicateIssues.map((issue) => ({ type: 'duplicate-unique-value', ...issue })),
  ]
  return {
    data,
    report: {
      integrity: 'ok',
      tableCounts: tablesCounts,
      legacyForeignKeyIssues: foreignKeyIssues.length,
      repairedSaleReturnLinks: linkPlan.repairs,
      unresolvedSaleReturnLinks: linkPlan.unresolved,
      returnAmountIssues,
      duplicateIssues,
      usersWithoutPassword,
      usersWithLegacyPin: usersWithoutPassword,
      openRegisterSessions: openSessions,
      retiredSyncSettingsExcludedFromActiveSettings: data.settings.length - activeSettings.length,
      blockers,
      canImport: blockers.length === 0,
    },
    linkPlan,
  }
}

function dbTableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
}

function activeModelRows(data, linkPlan) {
  const sessionById = new Map(data.register_sessions.map((row) => [row.id, row]))
  const variantById = new Map(data.product_variants.map((row) => [row.id, row]))
  const saleById = new Map(data.sales.map((row) => [row.id, row]))
  const importedSettings = new Map(data.settings.filter((row) => !RETIRED_SETTING.test(row.key)).map((row) => [row.key, row.value]))
  const setDefault = (key, value) => { if (!importedSettings.has(key)) importedSettings.set(key, value) }
  setDefault('vatInclusive', 'false')
  setDefault('saleInvoicePrefix', 'INV')
  setDefault('purchaseInvoicePrefix', 'PUR')
  setDefault('returnPrefix', 'RET')
  setDefault('purchaseReturnPrefix', 'PRET')
  setDefault('saleCounter', String(Math.max(data.sales.length, ...data.sales.map((row) => {
    const match = /^INV-(\\d+)$/.exec(String(row.invoice_no || ''))
    return match ? Number(match[1]) : 0
  }))))
  setDefault('purchaseCounter', String(Math.max(data.purchases.length, ...data.purchases.map((row) => {
    const match = /^PUR-(\\d+)$/.exec(String(row.invoice_no || ''))
    return match ? Number(match[1]) : 0
  }))))
  setDefault('returnCounter', String(Math.max(data.sale_returns.length, ...data.sale_returns.map((row) => {
    const match = /^RET-(\\d+)$/.exec(String(row.return_no || ''))
    return match ? Number(match[1]) : 0
  }))))
  setDefault('purchaseReturnCounter', String(Math.max(data.purchase_returns.length, ...data.purchase_returns.map((row) => {
    const match = /^PRET-(\\d+)$/.exec(String(row.return_no || ''))
    return match ? Number(match[1]) : 0
  }))))

  return {
    User: data.users.map((r) => ({
      id:r.id, username:r.username, passwordHash:r.password_hash || null, pinHash:r.pin_hash || null,
      name:r.name, role:r.role, active:number(r.active) ? 1 : 0,
      createdAt:dateValue(r.created_at), updatedAt:dateValue(r.updated_at),
    })),
    Category: data.categories.map((r) => ({ id:r.id, name:r.name, createdAt:dateValue(r.created_at) })),
    Brand: data.brands.map((r) => ({ id:r.id, name:r.name })),
    Product: data.products.map((r) => ({
      id:r.id, name:r.name, description:r.description ?? null, categoryId:r.category_id, brandId:r.brand_id ?? null,
      gender:r.gender ?? null, season:r.season ?? null, material:r.material ?? null, image:r.image ?? null,
      createdAt:dateValue(r.created_at), updatedAt:dateValue(r.updated_at),
    })),
    ProductVariant: data.product_variants.map((r) => ({
      id:r.id, productId:r.product_id, sku:r.sku, barcode:r.barcode ?? null, size:r.size ?? null, color:r.color ?? null,
      material:r.material ?? null, costPrice:number(r.cost_price), sellPrice:number(r.sell_price), quantity:number(r.quantity),
      minQuantity:number(r.min_quantity,5), reorderQty:number(r.reorder_qty,10), baseUnit:r.base_unit || 'piece',
      purchaseUnit:r.purchase_unit || 'piece', purchaseUnitFactor:number(r.purchase_unit_factor,1),
      saleUnit:r.sale_unit || 'piece', saleUnitFactor:number(r.sale_unit_factor,1),
      quarterDozenPrice:r.quarter_dozen_price ?? null, halfDozenPrice:r.half_dozen_price ?? null, dozenPrice:r.dozen_price ?? null,
      createdAt:dateValue(r.created_at), updatedAt:dateValue(r.updated_at),
    })),
    Supplier: data.suppliers.map((r) => ({
      id:r.id, name:r.name, phone:r.phone ?? null, address:r.address ?? null, notes:r.notes ?? null,
      balance:number(r.balance), createdAt:dateValue(r.created_at), updatedAt:dateValue(r.updated_at),
    })),
    Customer: data.customers.map((r) => ({
      id:r.id, name:r.name, phone:r.phone ?? null, address:r.address ?? null, notes:r.notes ?? null,
      balance:number(r.balance), loyaltyPoints:number(r.loyalty_points), createdAt:dateValue(r.created_at), updatedAt:dateValue(r.updated_at),
    })),
    RegisterSession: data.register_sessions.map((r) => ({
      id:r.id, userId:r.user_id, openedAt:dateValue(r.opened_at), closedAt:dateValue(r.closed_at),
      openingFloat:number(r.opening_float), closingFloat:r.closing_float == null ? null : number(r.closing_float),
      expectedCash:r.expected_cash == null ? null : number(r.expected_cash), difference:r.difference == null ? null : number(r.difference),
      cashSales:number(r.cash_sales), cardSales:number(r.card_sales), transferSales:number(r.transfer_sales),
      notes:r.notes ?? null, status:r.status,
    })),
    Purchase: data.purchases.map((r) => ({
      id:r.id, invoiceNo:r.invoice_no, idempotencyKey:r.idempotency_key ?? null, supplierId:r.supplier_id,
      userId:sessionById.get(r.register_session_id)?.user_id ?? null,
      paymentMethod:number(r.paid) <= 0 ? 'credit' : 'legacy_unknown',
      initialPaid:number(r.paid), date:dateValue(r.date), subtotal:number(r.subtotal), discount:number(r.discount),
      taxRate:number(r.tax_rate), taxAmount:number(r.tax_amount), total:number(r.total), paid:number(r.paid),
      status:r.status, notes:r.notes ?? null, createdAt:dateValue(r.created_at),
    })),
    PurchaseItem: data.purchase_items.map((r) => ({
      id:r.id, purchaseId:r.purchase_id, variantId:r.variant_id, quantity:number(r.quantity),
      unitCost:number(r.unit_cost), total:number(r.total), enteredQuantity:r.entered_quantity == null ? null : number(r.entered_quantity),
      unit:r.unit ?? null, unitFactor:r.unit_factor == null ? null : number(r.unit_factor),
    })),
    PurchaseReturn: data.purchase_returns.map((r) => ({
      id:r.id, returnNo:r.return_no, purchaseId:r.purchase_id, supplierId:r.supplier_id, userId:null,
      date:dateValue(r.date), total:number(r.total), reason:r.reason ?? null, notes:r.notes ?? null,
      status:r.status, refundMethod:null, refundAmount:null, idempotencyKey:r.idempotency_key ?? null, createdAt:dateValue(r.created_at),
    })),
    PurchaseReturnItem: data.purchase_return_items.map((r) => ({
      id:r.id, purchaseReturnId:r.purchase_return_id, variantId:r.variant_id, quantity:number(r.quantity),
      unitCost:number(r.unit_cost), total:number(r.total), purchaseItemId:null,
    })),
    Sale: data.sales.map((r) => ({
      id:r.id, invoiceNo:r.invoice_no, customerId:r.customer_id ?? null, userId:r.user_id ?? null, date:dateValue(r.date),
      subtotal:number(r.subtotal), discount:number(r.discount), taxRate:number(r.tax_rate), taxAmount:number(r.tax_amount),
      total:number(r.total), paid:number(r.paid), initialPaid:number(r.paid), change:number(r.change),
      paymentMethod:r.payment_method || 'cash', idempotencyKey:r.idempotency_key ?? null, status:r.status,
      voidReason:r.void_reason ?? null, notes:r.notes ?? null, createdAt:dateValue(r.created_at),
    })),
    SaleItem: data.sale_items.map((r) => ({
      id:r.id, saleId:r.sale_id, variantId:r.variant_id, quantity:number(r.quantity), unitPrice:number(r.unit_price),
      unitCost:number(r.unit_cost), total:number(r.total),
    })),
    SaleReturn: data.sale_returns.map((r) => ({
      id:r.id, returnNo:r.return_no, saleId:r.sale_id, customerId:r.customer_id ?? null, userId:null,
      date:dateValue(r.date), subtotal:number(r.subtotal), total:number(r.total), reason:r.reason ?? null, notes:r.notes ?? null,
      status:r.status, refundMethod:r.refund_method ?? null,
      refundAmount:r.refund_method === 'cash' ? number(r.total) : null,
      idempotencyKey:r.idempotency_key ?? null, createdAt:dateValue(r.created_at),
    })),
    SaleReturnItem: linkPlan.mapped.map((r) => ({
      id:r.id, saleReturnId:r.sale_return_id, saleItemId:r.sale_item_id, variantId:r.variant_id,
      quantity:number(r.quantity), unitPrice:number(r.unit_price), total:number(r.total),
    })),
    CustomerPayment: data.customer_payments.map((r) => ({
      id:r.id, idempotencyKey:r.idempotency_key ?? null, userId:null, customerId:r.customer_id,
      saleId:r.sale_id ?? null, saleReturnId:r.sale_return_id ?? null, amount:number(r.amount),
      method:r.method || 'cash', date:dateValue(r.date), notes:r.notes ?? null, createdAt:dateValue(r.created_at),
    })),
    SupplierPayment: data.supplier_payments.map((r) => ({
      id:r.id, idempotencyKey:r.idempotency_key ?? null, userId:null, supplierId:r.supplier_id,
      purchaseId:r.purchase_id ?? null, purchaseReturnId:r.purchase_return_id ?? null, amount:number(r.amount),
      method:r.method || 'cash', date:dateValue(r.date), notes:r.notes ?? null, createdAt:dateValue(r.created_at),
    })),
    StockAdjustment: data.stock_movements.filter((r) => ['ADJUSTMENT','OPENING_STOCK'].includes(r.type)).map((r) => ({
      id:r.id, variantId:r.variant_id, productId:variantById.get(r.variant_id)?.product_id ?? null, userId:null,
      type:r.type === 'OPENING_STOCK' ? 'opening' : 'adjustment', quantityChange:number(r.quantity),
      reason:r.type === 'OPENING_STOCK' ? 'كمية مخزون افتتاحية مستوردة' : 'تسوية مخزون تاريخية مستوردة',
      notes:[r.reference_type,r.reference_id].filter(Boolean).join(': ') || null, createdAt:dateValue(r.created_at),
    })),
    AuditLog: data.audit_logs.map((r) => ({
      id:r.id, userId:r.user_id ?? null, action:r.action, entity:r.entity, entityId:r.entity_id ?? null,
      before:r.before_json ?? null, after:r.after_json ?? null, ip:null, createdAt:dateValue(r.created_at),
    })),
    Setting: [...importedSettings.entries()].map(([key,value]) => ({ id:randomUUID(), key, value:String(value) })),
  }
}

function archiveLegacyTables(sourceDb, targetDb, names) {
  const counts = {}
  for (const name of names) {
    const columns = sourceDb.prepare(`PRAGMA table_info(${qid(name)})`).all()
    const archiveName = `legacy_archive__${name}`
    targetDb.exec(`CREATE TABLE ${qid(archiveName)} (${columns.map((column) => `${qid(column.name)} ${column.type || 'BLOB'}`).join(', ')})`)
    const rows = rowsFor(sourceDb, name)
    if (rows.length) {
      const keys = columns.map((column) => column.name)
      const insert = targetDb.prepare(`INSERT INTO ${qid(archiveName)} (${keys.map(qid).join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      for (const row of rows) insert.run(...keys.map((key) => row[key] ?? null))
    }
    counts[name] = rows.length
  }
  return counts
}

function insertRows(targetDb, table, records) {
  if (!records.length) return
  const columns = Object.keys(records[0])
  const statement = targetDb.prepare(`INSERT INTO ${qid(table)} (${columns.map(qid).join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
  for (const row of records) statement.run(...columns.map((column) => row[column] ?? null))
}

function prismaFileUrl(targetPath) {
  const schemaDir = join(ROOT, 'prisma')
  const relativePath = relative(schemaDir, targetPath).split(sep).join('/')
  return `file:${relativePath.startsWith('.') ? relativePath : './' + relativePath}`
}

function initializeEmptyTarget(targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true })
  if (existsSync(targetPath) && statSync(targetPath).size > 0) {
    throw new Error('ملف الهدف موجود وغير فارغ؛ رفضنا الكتابة فوقه لحماية البيانات. اختر ملف اختبار جديدًا.')
  }
  if (!/(import-test|restore-test)/i.test(basename(targetPath))) {
    throw new Error('اسم ملف الهدف يجب أن يحتوي import-test أو restore-test. الاستيراد المباشر إلى قاعدة المحل ممنوع في هذه الأداة.')
  }
  if (existsSync(targetPath)) {
    throw new Error('ملف الهدف الفارغ موجود بالفعل؛ احذفه يدويًا بعد التأكد أنه ملف اختبار فقط ثم أعد المحاولة.')
  }
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const pushed = spawnSync(command, ['prisma', 'db', 'push', '--schema', join(ROOT, 'prisma', 'schema.prisma')], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: prismaFileUrl(targetPath) },
  })
  if (pushed.status !== 0) {
    throw new Error(`تعذر إعداد قاعدة الهدف الفارغة بواسطة Prisma db push دون قبول فقد البيانات.\n${pushed.stderr || pushed.stdout || pushed.error?.message || ''}`)
  }
}

export async function createImportPlan(sourcePath) {
  const realSource = resolve(sourcePath)
  const sourceDb = new DatabaseSync(realSource, { readOnly: true })
  sourceDb.exec('PRAGMA query_only = ON')
  try {
    const inspected = inspectSource(sourceDb)
    return { ...inspected.report, _data: inspected.data, _linkPlan: inspected.linkPlan, _sourcePath: realSource }
  } finally {
    sourceDb.close()
  }
}

export async function importLegacyDatabase({ sourcePath, targetPath }) {
  const resolvedSource = resolve(sourcePath)
  const resolvedTarget = resolve(targetPath)
  if (resolvedSource === resolvedTarget) throw new Error('المصدر والهدف لا يمكن أن يكونا نفس الملف')
  const plan = await createImportPlan(resolvedSource)
  if (!plan.canImport) throw new Error(`فحص ما قبل الاستيراد وجد مشكلات تمنع الاستيراد الآمن: ${JSON.stringify(plan.blockers)}`)
  const sourceSha256 = createHash('sha256').update(readFileSync(resolvedSource)).digest('hex')
  initializeEmptyTarget(resolvedTarget)

  const sourceDb = new DatabaseSync(resolvedSource, { readOnly: true })
  sourceDb.exec('PRAGMA query_only = ON')
  const targetDb = new DatabaseSync(resolvedTarget)
  try {
    const inspected = inspectSource(sourceDb)
    const names = dbTableNames(sourceDb)
    const models = activeModelRows(inspected.data, inspected.linkPlan)
    targetDb.exec('PRAGMA foreign_keys = ON')
    targetDb.exec('BEGIN IMMEDIATE')
    let archivedCounts = {}
    try {
      archivedCounts = archiveLegacyTables(sourceDb, targetDb, names)
      const order = ['User','Category','Brand','Product','ProductVariant','Supplier','Customer','RegisterSession','Purchase','PurchaseItem','PurchaseReturn','PurchaseReturnItem','Sale','SaleItem','SaleReturn','SaleReturnItem','CustomerPayment','SupplierPayment','StockAdjustment','AuditLog','Setting']
      for (const model of order) insertRows(targetDb, model, models[model] || [])
      const fkErrors = targetDb.prepare('PRAGMA foreign_key_check').all()
      if (fkErrors.length) throw new Error(`قاعدة الهدف تحتوي مخالفات علاقات بعد الاستيراد: ${JSON.stringify(fkErrors.slice(0,20))}`)
      const integrity = targetDb.prepare('PRAGMA integrity_check').all().map((row) => Object.values(row)[0])
      if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error(`فحص سلامة قاعدة الهدف فشل: ${integrity.join('; ')}`)
      const manifestReport = {
        sourceSha256,
        sourceTableCounts: inspected.report.tableCounts,
        archivedLegacyTableCounts: archivedCounts,
        importedModelCounts: Object.fromEntries(Object.entries(models).map(([model, rows]) => [model, rows.length])),
        repairedSaleReturnLinks: inspected.linkPlan.repairs,
        warnings: {
          userAccountsNeedingPasswordRotation: inspected.report.usersWithoutPassword,
          oldOpenRegisterSessionsToReview: inspected.report.openRegisterSessions,
          historicalPurchasePaymentMethodUnavailable: inspected.data.purchases.filter((row) => number(row.paid) > 0).length,
          sourceSyncTablesArchivedOnly: ['sync_queue','settings'].filter((table) => names.includes(table)),
        },
        importedAt: new Date().toISOString(),
      }
      targetDb.exec(`CREATE TABLE "_legacy_import_manifest" (id INTEGER PRIMARY KEY CHECK (id = 1), source_sha256 TEXT NOT NULL, imported_at TEXT NOT NULL, report_json TEXT NOT NULL)`)
      targetDb.prepare('INSERT INTO "_legacy_import_manifest" (id, source_sha256, imported_at, report_json) VALUES (1, ?, ?, ?)').run(sourceSha256, manifestReport.importedAt, JSON.stringify(manifestReport))
      targetDb.exec('COMMIT')
      return { ...manifestReport, targetPath: resolvedTarget, targetIntegrity: 'ok', targetForeignKeyViolations: 0 }
    } catch (error) {
      try { targetDb.exec('ROLLBACK') } catch {}
      throw error
    }
  } finally {
    targetDb.close()
    sourceDb.close()
  }
}

function parseArgs(argv) {
  const args = { dryRun: false, source: null, target: null }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true
    else if (argv[i] === '--source') args.source = argv[++i]
    else if (argv[i] === '--target') args.target = argv[++i]
    else throw new Error(`خيار غير معروف: ${argv[i]}`)
  }
  if (!args.source) throw new Error('الاستخدام: node scripts/import-legacy-sqlite.mjs --source <backup.db> --dry-run')
  if (!args.dryRun && !args.target) throw new Error('للاستيراد يلزم تحديد --target بملف جديد يحتوي اسمه import-test أو restore-test')
  return args
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.dryRun) {
    const plan = await createImportPlan(args.source)
    const { _data, _linkPlan, _sourcePath, ...report } = plan
    process.stdout.write(JSON.stringify(report, null, 2) + '\\n')
    if (!report.canImport) process.exitCode = 2
    return
  }
  const result = await importLegacyDatabase({ sourcePath: args.source, targetPath: args.target })
  process.stdout.write(JSON.stringify(result, null, 2) + '\\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\\n')
    process.exitCode = 1
  })
}
