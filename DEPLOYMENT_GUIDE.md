# طيبة POS — Production Deployment

## Architecture
- Cloudflare Workers + Next.js (vinext)
- Google Apps Script Web App
- Google Sheets = **100% persistent source of truth**
- Cloudflare KV = short-lived read cache only
- No SQLite/Prisma database is used in production

## Required Cloudflare configuration
Set these as encrypted/secret variables in the Worker:

- `GOOGLE_APPS_SCRIPT_URL`
- `GOOGLE_APPS_SCRIPT_TOKEN`
- `AUTH_SECRET`

Bind a KV namespace to `VINEXT_KV_CACHE`.

## Google Apps Script
1. Open the target Google Sheet.
2. Extensions → Apps Script.
3. Paste the complete `public/GoogleAppsScript.gs`.
4. In Script Properties create `TAYBA_API_TOKEN` with the exact same value as `GOOGLE_APPS_SCRIPT_TOKEN`.
5. Deploy as Web app, Execute as **Me**, access **Anyone**.
6. Copy the Web App URL into `GOOGLE_APPS_SCRIPT_URL`.

## First run
The application creates sheet tabs lazily when needed. Use the Sync page once after deploying to warm the cache and verify connectivity.

## Important data rule
Sales, purchases, returns, payments, stock adjustments and settings are persisted in Google Sheets. KV may disappear at any time without data loss.
