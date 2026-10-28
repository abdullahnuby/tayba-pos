/**
 * Local-only compatibility surface for older UI/API imports.
 * All operational data stays in SQLite; no network synchronization is performed.
 */

export interface SyncConfig {
  method: 'local'
  source: 'sqlite'
}

export interface AppsScriptConnectionResult {
  ok: false
  message: string
}

export async function getSyncConfig(): Promise<SyncConfig> {
  return { method: 'local', source: 'sqlite' }
}

export async function isGoogleConfigured(): Promise<boolean> {
  return false
}

export async function testAppsScriptConnection(_url: string): Promise<AppsScriptConnectionResult> {
  return { ok: false, message: 'تم تعطيل تكامل Google Sheets نهائيًا؛ البيانات محفوظة محليًا فقط.' }
}

/** Kept temporarily for older routes; callers must not treat this as an archive. */
export async function syncAllSheets() {
  return { ok: false, disabled: true, source: 'local-sqlite', message: 'المزامنة السحابية معطلة في النسخة المحلية.' }
}

export async function syncAfterSale(_customerId?: string | null): Promise<void> {}
export async function syncAfterPurchase(_supplierId?: string | null): Promise<void> {}
export async function syncAfterReturn(_customerId?: string | null): Promise<void> {}
export async function syncAfterCustomerPayment(): Promise<void> {}
export async function syncAfterSupplierPayment(): Promise<void> {}
export async function syncAfterAdjustment(): Promise<void> {}
export async function syncAfterProduct(): Promise<void> {}
export async function getLastSyncAt(): Promise<string | null> { return null }
