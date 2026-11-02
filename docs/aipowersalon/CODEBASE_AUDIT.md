# CODEBASE AUDIT — AI PowerSalon (Phase 0)

Existing codebase = the AIPowerSalon monorepo (npm workspaces, `apps/*`). The build package (`AI_PowerSalon_Claude_Build_Package`) is a **spec/reference package only** (44 images + manifest + master prompt); it contains no code. This is an upgrade-in-place of the monorepo, not a rebuild.

## Stack
- Monorepo: npm workspaces, root `aipowersalon-pos`, workspaces `apps/*`. Node 22 / npm 10.
- Backend `apps/api`: NestJS + Kysely + Postgres 16. TypeScript throughout, integer-cents money.
- Frontends: React + Vite (TypeScript). Tailwind-free hand-rolled design system (cream/gold tokens).
- Tests: vitest per workspace + a Nest-free core-spec harness (`scripts/run-core-specs.sh`).

## Backend inventory (measured)
- 68 module dirs, 90 controllers, **834 HTTP routes**, 73 services, 44 Kysely repositories.
- Migrations: 112 files, highest `111_drop_duplicate_indexes.sql`; ~180 CREATE TABLE statements; ~140 canonical tables in `kysely.types.ts`.
- Tenancy/RBAC: `common/guards/tenant-auth.guard.ts`, `role-permission.guard.ts`, `super-admin.guard.ts`; `scoped()` Kysely helper enforces tenant/branch filtering; 113 role/permission references; roles incl. SUPER_ADMIN / TENANT_OWNER / MANAGER / RECEPTION / TECHNICIAN / CUSTOMER / SUPPORT.
- Realtime: SSE controllers (`customer/customer-realtime.controller.ts`, `tech/tech-realtime.controller.ts`), `push`, `realtime` namespaces; ~330 event-emit points.
- Route namespaces (controller prefixes): `/pos` (35), `/super-admin` (16), `/customer` (13), `/tech` (6), `/auth` (5), `/tenant` (4), `/owner` (3), plus `/webhooks`, `/platform`, `/ai`, `/jobs`, `/health`, `/customer-display`, `/go-check-in`, `/realtime`, `/push`, `/internal`, `/public`.

## Frontend inventory (measured)
| App | Role | Screens | Shell / sidebar | Maps to refs |
|---|---|---|---|---|
| pos-web | **Tenant POS / Owner-Manager console (CANONICAL for T01–T21)** | 29 | `src/shell/tenant-nav.tsx` (data-driven, T01 IA) + `POSLayout.tsx` | T01–T21 |
| admin-web | **Super Admin platform (CANONICAL for S01–S23)** | 28 | `src/shell/AdminLayout.tsx` (iPad SA shell; **older sidebar IA — must reshape to S01**) | S01–S23 + 5 pictureless |
| owner-web | Owner/manager mobile companion | 20 | `src/shell/OwnerLayout.tsx` | overlaps T-codes → reconcile, do not duplicate |
| tech-web | Technician app | 17 | `TechLayout.tsx` | not in 44 refs (backend consumer) |
| customer-web | Customer app | 54 | `CustomerLayout.tsx` | not in 44 refs (backend consumer) |
| customer-display | In-salon display device | device | — | not in 44 refs |

## Baseline (run this session, Phase 0)
- api: tsc clean · **104 files / 690 vitest pass**.
- Frontends (run this session): pos-web 94, admin-web 168, owner-web 85, tech-web 74, customer-web 136, customer-display 30 — all tsc clean, all builds pass.
- Core specs: 41 harness suites, 0 failed.
- **Total: 1,277 workspace tests green, 0 typecheck errors, 0 pre-existing failures.**

## Canonical-app decisions
1. **Tenant/Owner-Manager console = `apps/pos-web`.** Its `tenant-nav.tsx` already encodes the T01 sidebar (Overview→Checkout + grouped sections). All T01–T21 target pos-web.
2. **Super Admin = `apps/admin-web`.** Its `AdminLayout` is the SA shell, but the sidebar IA is an older structure and must be reshaped to the S01 order (Overview/Dashboard/Analytics → OPERATION / BUSINESS / AI & AUTOMATION / SYSTEM SETTINGS). All S01–S23 + 5 pictureless target admin-web.
3. **owner-web** overlaps the tenant owner-manager domain; its unique finance/branch/staff views reconcile into pos-web's Analytics/Reports/Management or remain a thin mobile companion — never duplicated.
4. tech-web / customer-web / customer-display are out of scope for the 44 refs and stay as backend consumers.
