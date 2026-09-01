/**
 * Cost accounting — Moving Weighted Average (MWA).
 *
 * When purchasing new stock, the variant's cost price updates to:
 *   newCost = (oldQty * oldCost + newQty * newCost) / (oldQty + newQty)
 *
 * Returns also affect the average (when a sale is returned, the cost
 * gets added back at the original snapshot cost, not the current MWA,
 * to preserve historical accuracy).
 */
import { db } from './db'

export interface CostUpdateResult {
  newQty: number
  newCost: number
}

export async function applyPurchaseCost(
  tx: Parameters<Parameters<typeof db['$transaction']>[0]>[0],
  variantId: string,
  qtyAdded: number,
  unitCost: number
): Promise<CostUpdateResult> {
  const v = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } })
  const oldQty = v.quantity
  const oldCost = v.costPrice
  const newQty = oldQty + qtyAdded
  // MWA: weighted by quantity
  const newCost = newQty > 0
    ? (oldQty * oldCost + qtyAdded * unitCost) / newQty
    : unitCost
  await tx.productVariant.update({
    where: { id: variantId },
    data: { costPrice: newCost, quantity: newQty },
  })
  return { newQty, newCost }
}

/**
 * Compute VAT amount given subtotal, rate, and inclusivity flag.
 */
export function computeVAT(
  subtotal: number,
  taxRate: number,
  inclusive: boolean
): { taxAmount: number; total: number; netSubtotal: number } {
  if (taxRate <= 0) return { taxAmount: 0, total: subtotal, netSubtotal: subtotal }
  if (inclusive) {
    // subtotal includes VAT
    const net = subtotal / (1 + taxRate / 100)
    return { taxAmount: subtotal - net, total: subtotal, netSubtotal: net }
  } else {
    const tax = subtotal * (taxRate / 100)
    return { taxAmount: tax, total: subtotal + tax, netSubtotal: subtotal }
  }
}
