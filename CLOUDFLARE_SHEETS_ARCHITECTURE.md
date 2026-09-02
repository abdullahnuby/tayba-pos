# Cloudflare + Google Sheets Architecture

```text
Browser
  |
  v
Cloudflare Worker / Next.js
  |
  +--> Local SQLite database (runtime)
  |
  +--> Google Apps Script Web App (daily archive)
          |
          v
      Google Sheets
      DAILY ARCHIVE / BACKUP
```

Daily operations read and write SQLite. Google Sheets is updated by the authenticated archive endpoint `POST /api/sync/archive` and is not used as the hot request path.
