# Tayba POS — Cloudflare Workers Deployment

## Cloudflare Workers Builds

Use these exact settings:

- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npm run cf:deploy`
- Branch: `main`

The build command generates the production output under `dist/`.
The deploy script uses the vinext-generated server Wrangler config at:
`dist/server/wrangler.json`

It also uses `--skip-build` because the build step has already completed.

## Worker entry

The root `wrangler.jsonc` declares:

`main: "vinext/server/fetch-handler"`

This is the current vinext Cloudflare Worker entry for an App Router application.

## KV

Replace:

`REPLACE_WITH_CLOUDFLARE_KV_NAMESPACE_ID`

in `wrangler.jsonc` with the real KV namespace ID for the `VINEXT_KV_CACHE` binding.

## Secrets

Set these as Cloudflare Worker Secrets:

- `GOOGLE_APPS_SCRIPT_URL`
- `GOOGLE_APPS_SCRIPT_TOKEN`
- `AUTH_SECRET`

Do not put secret values into `wrangler.jsonc`.

## Local production check

1. `npm install`
2. `npm run build`
3. `npx wrangler dev --config dist/server/wrangler.json`

## Cloudflare deployment

Cloudflare Workers Builds:

`Build command: npm run build`

`Deploy command: npm run cf:deploy`

After deployment test:

`/`

`/api/infrastructure/health`

`/api/auth/setup`
