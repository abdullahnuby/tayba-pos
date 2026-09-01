export type ProfitSaleItem = {
  quantity: number
  unitPrice: number
  unitCost: number
  total: number
}

export type ProfitSale = {
  subtotal: number
  discount: number
  taxAmount: number
  items: ProfitSaleItem[]
}

export type ProfitReturnItem = {
  quantity: number
  total: number
  saleItem: { unitCost: number }
}

/**
 * Profit is calculated from historical SaleItem.unitCost snapshots.
 * Sales discounts reduce revenue (and are allocated proportionally to lines).
 * VAT/output tax is excluded from revenue because it is not store income.
 */
export function calculateSaleProfit(sale: ProfitSale) {
  const grossLines = sale.items.reduce((sum, item) => sum + item.total, 0)
  const discount = Math.max(0, sale.discount || 0)
  const netRevenue = Math.max(0, (sale.subtotal || grossLines) - discount)
  let cogs = 0
  let lineRevenue = 0

  for (const item of sale.items) {
    const gross = Math.max(0, item.total)
    const allocatedDiscount = grossLines > 0 ? discount * (gross / grossLines) : 0
    lineRevenue += Math.max(0, gross - allocatedDiscount)
    cogs += Math.max(0, item.unitCost) * Math.max(0, item.quantity)
  }

  return {
    revenue: Math.round(netRevenue * 100) / 100,
    cogs: Math.round(cogs * 100) / 100,
    profit: Math.round((netRevenue - cogs) * 100) / 100,
    taxExcluded: true,
    lineRevenue: Math.round(lineRevenue * 100) / 100,
  }
}

export function calculateReturnImpact(items: ProfitReturnItem[]) {
  const revenue = items.reduce((sum, item) => sum + Math.max(0, item.total), 0)
  const cogs = items.reduce(
    (sum, item) => sum + Math.max(0, item.saleItem.unitCost) * Math.max(0, item.quantity),
    0,
  )
  return {
    revenue: Math.round(revenue * 100) / 100,
    cogs: Math.round(cogs * 100) / 100,
    profitImpact: Math.round((revenue - cogs) * 100) / 100,
  }
}
