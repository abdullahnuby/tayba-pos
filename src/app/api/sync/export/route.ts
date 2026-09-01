import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticate } from '@/lib/auth-middleware'

export async function GET(req: NextRequest) {
  const auth = await authenticate(req, { roles: ['admin', 'manager'], rateLimitScope: 'export' })
  if (auth instanceof Response) return auth

  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') || 'xlsx'

  const [
    categories, brands, suppliers, customers, products, variants,
    purchases, purchaseItems, sales, saleItems,
    saleReturns, saleReturnItems,
    customerPayments, supplierPayments,
    stockAdjustments, registerSessions, auditLogs,
    settings,
  ] = await Promise.all([
    db.category.findMany(),
    db.brand.findMany(),
    db.supplier.findMany(),
    db.customer.findMany(),
    db.product.findMany({ include: { category: true, brand: true } }),
    db.productVariant.findMany({ include: { product: true } }),
    db.purchase.findMany({ include: { supplier: true } }),
    db.purchaseItem.findMany({ include: { variant: { include: { product: true } }, purchase: { select: { invoiceNo: true } } } }),
    db.sale.findMany({ include: { customer: true, user: { select: { name: true } } } }),
    db.saleItem.findMany({ include: { variant: { include: { product: true } }, sale: { select: { invoiceNo: true } } } }),
    db.saleReturn.findMany({ include: { sale: { select: { invoiceNo: true } }, customer: true } }),
    db.saleReturnItem.findMany({ include: { variant: { include: { product: true } }, saleReturn: { select: { returnNo: true } } } }),
    db.customerPayment.findMany({ include: { customer: { select: { name: true } }, sale: { select: { invoiceNo: true } } } }),
    db.supplierPayment.findMany({ include: { supplier: { select: { name: true } }, purchase: { select: { invoiceNo: true } } } }),
    db.stockAdjustment.findMany({ include: { variant: { include: { product: true } }, user: { select: { name: true } } } }),
    db.registerSession.findMany({ include: { user: { select: { name: true } } } }),
    db.auditLog.findMany({ include: { user: { select: { name: true } } }, take: 500 }),
    db.setting.findMany(),
  ])

  if (format === 'csv') {
    // Export variants as CSV (most useful for inventory)
    const lines: string[] = []
    lines.push('product,sku,barcode,size,color,material,costPrice,sellPrice,quantity,minQuantity,reorderQty')
    for (const v of variants) {
      const row = [
        `"${v.product.name}"`,
        v.sku,
        v.barcode || '',
        v.size || '',
        v.color || '',
        v.material || '',
        v.costPrice,
        v.sellPrice,
        v.quantity,
        v.minQuantity,
        v.reorderQty,
      ]
      lines.push(row.join(','))
    }
    const csv = '\uFEFF' + lines.join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="inventory.csv"',
      },
    })
  }

  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const sheets: { name: string; rows: Record<string, unknown>[] }[] = [
    {
      name: 'Settings',
      rows: settings.map((s) => ({ key: s.key, value: s.value })),
    },
    {
      name: 'Categories',
      rows: categories.map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt.toISOString() })),
    },
    {
      name: 'Brands',
      rows: brands.map((b) => ({ id: b.id, name: b.name })),
    },
    {
      name: 'Suppliers',
      rows: suppliers.map((s) => ({
        id: s.id, name: s.name, phone: s.phone || '', address: s.address || '',
        notes: s.notes || '', balance: s.balance,
      })),
    },
    {
      name: 'Customers',
      rows: customers.map((c) => ({
        id: c.id, name: c.name, phone: c.phone || '', address: c.address || '',
        notes: c.notes || '', balance: c.balance, loyaltyPoints: c.loyaltyPoints,
      })),
    },
    {
      name: 'Products',
      rows: products.map((p) => ({
        id: p.id, name: p.name, description: p.description || '',
        category: p.category?.name || '', brand: p.brand?.name || '',
        gender: p.gender || '', season: p.season || '', material: p.material || '',
      })),
    },
    {
      name: 'Variants',
      rows: variants.map((v) => ({
        id: v.id, product: v.product.name, sku: v.sku, barcode: v.barcode || '',
        size: v.size || '', color: v.color || '', material: v.material || '',
        costPrice: v.costPrice, sellPrice: v.sellPrice, quantity: v.quantity,
        minQuantity: v.minQuantity, reorderQty: v.reorderQty,
        baseUnit: v.baseUnit || 'piece', purchaseUnit: v.purchaseUnit || 'piece', purchaseUnitFactor: v.purchaseUnitFactor || 1,
        saleUnit: v.saleUnit || 'piece', saleUnitFactor: v.saleUnitFactor || 1,
      })),
    },
    {
      name: 'Purchases',
      rows: purchases.map((p) => ({
        id: p.id, invoiceNo: p.invoiceNo, supplier: p.supplier?.name || '',
        date: p.date.toISOString(), subtotal: p.subtotal, discount: p.discount,
        taxAmount: p.taxAmount, total: p.total, paid: p.paid, status: p.status,
      })),
    },
    {
      name: 'PurchaseItems',
      rows: purchaseItems.map((i) => ({
        id: i.id, purchaseInvoice: i.purchase?.invoiceNo || '',
        product: i.variant?.product.name || '', sku: i.variant?.sku || '',
        quantity: i.quantity, unitCost: i.unitCost, total: i.total,
        enteredQuantity: i.enteredQuantity ?? '', unit: i.unit || 'piece', unitFactor: i.unitFactor || 1,
      })),
    },
    {
      name: 'Sales',
      rows: sales.map((s) => ({
        id: s.id, invoiceNo: s.invoiceNo, customer: s.customer?.name || 'عميل نقدي',
        cashier: s.user?.name || '', date: s.date.toISOString(),
        subtotal: s.subtotal, discount: s.discount, taxAmount: s.taxAmount,
        total: s.total, paid: s.paid, change: s.change,
        paymentMethod: s.paymentMethod, status: s.status,
      })),
    },
    {
      name: 'SaleItems',
      rows: saleItems.map((i) => ({
        id: i.id, saleInvoice: i.sale?.invoiceNo || '',
        product: i.variant?.product.name || '', sku: i.variant?.sku || '',
        quantity: i.quantity, unitPrice: i.unitPrice, unitCost: i.unitCost,
        total: i.total,
      })),
    },
    {
      name: 'SaleReturns',
      rows: saleReturns.map((r) => ({
        id: r.id, returnNo: r.returnNo, saleInvoice: r.sale?.invoiceNo || '',
        customer: r.customer?.name || '', date: r.date.toISOString(),
        total: r.total, reason: r.reason || '', status: r.status,
      })),
    },
    {
      name: 'SaleReturnItems',
      rows: saleReturnItems.map((i) => ({
        id: i.id, returnNo: i.saleReturn?.returnNo || '',
        product: i.variant?.product.name || '', sku: i.variant?.sku || '',
        quantity: i.quantity, unitPrice: i.unitPrice, total: i.total,
      })),
    },
    {
      name: 'CustomerPayments',
      rows: customerPayments.map((p) => ({
        id: p.id, customer: p.customer?.name || '', saleInvoice: p.sale?.invoiceNo || '',
        amount: p.amount, method: p.method, date: p.date.toISOString(),
      })),
    },
    {
      name: 'SupplierPayments',
      rows: supplierPayments.map((p) => ({
        id: p.id, supplier: p.supplier?.name || '', purchaseInvoice: p.purchase?.invoiceNo || '',
        amount: p.amount, method: p.method, date: p.date.toISOString(),
      })),
    },
    {
      name: 'StockAdjustments',
      rows: stockAdjustments.map((a) => ({
        id: a.id, product: a.variant?.product.name || '', sku: a.variant?.sku || '',
        type: a.type, quantityChange: a.quantityChange,
        reason: a.reason || '', user: a.user?.name || '', date: a.createdAt.toISOString(),
      })),
    },
    {
      name: 'RegisterSessions',
      rows: registerSessions.map((s) => ({
        id: s.id, user: s.user?.name || '', openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() || '',
        openingFloat: s.openingFloat, closingFloat: s.closingFloat,
        expectedCash: s.expectedCash, difference: s.difference,
        cashSales: s.cashSales, cardSales: s.cardSales, transferSales: s.transferSales,
        status: s.status,
      })),
    },
    {
      name: 'AuditLog',
      rows: auditLogs.map((l) => ({
        id: l.id, user: l.user?.name || '', action: l.action, entity: l.entity,
        entityId: l.entityId || '', createdAt: l.createdAt.toISOString(),
      })),
    },
  ]

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) {
      // Add empty header row
      const ws = XLSX.utils.json_to_sheet([{ 'no_data': '' }])
      XLSX.utils.book_append_sheet(wb, ws, sheet.name)
    } else {
      const ws = XLSX.utils.json_to_sheet(sheet.rows)
      XLSX.utils.book_append_sheet(wb, ws, sheet.name)
    }
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="store-data-full.xlsx"',
    },
  })
}
