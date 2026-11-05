# Full Codebase Audit — AIPowerSalon

Date: 2026-06-16. Reflects a live scan + full build/test run on the current tree.

## Structure (npm workspaces monorepo)
```
aipowersalon-pos/
  apps/
    api/                NestJS + Kysely + Postgres 16 backend (373 TS source files, 75 controllers)
    pos-web/            Front-desk POS — runs in Safari on a Mac (React + Vite, react-router)   [WEB]
    admin-web/          Super Admin console — Safari on iPad Pro 13in (React + Vite)            [WEB]
    customer-web/       Customer app (React + Vite)                                            [iOS + Android]
    owner-web/          Owner app (React + Vite, state-machine nav)                            [iOS + Android]
    tech-web/           Technician app (React + Vite, state-machine nav)                       [iOS + Android]
    customer-display/   Check-in / customer display (React + Vite)                             [iOS + Android]
    go-check-in-kiosk/  iPad check-in kiosk (static)                                           [iOS + Android]
    go-check-in-admin/  Kiosk config page (static)                                             [WEB]
  apps/api/db/migrations/   86 SQL migrations (001..085), idempotent, tracked via schema_migrations
  scripts/                  run-core-specs.sh, etc.
  package.json (workspaces), package-lock.json, tsconfig.json, eslint.config.mjs, Dockerfile, docker-compose.yml
```

## Deployment posture (decided)
- **pos-web** and **admin-web** are served as static web apps (opened in Safari). Their Capacitor native shells were
  removed — POS runs on a Mac, Super Admin on an iPad Pro 13in. admin-web is sized for that device (fluid 240px sidebar +
  fluid main, `100dvh`, 44px touch targets, portrait sidebar-collapse).
- **customer-web, owner-web, tech-web, customer-display, go-check-in-kiosk** are native **iOS + Android** apps
  (Capacitor 8, Swift Package Manager on iOS). Each has `ios/` + `android/` projects, synced web assets, and icons.
- **apps/api** is the single backend; everything (web apps, native apps, the website form) talks to it.

## What exists (all present and wired)
- Backend route families: `/auth`, `/pos/*`, `/owner`, `/tech/*`, `/customer/*`, `/super-admin/*`,
  `/public/website`, `/customer-display`, `/realtime`, `/webhooks/payments`, `/health`.
- **Multi-tenancy (application-level, not Postgres RLS)** — tenant scope is derived **server-side** by
  `TenantContextMiddleware` from the authenticated session; a client-supplied `tenantId`/`branchId` is sanitized out and
  can never be used downstream. 48 repositories filter every query by `tenant_id` (72 tenant-scoped tables).
  Behavior-verified fail-closed (A sees A, B sees B, no-tenant sees nothing); a live two-tenant proof confirmed no
  cross-tenant leak.
- **Payments** — Fiserv CardPointe adapter (decimal-dollar amounts, PUT verbs, HTTP Basic auth) behind a gateway;
  sandbox processor for local. Money is integer cents throughout; tax + card surcharge resolved from settings
  (branch → tenant → safe default) by one shared resolver so POS and customer-display never diverge.
- **Realtime** — SSE push bus (`/realtime`) + per-surface controllers (owner/tech/customer); POS surfaces (check-in,
  booking, queue, settings) push over the same bus.
- **Website intake** — `POST /public/website/applications` and `/leads` (unauthenticated, honeypot + per-IP rate
  limit) feed Super Admin → Tenant Applications, with the marketing form fully wired (CORS configured).
- **Design system** — cream/gold tokens, Mac-fit fixed-shell layout rule across screens.

## Audit findings (this pass)
| Area | Finding |
|---|---|
| Builds | All apps build clean; API `tsc` clean. |
| Typecheck | `npm run typecheck` clean. |
| Lint | **0 errors** (8 cosmetic errors fixed this pass), 63 benign unused-var warnings. |
| FE ↔ BE wiring | Frontend API calls resolve to real controllers; no disconnects found. |
| Nav ↔ screens | router (pos/admin) + state-machine (owner/tech) nav resolve to real screens; no dead links. |
| Mock/demo data in production | None — provider Mocks are fallbacks only; in-memory seed not used in production (Postgres repo). |
| Hardcoded dev URLs | None in source — API origin is env-driven (`VITE_API_BASE` / `window.APS_API_BASE`). |
| Money-path | End-to-end reviewed (cash, card, PCI posture, wallet, billing). One real double-charge bug found + fixed (see BUG_FIX_REPORT.md). |

## Tests present
- Backend: core-spec harness (234 markers) + **451** vitest; e2e journeys + tenant-isolation; money-path + intake suites.
- Frontend: per-app vitest (jsdom) totalling **267**, including smoke suites mounting every screen.

Conclusion: the codebase is **complete, internally connected, and healthy** — no broken wiring, no orphaned calls, no
significant unbuilt core module. Remaining items are operational/credential (deploy, processor MID, comms keys, store enrollment).
