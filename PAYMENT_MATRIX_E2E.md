# Pass 28 — Payment Matrix & Customer Credit E2E

## Purpose
Verify that every POS payment mode produces the correct financial side effects.

## Canonical rules

| Mode | Customer | Paid | Register | Customer Balance | Expected result |
|---|---|---:|---|---|---|
| Cash | No | Full | Required | No change | Sale completes; cash in = total |
| Cash | No | Over | Required | No change | Sale completes; cash in = total; change returned |
| Cash | Yes | Partial | Required | Increases by remaining | Sale completes; cash in = paid |
| Cash | Yes | Full | Required | No change | Sale completes; cash in = total |
| Card | Optional | Full | Not required | No change if full paid | Sale completes; no cash ledger entry |
| Transfer | Optional | Full | Not required | No change if full paid | Sale completes; no cash ledger entry |
| Credit | Required | 0 | Required by current POS cash-session policy | Increases by total | Sale completes as receivable |
| Card/Transfer | Any | Partial | N/A | N/A | Reject |
| Credit | Yes | >0 | N/A | N/A | Reject; collect later through Customer Payment |
| Cash | No | Partial | N/A | N/A | Reject |

## Invariants

1. `Sale.total` is the authoritative invoice total.
2. Cash drawer increases only by actual cash retained by the store, not by the amount handed over when change is returned.
3. Card and transfer never create `CashLedger` entries.
4. A partial cash sale requires a customer and creates a receivable equal to `total - paid`.
5. A credit sale creates a receivable equal to `total` and does not create an initial payment.
6. Customer ledger = full sale debit + actual payment credit/debit movements.
7. A POS sale's `CustomerPayment` ledger entry references the actual payment row where possible, not merely the sale row.
8. Every retry must reuse the same `Idempotency-Key`.

## Live test sequence

- Create one product variant with known stock/cost.
- Open a register for the cashier.
- Run one sale for each supported mode.
- After each sale record: invoice total, paid, change, stock, customer balance, cash ledger delta, customer ledger delta, and profit.
- Attempt all invalid combinations above and confirm HTTP 4xx with no data mutation.
- Repeat one successful request with the same idempotency key and confirm exactly one sale/payment.

## Release gate

Live execution against the deployed Google Apps Script remains required before marking this pass as verified.
