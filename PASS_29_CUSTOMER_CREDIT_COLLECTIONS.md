# Pass 29 — Customer Credit & Collections E2E

- Customer statement now reads from CustomerLedger, not CustomerPayment alone.
- Statement includes opening balance, sale debits, payments, and return credits.
- Each entry exposes a running balance.
- Payment entries can resolve back to the underlying CustomerPayment.
- Customer payment UI sends an Idempotency-Key to prevent double collection on retries.
- Collection button is disabled while submitting and when amount is invalid/exceeds current receivable.
- Statement cache is invalidated after successful collection.
- Live verification remains a release-gate task against the deployed Google Apps Script.

## Critical retry fix discovered during Pass 29

The server-side `atomicAction` envelope now mirrors `payload.idempotencyKey` to the top-level Apps Script request. Previously, the key could remain nested under `payload`, meaning the Apps Script idempotency gate would not see it. The HTTP `Idempotency-Key` header is also forwarded. This makes retry protection effective for all atomic routes that supply an idempotency key, not just the customer-payment screen.
