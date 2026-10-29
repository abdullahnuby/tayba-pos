import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importLegacyDatabase, resolveReturnItemLinks } from '../scripts/import-legacy-sqlite.mjs'

function makeLegacyFixture(path) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = OFF')
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT, pin_hash TEXT, name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category_id TEXT NOT NULL, brand_id TEXT, gender TEXT, season TEXT, material TEXT, image TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE product_variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, sku TEXT NOT NULL UNIQUE, barcode TEXT UNIQUE, size TEXT, color TEXT, material TEXT, cost_price REAL NOT NULL, sell_price REAL NOT NULL, quantity INTEGER NOT NULL, min_quantity INTEGER NOT NULL, reorder_qty INTEGER NOT NULL, base_unit TEXT NOT NULL, purchase_unit TEXT NOT NULL, purchase_unit_factor INTEGER NOT NULL, sale_unit TEXT NOT NULL, sale_unit_factor INTEGER NOT NULL, quarter_dozen_price REAL, half_dozen_price REAL, dozen_price REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, notes TEXT, balance REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, notes TEXT, balance REAL NOT NULL, loyalty_points INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE register_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT, opening_float REAL NOT NULL, closing_float REAL, expected_cash REAL, difference REAL, cash_sales REAL NOT NULL, card_sales REAL NOT NULL, transfer_sales REAL NOT NULL, notes TEXT, status TEXT NOT NULL);
    CREATE TABLE purchases (id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL, supplier_id TEXT NOT NULL, date TEXT NOT NULL, subtotal REAL NOT NULL, discount REAL NOT NULL, tax_rate REAL NOT NULL, tax_amount REAL NOT NULL, total REAL NOT NULL, paid REAL NOT NULL, status TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL, idempotency_key TEXT, register_session_id TEXT);
    CREATE TABLE purchase_items (id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL, variant_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_cost REAL NOT NULL, total REAL NOT NULL, entered_quantity REAL, unit TEXT, unit_factor INTEGER);
    CREATE TABLE purchase_returns (id TEXT PRIMARY KEY, return_no TEXT NOT NULL, purchase_id TEXT NOT NULL, supplier_id TEXT NOT NULL, date TEXT NOT NULL, total REAL NOT NULL, reason TEXT, notes TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, idempotency_key TEXT);
    CREATE TABLE purchase_return_items (id TEXT PRIMARY KEY, purchase_return_id TEXT NOT NULL, variant_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_cost REAL NOT NULL, total REAL NOT NULL);
    CREATE TABLE sales (id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL, user_id TEXT, customer_id TEXT, register_session_id TEXT, date TEXT NOT NULL, subtotal REAL NOT NULL, discount REAL NOT NULL, tax_rate REAL NOT NULL, tax_amount REAL NOT NULL, total REAL NOT NULL, paid REAL NOT NULL, change REAL NOT NULL, payment_method TEXT NOT NULL, status TEXT NOT NULL, void_reason TEXT, notes TEXT, created_at TEXT NOT NULL, idempotency_key TEXT, created_role TEXT, manager_approved INTEGER NOT NULL);
    CREATE TABLE sale_items (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, variant_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, unit_cost REAL NOT NULL, total REAL NOT NULL);
    CREATE TABLE sale_returns (id TEXT PRIMARY KEY, return_no TEXT NOT NULL UNIQUE, sale_id TEXT NOT NULL, customer_id TEXT, date TEXT NOT NULL, subtotal REAL NOT NULL, total REAL NOT NULL, reason TEXT, notes TEXT, status TEXT NOT NULL, refund_method TEXT, created_at TEXT NOT NULL, idempotency_key TEXT, manager_approved INTEGER NOT NULL);
    CREATE TABLE sale_return_items (id TEXT PRIMARY KEY, sale_return_id TEXT NOT NULL, sale_item_id TEXT NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT, variant_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, total REAL NOT NULL);
    CREATE TABLE customer_payments (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, sale_id TEXT, sale_return_id TEXT, amount REAL NOT NULL, method TEXT NOT NULL, date TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL, idempotency_key TEXT, register_session_id TEXT);
    CREATE TABLE supplier_payments (id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, purchase_id TEXT, purchase_return_id TEXT, amount REAL NOT NULL, method TEXT NOT NULL, date TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL, idempotency_key TEXT, register_session_id TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE stock_movements (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, type TEXT NOT NULL, quantity INTEGER NOT NULL, reference_type TEXT, reference_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE audit_logs (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL);
    CREATE TABLE budgets (id TEXT PRIMARY KEY, period_month TEXT, category TEXT, planned_amount REAL, note TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE cash_ledger (id TEXT PRIMARY KEY, register_session_id TEXT, user_id TEXT, entry_type TEXT, reference_type TEXT, reference_id TEXT, amount_in REAL, amount_out REAL, note TEXT, created_at TEXT, idempotency_key TEXT);
    CREATE TABLE customer_ledger (id TEXT PRIMARY KEY, customer_id TEXT, entry_type TEXT, reference_type TEXT, reference_id TEXT, debit REAL, credit REAL, note TEXT, created_at TEXT);
    CREATE TABLE expenses (id TEXT PRIMARY KEY, category TEXT, amount REAL, note TEXT, date TEXT, user_id TEXT, register_session_id TEXT, created_at TEXT, expense_type TEXT, recurring_expense_id TEXT, period_month TEXT);
    CREATE TABLE owner_transactions (id TEXT PRIMARY KEY, type TEXT, amount REAL, date TEXT, note TEXT, user_id TEXT, created_at TEXT);
    CREATE TABLE recurring_expenses (id TEXT PRIMARY KEY, name TEXT, category TEXT, amount REAL, frequency TEXT, day_of_month INTEGER, start_date TEXT, end_date TEXT, active INTEGER, note TEXT, last_generated_period TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE supplier_ledger (id TEXT PRIMARY KEY, supplier_id TEXT, entry_type TEXT, reference_type TEXT, reference_id TEXT, debit REAL, credit REAL, note TEXT, created_at TEXT);
    CREATE TABLE sync_queue (id TEXT PRIMARY KEY, entity_type TEXT, entity_id TEXT, operation TEXT, payload TEXT, created_at TEXT, synced_at TEXT, retry_count INTEGER, status TEXT, last_error TEXT, next_attempt_at TEXT);
    CREATE TABLE document_sequences (document_type TEXT, date_key TEXT, current_value INTEGER, PRIMARY KEY(document_type,date_key));
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)

  const date = '2026-10-01T12:00:00.000Z'
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run('u1','owner',null,'legacy-pin-hash','Owner','admin',1,date,date)
  db.prepare('INSERT INTO categories VALUES (?,?,?)').run('c1','Category',date)
  db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('p1','Product',null,'c1',null,null,null,null,null,date,date)
  db.prepare('INSERT INTO product_variants VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('v1','p1','SKU-1',null,null,null,null,6,10,8,0,4,'piece','piece',1,'piece',1,null,null,null,date,date)
  db.prepare('INSERT INTO suppliers VALUES (?,?,?,?,?,?,?,?)').run('su1','Supplier',null,null,null,0,date,date)
  db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?)').run('cu1','Customer',null,null,null,0,0,date,date)
  db.prepare('INSERT INTO register_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('rs1','u1',date,null,0,null,null,null,0,0,0,null,'open')
  db.prepare('INSERT INTO sales VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('s1','20261001-001','u1',null,'rs1',date,20,0,0,0,20,20,0,'cash','completed',null,null,date,null,'admin',0)
  db.prepare('INSERT INTO sale_items VALUES (?,?,?,?,?,?,?)').run('si1','s1','v1',2,10,6,20)
  db.prepare('INSERT INTO sale_returns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('sr1','20261002-001','s1',null,date,10,10,null,null,'completed','cash',date,null,0)
  db.prepare('INSERT INTO sale_return_items VALUES (?,?,?,?,?,?,?)').run('ri1','sr1','missing-sale-item','v1',1,10,10)
  db.prepare('INSERT INTO stock_movements VALUES (?,?,?,?,?,?,?)').run('sm1','v1','OPENING_STOCK',8,null,null,date)
  db.prepare('INSERT INTO settings VALUES (?,?)').run('storeName','Test Store')
  db.prepare('INSERT INTO settings VALUES (?,?)').run('autoSyncEnabled','true')
  db.prepare('INSERT INTO cash_ledger VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('cash1','rs1','u1','SALE','sale','s1',20,0,null,date,null)
  db.exec('PRAGMA user_version = 1')
  db.close()
}

test('legacy import repairs unique orphan return references, preserves raw tables, and never modifies the source', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tayba-import-test-'))
  const sourcePath = join(dir, 'legacy-source.db')
  const targetPath = join(dir, 'tayba-import-test.db')
  t.after(() => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { rmSync(targetPath + suffix, { force: true }) } catch {}
      try { rmSync(sourcePath + suffix, { force: true }) } catch {}
    }
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  })

  makeLegacyFixture(sourcePath)
  const beforeHash = createHash('sha256').update((await import('node:fs')).readFileSync(sourcePath)).digest('hex')

  const result = await importLegacyDatabase({ sourcePath, targetPath })
  assert.equal(result.targetIntegrity, 'ok')
  assert.equal(result.targetForeignKeyViolations, 0)
  assert.equal(result.repairedSaleReturnLinks.length, 1)
  assert.equal(result.repairedSaleReturnLinks[0].originalSaleItemId, 'missing-sale-item')
  assert.equal(result.repairedSaleReturnLinks[0].repairedSaleItemId, 'si1')
  assert.equal(result.archivedLegacyTableCounts.cash_ledger, 1)

  assert.equal(existsSync(targetPath), true)
  const target = new DatabaseSync(targetPath, { readOnly: true })
  try {
    assert.equal(target.prepare('SELECT COUNT(*) AS n FROM "Sale"').get().n, 1)
    assert.equal(target.prepare('SELECT COUNT(*) AS n FROM "SaleReturnItem"').get().n, 1)
    assert.equal(target.prepare('SELECT saleItemId FROM "SaleReturnItem" WHERE id = ?').get('ri1').saleItemId, 'si1')
    assert.equal(target.prepare('SELECT sale_item_id FROM "legacy_archive__sale_return_items" WHERE id = ?').get('ri1').sale_item_id, 'missing-sale-item')
    assert.equal(target.prepare('SELECT COUNT(*) AS n FROM "Setting" WHERE key = ?').get('autoSyncEnabled').n, 0)
    assert.equal(target.prepare('SELECT COUNT(*) AS n FROM "legacy_archive__sync_queue"').get().n, 0)
    assert.equal(target.prepare('SELECT COUNT(*) AS n FROM "legacy_archive__cash_ledger"').get().n, 1)
    assert.equal(target.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally {
    target.close()
  }
  const afterHash = createHash('sha256').update((await import('node:fs')).readFileSync(sourcePath)).digest('hex')
  assert.equal(afterHash, beforeHash)
})

test('return-link resolver refuses ambiguous candidates rather than guessing', () => {
  const result = resolveReturnItemLinks(
    [{ id: 'sale1', invoice_no: 'INV-1' }],
    [
      { id: 'item1', sale_id: 'sale1', variant_id: 'v1', unit_price: 10, quantity: 5 },
      { id: 'item2', sale_id: 'sale1', variant_id: 'v1', unit_price: 10, quantity: 6 },
    ],
    [{ id: 'return1', sale_id: 'sale1', return_no: 'RET-1', date: '2026-10-01', total: 10 }],
    [{ id: 'line1', sale_return_id: 'return1', sale_item_id: 'missing', variant_id: 'v1', unit_price: 10, quantity: 1, total: 10 }],
  )
  assert.equal(result.mapped.length, 0)
  assert.equal(result.repairs.length, 0)
  assert.equal(result.unresolved.length, 1)
})
