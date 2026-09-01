# Cloudflare build fix v4

The App Router build requires `@vitejs/plugin-rsc` at the project root. It is intentionally a direct dependency (not only a dev dependency) so Cloudflare/Bun cannot omit it during dependency installation.

Build command: `npm run build`
Deploy command: `npx wrangler deploy`

Do not add `rsc()` manually to vite.config.ts; vinext auto-registers it.
