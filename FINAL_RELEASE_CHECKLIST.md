# طيبة POS — Final Release Checklist

This checklist is a release gate, not a claim that live verification has already happened.

## Business E2E
- Admin login / cashier creation
- Category / brand / product / variant creation
- Purchase → stock → weighted cost → supplier balance
- Open register → cash sale → cash ledger
- Card / transfer sale → no cash drawer increase
- Credit sale → customer ledger
- Customer collection → customer ledger + cash ledger
- Sale return → stock + customer/cash settlement
- Purchase return → stock + supplier/cash settlement
- Stock adjustment → stock ledger + audit
- Close register → expected vs actual cash
- Reports reconcile to ledgers

## Security
- Unauthenticated API matrix
- Cashier/manager/admin authorization matrix
- Idempotency lost-response test
- Debug endpoints disabled in production
- Production secrets explicitly configured

## Mobile POS
- Barcode/search
- Cart editing
- Payment
- Change calculation
- Customer credit
- Double-tap protection
- Receipt result / print / share

## Technical
- Build
- TypeScript
- ESLint
- Google Apps Script syntax
- Final Google Sheets headers/schema
- Historical reconciliation
