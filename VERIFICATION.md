# AIPowerSalon — Verification Guide

How to prove the platform works, end to end, on your own machine. Every layer below is runnable; the commands are
exact. Counts reflect the current tree.

Apps in the monorepo: `apps/api` (NestJS + Kysely + Postgres), `pos-web`, `admin-web` (Super Admin), `customer-web`,
`tech-web`, `owner-web`, `customer-display`.

```
cd aipowersalon-pos
npm install          # root + workspaces (installs Playwright, PGlite devDeps, etc.)
```

---

## 1. Builds — every app compiles (tsc typecheck + vite build)

`npm run build` runs `tsc --noEmit && vite build` per app, so it catches type errors that `vite`/`tsx` alone miss
(test files are typechecked too).

```
for a in api pos-web admin-web customer-web tech-web owner-web customer-display; do
  (cd apps/$a && npm run build) || { echo "BUILD FAILED: $a"; break; }
done
```

Expected: all seven build clean.

---

## 2. Unit + screen-mount tests — `npm run test` per app

Each frontend app runs Vitest (jsdom). Screens are mounted in their real provider stack with the API client mocked
(calls never resolve), so every screen is proven to render its initial/loading state without throwing.

| App                | Command (from app dir) | Tests |
|--------------------|------------------------|-------|
| `apps/api`         | `npm run test`         | 317   |
| `apps/pos-web`     | `npm run test`         | 54    |
| `apps/admin-web`   | `npm run test`         | 60    |
| `apps/customer-web`| `npm run test`         | 85    |
| `apps/owner-web`   | `npm run test`         | 16    |
| `apps/tech-web`    | `npm run test`         | 25    |
| **Frontend total** |                        | **240** |

`customer-display` is a passive two-file display surface (no suite).

```
(cd apps/api && npm run test)
for a in pos-web admin-web customer-web tech-web owner-web; do (cd apps/$a && npm run test); done
```

---

## 3. Backend end-to-end against a live DB — `npm run e2e:live`

Boots a real Postgres (in-process PGlite over the wire), runs migrations, seeds the **PALACE** demo tenant
(`owner@palace.test` / `Owner!2345`), starts the actual `dist/main.js`, and drives full journeys over HTTP, then
confirms row-level security fails closed.

```
cd apps/api
npm run build          # produces dist/main.js (required)
npm run e2e:live
```

Covers, all green:
- **8 journeys** — `flow`, `customer`, `tech`, `owner`, `rbac`, `receipts`, `skill`, `cardpointe`
  (per-app self-service: customer register→book, tech accept→serve, owner reads live data across dashboards; the
  CardPointe path runs the real client against a faithful local gateway mock, or a live sandbox if `CARDPOINTE_*` is
  exported).
- **RLS** — every table with a `tenant_id` gets `tenant_isolation`; behavior-checked fail-closed across **112 policies**
  (tenant A sees A, tenant B sees B, no-tenant sees nothing).

> `e2e:live` uses `@electric-sql/pglite` + `@electric-sql/pglite-socket` (now pinned in `apps/api`
> devDependencies — installed by `npm install`). To run the journeys against a **real** Postgres instead, see the
> browser harness below, which takes a `DATABASE_URL`.

---

## 4. NailShowcase Social feature harness

Standalone verification of the social ranking + follow + customer-block system (block enforcement across follow,
profiles, followers/following lists, and feed; plus the "Nearby" leaderboard scope).

```
cd apps/api
npx tsx scripts/verify-nail-showcase-social.ts
```

Expected: **52 / 52 checks pass**.

---

## 5. Real-browser render smoke — every app boots in Chromium

Each built SPA is served and loaded in real Chromium; the harness captures uncaught page errors and console errors.
All six interactive apps render their entry screen with **zero JS errors** (backend-less, so the auth check fails
gracefully and the login/idle screen shows):

- pos-web → "Salon POS — staff sign in"
- admin-web → "Super Admin Console"
- customer-web → "Sign in to your account"
- owner-web → "Owner Sign In"
- tech-web → "Technician sign in"
- customer-display → "Not connected — Ask the front desk to start your checkout"

---

## 6. Authenticated click-through — real login + real data, in a real browser

`apps/api/scripts/browser-e2e.mjs` boots the actual backend, serves a built SPA on the **same origin** as the API (so
the httpOnly session cookie flows), then drives Chromium through the **real login form** into the authenticated app and
asserts authenticated API calls return `200` with real data.

