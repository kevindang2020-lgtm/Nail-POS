# CODEBASE INVENTORY — AIPowerSalon (full build to date)

A deep scan of the complete `aipowersalon-pos` monorepo as it stands today. This is the entire, data-backed
multi-tenant nail-salon POS platform — backend, four front-ends, database schema, tests, and tooling.

## At a glance

| Metric | Count |
|---|---|
| Applications (npm workspaces) | **5** (api + 4 web apps) |
| Total source lines (TypeScript/TSX) | **~32,500** (≈27,600 excl. tests) |
| Backend feature modules | **34** |
| Backend HTTP routes (`@Get/@Post/@Patch/@Delete`) | **394** |
| Backend controllers / services / repositories / Nest modules | 34 / 34 / 48 / 34 |
| Database migrations | **42** (001–041) |
| Database tables (after all migrations) | **87** |
| Automated tests (Vitest) | **215 passing** (53 spec files) |
| Live-Postgres verification probes | **17** |
| Build status | API + both shipped web apps compile clean (`tsc` + `vite build` exit 0) |

## Applications

| App | Path | Role | Source |
|---|---|---|---|
| **API** (authoritative backend) | `apps/api` | NestJS 10 + Kysely + PostgreSQL | 277 files, ~25,500 LOC |
| **POS** | `apps/pos-web` | Front-desk POS (React + Vite) — 16 sidebar screens | 65 files, ~4,800 LOC, 21 API clients |
| **Super Admin** | `apps/admin-web` | Platform console (React + Vite) | 6 screens, 4 API clients |
| **Technician app** | `apps/tech-web` | Login, Dashboard, Schedule, Earnings | 4 screens, 4 API clients |
| **Customer app** | `apps/customer-web` | Home, Book, Appointments, Visit, Receipts, Profile, Login | 7 screens, 4 API clients |

## Backend modules (34)
auth · session · booking · customer-booking · check-in · queue · tech-queue · serving · service-done · checkout ·
payments · customers · technicians · services · tech · tech-appointments · live-technician-schedule · dashboard ·
overview · reports · settings · workflow · realtime · health · common · database · pos · project-status ·
pos-project-status · super-admin-tenants · super-admin-dashboard · super-admin-billing · super-admin-health

## Database (87 tables, 42 migrations)
Money stored as integer cents; tenant/branch scope derived server-side. Domains covered: users/roles/permissions,
tenants/branches/subscriptions, customers (+ loyalty, allergies, preferences, merges), technicians, services/categories,
appointments (+ waitlist, reschedules, holds), queue + tech-queue (+ audits), tickets + service lines, payments
(+ attempts, refunds, settlements, gateway events, terminals), gift cards, MFA/passkeys/login-attempts/reset-tokens,
customer-display devices/sessions, messaging/notifications, audit logs, and per-tenant payment config (AES-256-GCM).

## POS sidebar (16 canonical screens, all routed)
Overview · Dashboard · Check-In · Booking · Tech Appointments · Live Technician Schedule · Tech Queue · Queue ·
Serving · Service Done · Checkout · Customers · Technicians · Services · Reports · Settings

## Verified this build
- **215/215** Vitest tests pass (incl. 7 realtime push-bus tests); 17 live-Postgres probes green; migration 041 transaction-tested.
- **Real persistence**: `POST /pos/customers` via the authenticated API added a row to Postgres (5→6), read back via `GET`.
- **Money path end-to-end**: tenant-resolved gateway → sandbox card payment → ticket `paid` → refund → Reports reflect stored transactions.
- **Production guard**: API refuses to start in production without a real database (no silent in-memory fallback).
- **Full ticket lifecycle** through the real API: serving → service_done → (quality-approved) → ready_checkout → paid, with the quality gate enforced and a refund — every transition confirmed in Postgres.
- **All four web apps build clean** and launch together via `scripts/local/dev.sh`. Both a `TECHNICIAN` login (`tech@pilotsalon.com`) and a `CUSTOMER` login (`customer@pilotsalon.com`, linked to a demo customer) are seeded and verified through `/auth/login` — all four apps are sign-in-testable against seeded data.
- All defects found along the way were fixed (per-tenant payment isolation, 20+ money/auth/isolation bugs, legacy-table sweep, a reports RBAC bug). See `PAYMENT_GATEWAY_AUDIT.md`, `FULL_SYSTEM_AUDIT.md`, `RUN_LOCAL_EXECUTION_REPORT.md`.

## How to run it
See `README-FIRST.md` (start here) and `RUN_LOCAL.md`. In short, from `aipowersalon-pos/`:
`bash scripts/local/setup.sh` then `bash scripts/local/dev.sh` → launches the API plus **all four** web apps:
POS http://localhost:5173, Super Admin http://localhost:5174, Technician http://localhost:5175, Customer http://localhost:5176.

## What's included in the package
Full source for all 5 apps, all 42 migrations, all tests, the 17 probes, seed + demo-data scripts, Docker Compose,
run scripts, environment examples, and the full documentation set. Excluded: `node_modules`, build output, and secrets.

## Honest remaining blockers
Live processor sandbox round-trips need real `CARDPOINTE_*`/Stripe/Square/Clover credentials; exhaustive in-browser
modal QA across viewports needs a desktop browser. The realtime push bus (SSE) is implemented and proven end-to-end server-side; live in-browser EventSource refetch still needs a desktop browser to QA.
The customer app's Receipts tab is empty until a real checkout writes a receipt for the linked customer (expected).
