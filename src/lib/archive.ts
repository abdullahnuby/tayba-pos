import { db } from '@/lib/db'
import { sheetsWriteSnapshot } from '@/lib/sheets-source'

const TABLES = [
  ['Settings', 'setting'],
  ['Users', 'user'],
  ['Categories', 'category'],
  ['Brands', 'brand'],
  ['Products', 'product'],
  ['Variants', 'productVariant'],
  ['Suppliers', 'supplier'],
  ['Customers', 'customer'],
  ['Purchases', 'purchase'],
  ['PurchaseItems', 'purchaseItem'],
  ['PurchaseReturns', 'purchaseReturn'],
  ['PurchaseReturnItems', 'purchaseReturnItem'],
  ['Sales', 'sale'],
  ['SaleItems', 'saleItem'],
  ['SaleReturns', 'saleReturn'],
  ['SaleReturnItems', 'saleReturnItem'],
  ['CustomerPayments', 'customerPayment'],
  ['SupplierPayments', 'supplierPayment'],
  ['RegisterSessions', 'registerSession'],
  ['StockAdjustments', 'stockAdjustment'],
  ['AuditLog', 'auditLog'],
] as const

function serialize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value === null || value === undefined) return ''
  return value
}

export async function archiveLocalDatabase() {
  const archived: string[] = []
  const errors: string[] = []

  for (const [sheet, model] of TABLES) {
    try {
      const rows = await (db as any)[model].findMany({ orderBy: { id: 'asc' } })
      const headers = Array.from(
        new Set(rows.flatMap((row: Record<string, unknown>) => Object.keys(row)))
      ) as string[]
      const stableHeaders = headers.length ? headers : ['no_data']
      const values = rows.map((row: Record<string, unknown>) =>
        stableHeaders.map((header) => serialize(row[header]))
      )
      await sheetsWriteSnapshot(sheet, stableHeaders, values)
      archived.push(sheet)
    } catch (error: unknown) {
      errors.push(`${sheet}: ${error instanceof Error ? error.message : 'archive failed'}`)
    }
  }

  const now = new Date().toISOString()
  await db.setting.upsert({
    where: { key: 'lastGoogleArchiveAt' },
    create: { key: 'lastGoogleArchiveAt', value: now },
    update: { value: now },
  })

  return { ok: errors.length === 0, archived, errors, archivedAt: now }
}