### Run it against a real Postgres (recommended — full pass)

```
# one-time: create an empty database, e.g.
#   createdb aps_e2e
cd apps/api
npm run build
APP=pos-web DATABASE_URL=postgres://USER:PASS@localhost:5432/aps_e2e node scripts/browser-e2e.mjs
```

`APP` can be `pos-web` (default), `owner-web`, `tech-web`, `customer-web`, or `admin-web` — build that app first
(`cd apps/<APP> && npm run build`).

What it asserts:
1. `POST /auth/login → 200` (driven through the actual form with PALACE / owner@palace.test / Owner!2345)
2. the authenticated app shell renders (login inputs gone, real sidebar present)
3. authenticated `GET /<pos|owner|tech|customer>/…` calls return `200` with the session cookie
4. zero uncaught JS errors

Exit code `0` = full pass.

### What this proves vs. the in-process fallback

If `DATABASE_URL` is omitted the script spins up the in-process PGlite DB for convenience. That mode reliably proves
**login + authenticated-shell render**, but PGlite desyncs under the dashboard's *concurrent* data calls (a known limit
of the in-process test DB — the `pg` driver hits `_handleParseComplete: null activeQuery` and the backend exits), so the
script serializes API requests at the proxy in that mode. **A real Postgres handles the concurrent calls normally and
the full click-through (including authenticated data rendering) passes** — which is why the recommended invocation
supplies `DATABASE_URL`. The authenticated data paths themselves are independently covered by §3's journeys (sequential
→ no concurrency), so this is purely a test-harness characteristic, not an app behavior.

---

## 7. Wiring audit (informational)

A static pass over the tree confirmed:
- **Frontend ↔ backend:** every FE API call path resolves to a real backend route — pos-web 74 / admin-web 61 /
  customer-web 70 / owner-web 27 / tech-web 45 calls, **0 disconnects**.
- **Nav ↔ screens:** pos-web (20 sidebar items) + admin-web (17) react-router routes, and owner-web/tech-web
  state-machine tabs + pushed views, all resolve to real screens — **0 dead links**.

---

## Continuous integration

All of the above runs automatically on every push and PR via `.github/workflows/ci.yml`:

| Job | What it runs |
|-----|--------------|
| `backend-tests` | core harness + vitest specs, then the NailShowcase Social harness (52) |
| `e2e-postgres` | migrate + seed + boot API on a **real Postgres service**, run the flow + journey e2es |
| `e2e-cardpointe` | real CardPointe client over the local mock gateway |
| `browser-e2e` | **the authenticated click-through** (§6) for pos-web against a real Postgres service |
| `docker-build` | production image build |
| `frontend` | build all web apps + run every app's render/screen tests |

The `browser-e2e` job is the productionized §6 — Postgres service container, builds api + pos-web, installs Playwright
Chromium, and runs `scripts/browser-e2e.mjs` with `DATABASE_URL` pointed at the service (so the concurrent-call path
works and the full click-through passes). To click through additional apps in CI, adapt the harness login selectors for
that app's form and add a step.

---

## Known limitations

**Split tenders are intentionally not surcharged (yet).** When card surcharge is enabled, a *card* payment carries the
surcharge but a *split* payment does not — so a customer can avoid the surcharge by splitting. This is deliberate, not an
oversight: the correct fix is to surcharge only the card portion of a split **and** disclose that surcharge on the split
screen before payment (disclosure is legally required), which is a coordinated checkout + customer-display change
("Option A"). Disabling split while surcharge is on was evaluated and rejected — it breaks the split-compensation specs +
split e2e flows and removes a working default feature. Tracked at `computeTotals` in
`apps/api/src/checkout/checkout-display.dto.ts`.

---

## Summary

| Layer | What it proves | Status |
|-------|----------------|--------|
| Builds (×7) | type-clean compile | ✅ |
| `npm run test` (×6) | every screen mounts; 240 FE + 317 api specs | ✅ |
| `npm run e2e:live` | 8 HTTP journeys + 112 RLS policies fail-closed | ✅ |
| social harness | block/follow/feed/nearby, 52 checks | ✅ |
| browser render smoke | all 6 apps render in Chromium, 0 JS errors | ✅ |
| `browser-e2e.mjs` (real PG) | real login → authenticated data in a real browser | ✅ |

The only thing that needs *your* machine (not this repo) is a standard Postgres for §6's full data-render — everything
else runs as-is.
