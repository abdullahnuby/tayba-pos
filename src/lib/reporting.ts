export interface SaleFinancials {
  subtotal: number
  total: number
  taxAmount?: number | null
}

export interface SaleLineFinancials {
  total: number
}

/** Revenue belonging to the store before cost of goods and excluding collected VAT. */
export function recognizedSaleRevenue(sale: SaleFinancials): number {
  return Math.max(0, sale.total - (sale.taxAmount || 0))
}

/**
 * Allocate invoice-level discount and tax proportionally across item lines.
 * This makes line/category/day profit reconcile to the invoice-level result.
 */
export function recognizedLineRevenue(sale: SaleFinancials, line: SaleLineFinancials): number {
  if (sale.subtotal <= 0 || line.total <= 0) return 0
  return recognizedSaleRevenue(sale) * line.total / sale.subtotal
}

/** Net-of-VAT revenue represented by an actual returned invoice amount. */
export function recognizedReturnRevenue(
  sale: SaleFinancials,
  returnedTotal: number,
): number {
  if (sale.total <= 0 || returnedTotal <= 0) return 0
  const boundedReturn = Math.min(returnedTotal, sale.total)
  return recognizedSaleRevenue(sale) * boundedReturn / sale.total
}
