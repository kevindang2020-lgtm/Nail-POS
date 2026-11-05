# Browser tests (Playwright)

Headless end-to-end checks that drive the **real** front-end UIs against a live API + Vite dev server. They complement
the unit/integration suites by proving the screens actually render and the flows work in a browser.

| Script | What it proves |
| --- | --- |
| `import-ui.mjs` | Front-desk login → Customers → **Import** panel → paste CSV → Preview → Import → the new customer appears. Screenshots `01-login`, `04-preview`, `05-imported`. |
| `customer-display.mjs` | Builds a live checkout session via the API, then renders the **customer display** (iPad kiosk) and asserts salon name + order + totals. Screenshot `07-customer-display`. |

## Prerequisites

1. **Postgres** running with a seeded tenant DB (the scripts default to the `LUXE` salon / `owner@luxenails.test`).
2. **API** built and running on `:3000`:
   ```bash
   npm run build --workspace @aipowersalon/api
   DATABASE_URL=postgresql://... REPO_DRIVER=postgres AUTH_SESSION_SECRET=dev PORT=3000 node apps/api/dist/main.js
   ```
3. **Vite dev server** for the app under test (it proxies `/pos` + `/auth` to the API):
   ```bash
   (cd apps/pos-web && node ../../node_modules/.bin/vite --port 5173 --host)          # for import-ui
   (cd apps/customer-display && node ../../node_modules/.bin/vite --port 5180 --host) # for customer-display
   ```
4. **Chromium** for Playwright: set `PLAYWRIGHT_BROWSERS_PATH` to where it's installed (e.g. `/opt/pw-browsers`), or run
   `npx playwright install chromium`.

## Run (from the repo root, so `playwright` resolves from `node_modules/`)

```bash
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers SHOTS_DIR=/tmp/shots node browser-tests/import-ui.mjs
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers SHOTS_DIR=/tmp/shots node browser-tests/customer-display.mjs
```

Each script prints a `✅ … N passed, M failed` summary and exits non-zero on failure, so they slot into CI.

## Env overrides

`APP_URL` (import-ui, default `http://localhost:5173`), `API_URL` + `DISPLAY_URL` (customer-display, defaults
`http://localhost:3000` / `http://localhost:5180`), `SHOTS_DIR` (default `/tmp/shots`), and
`LOGIN_CODE` / `LOGIN_USER` / `LOGIN_PASS` (default `LUXE` / `owner@luxenails.test` / `Owner123!`).

## Notes / gotchas baked into the scripts

- SPA routes are **root-level** (`/customers`), while `/pos/*` is the proxied API namespace — so the import script
  navigates **client-side** (clicks the nav link) rather than hard-loading `/pos/customers` (which would hit the API JSON).
- The customer display uses **SSE + polling**, so it waits on `domcontentloaded`, never `networkidle` (which never settles).
- Two benign pre-login `401` auth-checks are filtered out of the "no JS errors" assertion.
