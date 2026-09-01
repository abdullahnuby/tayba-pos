# Tayba POS — Cloudflare + Google Sheets

Production architecture for personal use:

```text
Cloudflare Workers / Next.js
        |
        +--> Cloudflare KV (short-lived read cache)
        |
        +--> Google Apps Script
                 |
                 v
            Google Sheets
            SOURCE OF TRUTH 100%
```

## What this release does
- Google Sheets is the only persistent datastore.
- Cloudflare KV is cache only; deleting KV cannot delete business data.
- Existing POS screens/API contracts are preserved as much as possible.
- Google Apps Script serializes writes with `LockService`.
- No production SQLite/Prisma database is required.

## Required secrets
```text
GOOGLE_APPS_SCRIPT_URL
GOOGLE_APPS_SCRIPT_TOKEN
AUTH_SECRET
```

## Deploy
See `DEPLOYMENT_GUIDE.md` and `CLOUDFLARE_SETUP.md`.
