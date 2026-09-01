# PASS 28 — Payment Matrix + Customer Credit E2E

Status: IMPLEMENTED; live verification remains a release-gate task.

## Financial invariants
- Cash sale: active register required; cash ledger receives the amount retained by the store (total, not amount tendered when change is returned).
- Card/transfer sale: no cash-ledger movement.
- Partial cash sale: requires customer; remaining amount becomes customer receivable.
- Credit sale: requires customer and zero initial payment; full total becomes receivable.
- Card/transfer partial payment: rejected.
- Cash partial payment without customer: rejected.
- Customer collection cannot exceed customer balance or selected invoice outstanding amount.
- Every sale payment written into CustomerLedger is linked to the actual CustomerPayment row when available.
- Same Idempotency-Key must not create duplicate financial events.

## Live verification matrix
1. Cash full payment.
2. Cash overpayment + change.
3. Cash partial + customer.
4. Card full payment.
5. Transfer full payment.
6. Credit sale.
7. Invalid partial card/transfer.
8. Invalid partial cash without customer.
9. Invalid credit with initial payment.
10. Customer collection after credit sale.
11. Duplicate retry with same Idempotency-Key.

For each case reconcile: Sale, Customer, CustomerPayment, CustomerLedger, CashLedger, StockLedger and profit.
