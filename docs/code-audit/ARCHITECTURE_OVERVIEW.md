# ARCHITECTURE_OVERVIEW

_Phase 0 discovery. All figures below were measured from the live tree at `/home/claude/merged` on this pass, not assumed._

## What this codebase is
AIPowerSalon — a multi-tenant nail-salon POS SaaS. It is a **single, connected monorepo**, not a set of disconnected prototypes. npm workspaces (`apps/*`), one NestJS/Kysely/Postgres backend serving all clients.

## Stack
- **Backend** (`apps/api`, `@aipowersalon/api`): NestJS + Kysely query builder + PostgreSQL 16. 688 source files, 70 Nest modules, 90 controllers, 73 services, 44 Kysely repositories, **834 HTTP routes**.
- **Frontends** (React + Vite + TypeScript): `pos-web` (tenant POS, 75 tsx), `admin-web` (super-admin, 65), `owner-web` (58/45), `tech-web` (41), `customer-web` (100), `customer-display` (device screen, 4). Each frontend has exactly **one** API client module — no duplicate clients.
- **Kiosk**: `go-check-in-kiosk` (Go) + `go-check-in-admin` (static/admin).
- **DB**: 112 idempotent plain-SQL migrations (highest `111_*`), applied by sorted filename; **180 tables**. Money is integer cents everywhere.
- **Tests**: 99 vitest specs + 38 Nest-free core specs in the api; per-frontend vitest suites.

## Cross-cutting systems
- **Tenancy**: `TenantContextMiddleware` resolves tenant/branch from authenticated server-side context (clients are *not* trusted to supply an unrestricted `tenantId`). Row scoping via a `scoped()` Kysely helper used at **248 call sites**.
- **Payments**: **Fiserv (CardPointe / CardPointe-Bolt) + Clover only.** Stripe and Square were deliberately removed and must never be re-added. The only `stripe` strings in the tree are the AI-billing **webhook signature scheme name** ("stripe-style" `t=,v1=` HMAC) — a verification format, not a processor; it must stay.
- **Real-time**: one server-side SSE push bus (`apps/api/src/realtime`, 7 files), tenant/branch-scoped.
- **AI**: a central AI gateway with package pricing, overage billing, usage/cost tracking, and provider adapters.
- **Design**: cream/gold theme (page `#F7EFE3`, gold `#A96F22`, Playfair Display + Hanken Grotesque), Mac-fit fixed shell for POS (fits 1440×900 min, 1920×1080), iPad-responsive super-admin.

## Prior documentation
The repo root already carries **213 `.md` reports** plus `docs/` (32 files) from prior build/audit sessions (e.g. `FULL_CODEBASE_AUDIT.md`, `MERGE_REPORT.md`, `DUPLICATE_CODE_RESOLUTION.md`, `TENANT_ISOLATION_TEST_REPORT.md`, `PAYMENT_SECURITY_REPORT.md`, `FIXES_APPLIED_VERIFIED.md`). This Phase-0 set consolidates and re-verifies them rather than duplicating their detail.
