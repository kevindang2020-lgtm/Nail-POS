# README-FIRST — AIPowerSalon (the real, data-backed system)

> **Oct 10 2026:** the current developer entry point is `START-HERE.md` (build, run, test, deploy, doc map, Kevin's actions). Figures in this file (controller / route / migration counts) are from its original writing (e.g. "42 migrations"); current counts: `API_INVENTORY.md` (generated) and `apps/api/db/migrations`.

**This package is the real, data-backed AIPowerSalon platform** — a NestJS backend on PostgreSQL with the POS and
Super Admin web apps. It is not a front-end demo. Real authentication, real database persistence, server-side
tenant/branch isolation, the full booking→checkout workflow, per-tenant payments, reports, and settings all run here.

## About the "Front-end demo" disclaimer
That banner appears **only** in two optional standalone files — `AIPowerSalon-POS.html` and
`AIPowerSalon-SuperAdmin.html` — which exist purely for a no-setup visual click-through. They are **not** part of this
application and are not the deliverable. This repository contains **zero** mock-mode code: there is no `isDemo`,
`useMockData`, `mockApi`, or `localStorage` persistence anywhere in `apps/*/src`. Data lives in PostgreSQL.

To be safe, the API now **refuses to start in production** if it isn't pointed at a real database — see the guard in
`apps/api/src/main.ts` (verified: `NODE_ENV=production` with no `REPO_DRIVER`/`DATABASE_URL`/`AUTH_SESSION_SECRET`
exits with a clear FATAL message). It can never silently fall back to in-memory data in production.

## Run it (real backend + real database)
Prerequisites: Docker Desktop, Node 20+ (tested on 22). From this folder:
```bash
bash scripts/local/setup.sh     # deps, Postgres (docker), 42 migrations, seed admin+pilot tenant, demo data, build API
bash scripts/local/dev.sh       # API :3000 + all 4 web apps (POS :5173, Super Admin :5174, Technician :5175, Customer :5176); Ctrl-C stops all
```
- **POS** http://localhost:5173 — Owner: salon `PILOT01`, `owner@pilotsalon.com` / `ChangeMe!Owner1`
- **Super Admin** http://localhost:5174 — `admin@aipowersalon.com` / `ChangeMe!SuperAdmin1` + any 6-digit MFA code (local / non-production only: with `NODE_ENV=production` or `MFA_REQUIRE_TOTP=1` a user with no enrolled authenticator cannot pass MFA with a bare 6-digit code — `packages/auth/src/security.ts` `requireRealTotpEnrollment`; corrected Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep))
- **Technician** http://localhost:5175 — salon `PILOT01`, `tech@pilotsalon.com` / `Tech!2345`
- **Customer** http://localhost:5176 — salon `PILOT01`, `customer@pilotsalon.com` / `Cust!2345` (linked to a demo customer; Home + Appointments show real data)

`RUN_LOCAL.md` has the full per-task testing checklist, reset/reseed, and manual steps.

## Proof it's data-backed (see RUN_LOCAL_EXECUTION_REPORT.md)
On a fresh DB, logging in as OWNER and `POST /pos/customers` increased the Postgres `customers` count 5→6, with the
new row's tenant/branch set **server-side**, and `GET /pos/customers` read it back. Full test suite: **208 passed**.

## Accounts & role redirects (backend-enforced)
`SUPER_ADMIN` → Super Admin console · `OWNER`/`MANAGER`/`FRONT_DESK`/`RECEPTION` → POS · `TECHNICIAN` → tech app ·
`CUSTOMER` → customer app. Each user has their own account; the OWNER signs in with the tenant (salon) code.

## Where the rest of the documentation is
- `RUN_LOCAL.md` — how to run + per-task testing checklist
- `RUN_LOCAL_EXECUTION_REPORT.md` — commands executed + real results + the persistence proof
- `FULL_SYSTEM_AUDIT.md` — repository map, feature-status matrix, tenant-isolation audit, build/test, remaining blockers
- `PAYMENT_GATEWAY_AUDIT.md` — per-tenant payment isolation (Doc A) acceptance coverage
- `DOC2_POS_INTEGRATION_AUDIT.md` — sidebar route map + click/modal/action audit (Doc B)
- `COMPLETION_STATUS.md` — per-spec completion status
- `.env.production.example` / `.env.development.example` — required env vars per environment

## Honest remaining blockers
- Live processor sandbox round-trips need `CARDPOINTE_*` (or Stripe/Square/Clover) credentials; `PAYMENTS_SANDBOX=1`
  gives simulated card flows meanwhile.
- Exhaustive in-browser modal QA across viewports needs a desktop browser.
- tech-web / customer-web / native apps share this backend + API client but aren't part of the local boot scripts.
