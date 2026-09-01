# PASS 26 — Purchase → Stock Integrity

## Changes
- Purchase atomic snapshot now includes `productVariant` and `stockLedger`, so rollback cannot leave inventory changes behind after a failed purchase.
- Duplicate variants are rejected inside a single purchase request.
- Variant id is required for every purchase line.
- Quantity must be a positive integer and unit cost must be positive.
- Weighted-average inventory cost continues to use the supplier unit cost, while purchase VAT is kept separate from inventory cost/COGS.
- Purchase UI now calculates and displays VAT and total consistently with the backend's default 14% VAT configuration.

## E2E assertions to verify against the live Apps Script
1. Purchase 10 units @ 100 with opening stock 0 => quantity 10, cost 100.
2. Purchase 10 units @ 120 with stock 10 @ 100 => quantity 20, moving average cost 110.
3. Purchase with cash payment requires an open register.
4. Purchase with card/transfer does not change Cash Ledger.
5. Failed purchase after a stock write must restore both ProductVariant and StockLedger.
6. Duplicate variant lines in one purchase are rejected.
7. Supplier balance equals SupplierLedger balance after purchase/payment.
