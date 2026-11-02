# PROJECT_OVERVIEW.md

High-level orientation for AIPowerSalon. For deeper architecture/model detail see `PROJECT_HANDOFF.md`; for the API↔UI wiring see `FRONTEND_BACKEND_CONNECTION_MAP.md`; for how this tree was assembled see `CHANGELOG_MERGE.md`.

## Purpose
AIPowerSalon is a **multi-tenant nail-salon POS and salon-management SaaS**. Each salon tenant runs reception POS, technician and owner tools, customer-facing booking/check-in, and a back-office, all over one API and one database, isolated per tenant.

## Architecture (one full-stack monorepo)
npm **workspaces** monorepo (`apps/*`, `packages/*`). One NestJS API + eight React/Vite frontends, one Postgres database. Safari-first (iPad/iMac primary), compact enterprise dashboard layout (no body scroll on operating screens).

## Applications (`apps/`)
| App | Package | Role |
|---|---|---|
| `api` | `@aipowersalon/api` | NestJS backend — all controllers, services, migrations, jobs, webhooks |
| `pos-web` | `aipowersalon-pos-web` | Reception POS (check-in → queue → serving → checkout) |
| `admin-web` | `aipowersalon-admin-web` | Super Admin / platform oversight |
| `owner-web` | `aipowersalon-owner-web` | Salon-owner / multi-branch portal |
| `tech-web` | `aipowersalon-tech-web` | Technician app |
| `customer-web` | `aipowersalon-customer-web` | Customer app (booking, favorites, history) |
| `customer-display` | — | Customer-facing display |
| `go-check-in-kiosk` | — | Self check-in kiosk |
| `go-check-in-admin` | — | Kiosk administration |

## Technology stack
- **Backend:** NestJS, **Kysely** query builder, **Postgres 16**. SQL migrations under `apps/api/db/migrations/` run by `apps/api/scripts/migrate.mjs`.
- **Frontend:** React + **Vite** + TypeScript per app; typed API clients in `src/api/`.
- **Tests:** vitest (frontends + API unit) + a DB-free **harness** (`apps/api/scripts/run-core-specs.sh`, `*-core.spec.ts`).
- **Native wrappers:** Capacitor (iOS/Android) for the mobile apps.

## Database
Single canonical schema, **133 ordered SQL migrations** (`000 … 132`). Money is stored as **integer cents**. Migrations are append-only and never destructive without explicit documentation. Core entities: tenants, locations/branches, users, roles/permissions, customers, technicians, appointments, visits, queue entries, tickets + ticket items, services, products, inventory, payments/tips/discounts/taxes/surcharges, loyalty, messages/notifications, devices/integrations, audit logs.

## Authentication & authorization
Session-based auth (`auth/*` controllers: login, logout, session restore, MFA, password reset). Every protected handler is annotated `@RequirePermission('<scope>.<area>.<action>')` and resolves identity server-side via `ctxFrom(req)`. Hiding a UI control is never the security boundary — the API re-checks every sensitive action. (Granular RBAC beyond the binary `SuperAdminGuard` remains deferred pending `/auth/me` session-gating — see `KNOWN_ISSUES.md`.)

## Multi-tenancy (critical)
Tenant identity is derived from the authenticated session, **never** from a browser-supplied id. Every tenant-scoped query is filtered through Kysely `scoped()`. Super-Admin oversight aggregates are **read-only platform-wide**; any mutation is session-gated and written to the audit log. **§3 layered protection:** global/template edits must never silently overwrite tenant prices, costs, suppliers, branch stock, or local taxonomy.

## Payments
Per-tenant merchant account + MID. **Fiserv (CardPointe/Bolt) and Clover only** — Stripe and Square are permanently removed and must never return. (One AI-billing webhook references a "stripe-style" *signature scheme name* only — not a processor — and must stay.) No raw card/CVV stored or logged; tokenized methods; idempotent capture; signed, idempotent webhooks; over-refund and duplicate-charge guards.

## AI
All AI-provider access goes through a **backend AI Gateway** (`ai/*`). No provider secret in frontend code; the provider never touches the database directly; requests are authenticated, tenant-scoped, usage/cost-tracked, and limit-enforced.

## Communications
Twilio (SMS / A2P 10DLC), SendGrid (email), FCM (push) — each tenant/location uses its assigned configuration. Inbound webhooks are signature-validated server-side; no comms credentials in frontend code.

## Deployment
Vite static builds per frontend; the API builds to `apps/api/dist` (`npm run build:api`, `start:api`). Environment is driven by `.env.example` (+ `.env.{development,local,production}.example`). See `RUNBOOK.md` for install/migrate/run/build/troubleshoot steps.

## Current state
Merged tree is **green**: API `tsc` 0; 7 app typechecks 0; 57 harness suites + 1,189 vitest tests passing; 3 production builds clean. Standing gap: no live Postgres in this environment, so the 7 newest migrations are verified by typecheck + harness + mocks only — live smoke (`npm run db:up && npm run db:setup`) is the top next task.
