/**
 * Sale price validation — prevents cashier manipulation.
 *
 * Rules:
 *  - cashier: unitPrice must be within [sellPrice * 0.95, sellPrice * 1.10]
 *    (max 5% discount, max 10% overcharge)
 *  - manager/admin: can override with manager PIN
 *  - All overrides are logged in audit log
 */
import { db } from './db'

export interface PriceCheckResult {
  ok: boolean
  error?: string
  needsManagerApproval?: boolean
}

export const DISCOUNT_TOLERANCE = 0.05  // 5% max cashier discount
export const OVERCHARGE_TOLERANCE = 0.10  // 10% max cashier overcharge

/**
 * Check whether a sale item unitPrice is acceptable for the given role.
 */
export async function checkSaleItemPrice(
  variantId: string,
  unitPrice: number,
  role: 'admin' | 'manager' | 'cashier'
): Promise<PriceCheckResult> {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    select: { sellPrice: true, sku: true, quarterDozenPrice: true, halfDozenPrice: true, dozenPrice: true, product: { select: { name: true } } },
  })
  if (!variant) {
    return { ok: false, error: 'منتج غير موجود' }
  }
  // Free items always require manager approval
  if (unitPrice <= 0) {
    return {
      ok: false,
      error: `سعر صفر غير مسموح لـ ${variant.product.name} (${variant.sku}) — يتطلب موافقة المدير`,
      needsManagerApproval: true,
    }
  }
  // Admins/managers can set any price (audit still records it)
  if (role === 'admin' || role === 'manager') {
    return { ok: true }
  }
  // A per-piece price matching one of the product's official pack prices (quarter/half/full
  // dozen, configured by a manager on the product itself) is not a cashier discount — it's
  // the catalog price for that unit, so it bypasses the tolerance band entirely.
  const packPiecePrices = [
    variant.quarterDozenPrice ? variant.quarterDozenPrice / 3 : null,
    variant.halfDozenPrice ? variant.halfDozenPrice / 6 : null,
    variant.dozenPrice ? variant.dozenPrice / 12 : null,
  ].filter((p): p is number => p != null)
  const PACK_PRICE_EPSILON = 0.02 // per-piece rounding tolerance
  if (packPiecePrices.some((p) => Math.abs(p - unitPrice) <= PACK_PRICE_EPSILON)) {
    return { ok: true }
  }
  // Cashier: enforce bounds
  const minPrice = variant.sellPrice * (1 - DISCOUNT_TOLERANCE)
  const maxPrice = variant.sellPrice * (1 + OVERCHARGE_TOLERANCE)
  if (unitPrice < minPrice) {
    return {
      ok: false,
      error: `السعر ${unitPrice} أقل من الحد المسموح (${minPrice.toFixed(2)}) لـ ${variant.product.name} — خصم > ${DISCOUNT_TOLERANCE * 100}% يتطلب موافقة المدير`,
      needsManagerApproval: true,
    }
  }
  if (unitPrice > maxPrice) {
    return {
      ok: false,
      error: `السعر ${unitPrice} أعلى من الحد المسموح (${maxPrice.toFixed(2)}) لـ ${variant.product.name} — يحتاج موافقة المدير`,
      needsManagerApproval: true,
    }
  }
  return { ok: true }
}

/**
 * Retry wrapper for transactions that may hit P2002 (unique constraint)
 * on invoice numbers due to race conditions, or transient backend timeout errors.
 * Retries up to 5 times with exponential backoff.
 */
export async function retryOnConflict<T>(fn: () => Promise<T>, retries = 5): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      // P2002 = unique constraint violation (likely invoiceNo collision)
      if (err.code === 'P2002' || err.message?.includes('P2002')) {
        lastErr = e
        // Exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms
        await new Promise((r) => setTimeout(r, 50 * Math.pow(2, i)))
        continue
      }
      // Transaction timeout / Socket timeout — retry with longer delay
      if (err.message?.includes('Transaction already closed') ||
          err.message?.includes('timeout') ||
          err.message?.includes('Socket timeout')) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, i)))
        continue
      }
      throw e
    }
  }
  throw lastErr
}
