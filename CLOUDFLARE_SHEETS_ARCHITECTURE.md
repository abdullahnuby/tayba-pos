# Cloudflare + Google Sheets Architecture

```text
Browser
  |
  v
Cloudflare Worker / Next.js
  |
  +--> Cloudflare KV (read cache only)
  |
  +--> Google Apps Script Web App
          |
          v
      Google Sheets
      SOURCE OF TRUTH
```

Writes always go to Apps Script/Sheets. Reads may come from KV for up to a short TTL and then fall back to Sheets. After mutations, cache entries expire quickly so stale reads are bounded.

SQLite/Prisma are not part of the production runtime.
