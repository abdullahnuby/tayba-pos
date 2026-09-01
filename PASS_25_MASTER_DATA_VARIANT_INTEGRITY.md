# Pass 25 — Master Data / Variant Integrity

## Scope
Strengthen clothing product and variant identity before the live E2E purchase/sale cycle.

## Rules now enforced
- SKU is required and normalized.
- SKU is globally unique.
- Barcode is globally unique when present.
- Size/color/material combination is unique within the same product.
- Variant stock, minimum stock and reorder quantities cannot be negative.
- A variant created with a non-zero initial quantity creates an `opening_stock` StockLedger entry.

## Release verification still required
- Run these checks against the deployed Google Apps Script + real Google Sheet.
- Reconcile existing duplicate SKU/barcode data before first production use.
