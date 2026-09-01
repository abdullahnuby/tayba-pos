# Cloudflare deployment

Cloudflare currently recommends **vinext** for full-stack Next.js on Workers. This repository is prepared for that path.

## One-time setup

```bash
npm install
npx vinext check
npm run cf:init
```

The init command may update `wrangler.jsonc`, `vite.config.ts`, and the Worker entry to match the installed vinext version. Keep the generated Worker entry; do not replace it with a custom fetch handler.

Create a KV namespace:

```bash
npx wrangler kv namespace create VINEXT_KV_CACHE
```

Put the returned namespace ID into `wrangler.jsonc`.

Set the server-only Apps Script secrets:

```bash
npx wrangler secret put GOOGLE_APPS_SCRIPT_URL
npx wrangler secret put GOOGLE_APPS_SCRIPT_TOKEN
```

Then:

```bash
npm run cf:deploy
```

## Google Apps Script

Use `public/GoogleAppsScript.gs` and set the Script Property:

`TAYBA_API_TOKEN = <same random value as GOOGLE_APPS_SCRIPT_TOKEN>`

Deploy as a Web App, executing as the owner. The URL goes into `GOOGLE_APPS_SCRIPT_URL`.

## Important

Production mode uses Google Sheets as the sole persistent datastore. Cloudflare KV is read-cache only. Configure the Apps Script URL/token and KV binding before deployment.
