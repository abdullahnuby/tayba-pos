# Tayba POS — API Authorization Matrix

Release QA baseline. All application APIs must require an authenticated session unless explicitly listed as public authentication/setup endpoints.

## Public by design
- `POST /api/auth/login` — login only; rate limited.
- `POST /api/auth/setup` — only succeeds while there are zero users; rate limited.

## Authenticated
- Product/category/brand/variant reads
- Customer reads
- Sales/purchases/returns reads
- Dashboard/reports
- Register sessions
- Customer/supplier payments
- Authenticated logout/me/change-password

## Admin/Manager only
- User administration
- Store/settings administration
- Audit logs
- Stock ledger and stock-adjustment history
- Stock adjustments
- Register history
- Data export and Google sync operations
- Infrastructure health/diagnostics

## Release tests
1. Unauthenticated request to every protected GET/POST/PATCH/DELETE returns `401` or `403`.
2. Cashier request to every manager/admin endpoint returns `403`.
3. Manager cannot access admin-only user administration.
4. Admin can perform all management operations.
5. No diagnostic endpoint exposes secrets/configuration without authentication.
