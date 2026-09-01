# PASS 30 — Supplier Payables & Purchase Returns E2E

## Implemented
- Atomic `commit_purchase_return` in Google Apps Script.
- Purchase-return quantity cannot exceed the original purchased quantity minus prior returns.
- Returned quantity cannot exceed current stock.
- Purchase-return unit cost is taken from the historical PurchaseItem cost, not client input.
- StockLedger records `purchase_return` with quantity out.
- SupplierLedger records a negative `purchase_return` amount.
- Supplier balance is reduced by the full return value; a negative balance represents supplier credit owed to the store.
- Refund methods: credit, cash, card, transfer.
- Cash refunds require an open register and create CashLedger amountIn.
- Idempotency is supported through the existing atomic envelope.
- Authenticated purchase-return API; cashier is denied.

## Live verification required
1. Purchase 10 @ 100; return 3 => stock 7, supplier payable reduced by 300.
2. Attempt to return 8 after returning 3 => reject.
3. Purchase fully paid; return 2 @ 100 with cash refund => supplier balance -200 and CashLedger +200.
4. Card/transfer refund must not change CashLedger.
5. Retry the same return with the same Idempotency-Key => one return only.
6. Failure after stock mutation must restore PurchaseReturn, stock, StockLedger, supplier, SupplierLedger, and CashLedger.
