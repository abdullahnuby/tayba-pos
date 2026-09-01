# B10 — Profit / COGS Policy

- Historical COGS comes from `SaleItem.unitCost`, never the current variant cost.
- Invoice discounts reduce revenue and are allocated proportionally across sale lines.
- VAT/output tax is excluded from management revenue and profit.
- A completed sale return reduces revenue by the refund amount and reverses COGS using the original SaleItem cost snapshot.
- Dashboard and Reports use the same calculation helper to avoid conflicting profit numbers.
- Purchase totals remain a cash/payables metric and are not treated as COGS until stock is sold.
