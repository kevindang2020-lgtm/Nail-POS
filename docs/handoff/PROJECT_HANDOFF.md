# PROJECT_HANDOFF.md

## Project purpose
AIPowerSalon is a multi-tenant nail-salon POS and salon-management SaaS (AI PowerSalon LLC, aipowersalon.com). Initial market: United States; intended scale ≥ 1,000 salons. It covers the full salon workflow — booking/walk-in → check-in → queue → technician assignment → serving → service done → checkout → payment → receipt → loyalty → reports — plus a platform-level Super Admin for tenant oversight, payments/merchant onboarding, analytics, system health, devices, security/compliance, and audit.

## Current development status
**Working with documented limitations.** All static analysis, unit/harness, and build gates pass (see `TEST_REPORT.md`). The standing limitation is that this build environment has no live Postgres, so transactional behavior of new SQL is verified by typecheck + DB-free harness + mocked front-end only and needs a live-PG smoke before production reliance.

## Applications and services
npm-workspaces monorepo (`workspaces: ["apps/*","packages/*"]`):

| App | Stack | Source files | Role |
|---|---|---|---|
| `apps/api` | NestJS + Kysely + Postgres 16 | ~757 ts | Backend/API, tenant isolation, payments, AI gateway, all aggregates |
| `apps/pos-web` | React + Vite | ~157 tsx | Tenant reception POS (iMac/Safari-first) |
| `apps/admin-web` | React + Vite | ~125 tsx | Super Admin platform console |
| `apps/customer-web` | React + Vite | ~120 tsx | Customer app |
| `apps/owner-web` | React + Vite | ~58 tsx | Tenant owner/multi-salon app |
| `apps/tech-web` | React + Vite | ~58 tsx | Technician app |
| `apps/customer-display` | React + Vite | ~15 tsx | Customer-facing display |
| `apps/go-check-in-kiosk` / `go-check-in-admin` | React/Vite | small | Check-in kiosk + admin |
| `packages/ui` | shared | — | Shared UI/design tokens |

## Technology stack
- **Backend:** NestJS (TypeScript), Kysely query builder, raw `sql\`...\`` for aggregates, Postgres 16.
- **Frontends:** React + Vite + TypeScript; Vitest + Testing Library; Tailwind-style utility classes / centralized tokens (cream/gold palette, Playfair Display + Hanken Grotesque).
- **Native wrappers:** Capacitor (iOS/Android) for applicable apps.
- **Payments:** Fiserv CardPointe/Bolt + Clover only.
- **Comms/AI:** Twilio (SMS/voice/caller-ID), SendGrid (email), FCM (push); OpenAI behind a centralized backend AI Gateway.

## How applications communicate
Frontends call the NestJS API over HTTP (`/super-admin/...`, tenant POS endpoints, etc.). The API resolves tenant/identity from the authenticated session cookie (`aps_session`), enforces RBAC + tenant scope server-side, and reads/writes Postgres via Kysely. Super Admin support access is session-gated through `support_access_sessions` and audited in `audit_logs`.

## Authentication & authorization
- Session-cookie auth (`AUTH_SESSION_SECRET` signs `aps_session`).
- Super Admin authority is currently a binary `SuperAdminGuard`; granular RBAC (`platform.*`, `branches.*`) is **designed but deferred**, blocked on `/auth/me` session-gating.
- Tenant roles: SUPER_ADMIN, OWNER, MANAGER, FRONT_DESK, RECEPTION, TECHNICIAN, CUSTOMER. CUSTOMER can never be invited/assigned as an admin user.
- Sensitive actions: confirmation + reason + audit; MFA/step-up where designed (`MFA_PRODUCTION.md`).

## Multi-tenant model
Every tenant owns its branches, customers, staff, appointments, tickets, services, products, payments, devices, settings, and audit. Backend derives tenant from session; never trusts browser-supplied ids. Super Admin oversight aggregates are read-only platform-wide; mutations session-gated + audited. Negative isolation tests exist (`TENANT_ISOLATION_TEST_REPORT.md`).

## Database model summary
130 ordered SQL migrations in `apps/api/db/migrations/`. Core tables include `tenants`, `branches`, `users`, `appointments`, `tickets`, `ticket_service_lines`, `services`, `products`, `payments`, `sessions`/`refresh_tokens` (auth), `support_access_sessions`, `audit_logs`, plus owner multi-salon (`owner_branch_access`, `user_preferences`) and AI/billing/hardware tables. Money columns are integer cents; `surcharge_cents` is the canonical per-payment surcharge.

## Payment architecture
Per-tenant merchant account + MID; funds settle to each salon's bank via the approved processor. Fiserv CardPointe/Bolt + Clover only. No raw PAN/CVV stored or logged; tokenized methods; webhook signatures validated; idempotent webhook processing; idempotency keys on payment creation; refunds/voids/tips/surcharge tracked with advisory-lock race protection.

## AI Gateway architecture
All AI provider access goes through a centralized backend gateway: authenticates caller, resolves tenant/user, enforces AI plan + usage limits, retrieves only safe data via internal services, logs usage metadata + cost. Provider secrets are server-only.

## Twilio architecture
Per-tenant phone-number mapping, caller ID, SMS, appointment notifications, AI phone receptionist, secure webhook validation + tenant mapping. A2P 10DLC registration kit present.

## Deployment architecture
Dockerfile + docker-compose (local Postgres via `db:up`), `deploy/terraform`, App Runner-style env, `.github/workflows`. Frontends build via Vite; API builds via `tsc -p tsconfig.build.json` → `node apps/api/dist/main.js`.

## Current working features
Full money path (check-in → checkout → payment) with split-tender, surcharge, tip validation, refund/void race protection; pos-web Customer/Tech Queue 1:1 builds with KPIs/flow boards/Best-Match engine; Super Admin platform module with tenant oversight, payment-gateway state, privacy/merge engines, users-dashboard + Users&Roles gated mutation tier (invite, branch-access, role change, 2FA, invite lifecycle, session revocation), and a real `branchesDashboard` aggregate feeding `BranchesScreen`. Owner multi-salon, customer/tech apps, customer-display, marketing site.

## Incomplete / deferred features
Granular RBAC (blocked on `/auth/me`); real-time WebSocket/SSE for live-ops; branch capacity/utilization model, branch health score, performance-trend series (currently honest `null`); 12-step Add-New-Branch wizard; Global-Template→Tenant→Branch publishing layer. See `KNOWN_ISSUES.md` / `REMAINING_WORK_FOR_NEW_CHAT.md`.

## Important product rules
Audit-first/no-duplication; honest verification (no fabricated results); Fiserv/Clover only; integer cents; §3 layered protection; read-only oversight aggregates; session-gated+audited mutations; casino project is entirely separate.

## UI requirements
iMac/Safari-first POS at 100% zoom, no horizontal overflow, compact enterprise density; cream/gold tokens; Mac-fit shell (`html/body/.shell/.main` 100vh overflow:hidden; internal table scroll). iPad Pro 13" admin layouts validated.

## Next recommended tasks
See `NEXT_CHAT_START_HERE.md` → rename Dashboard→Live Operations (+redirect, extend aggregate), then wire remaining Branches reference modules onto `branchesDashboard`.
