# Tenant Isolation — Static Guardrails (CI)

Standing record of the **static, build-time guardrails** that pin the multi-tenant isolation model so a future change
can't silently regress it. These are CI invariants over source, not behavioral tests — they complement, and do not
replace, the live-Postgres runtime matrix in `TENANT_ISOLATION_TEST_REPORT.md` (spec §15) and any penetration testing.

Audited June 28, 2026. The isolation model was found **already mature** — these guards lock in what exists; they did not
introduce new runtime behavior. All three are test-only; zero runtime code changed.

## The architecture they pin (as audited)

- **Authentication fails closed, globally.** `TenantContextMiddleware` is applied to every route (`*`) and throws 401
  when there is no valid signed session. It also strips any client-supplied `tenantId`/`branchId` from body+query, so a
  client can never assert its own tenant. Identity is always derived server-side from the session.
- **Authorization is centralized.** `RolePermissionGuard` is a global `APP_GUARD` enforcing `@RequirePermission(...)`
  where declared; class-level `@UseGuards(TenantAuthGuard | SuperAdminGuard | …)` add role gates.
- **Every tenant query is scoped.** Repositories filter by the session `tenant_id` (via the `scoped()` builder or an
  explicit `WHERE tenant_id = …`); `customer_id`/`technician_id` are resolved server-side within that tenant.
- **Real-time rooms are tenant-scoped.** Room keys come only from the centralized builders in `realtime/realtime-core.ts`
  (`tenant:${t}:branch:${b}`, `tenant:${t}:owner`, …), each derived from the session — never from client input.

## The three guards

| Guard (`apps/api/src/common/…`) | Pins | Tests |
|---|---|---|
| `tenant-isolation.vitest.spec.ts` | Scans all `*.kysely.repository.ts`; fails if a **raw `sql\`\``** query touches a tenant-owned table (any table with a `tenant_id` column — derived from the schema) without a `tenant_id` filter. `scoped()`-builder queries are safe by construction and exempt. | 3 |
| `auth-boundary.vitest.spec.ts` | The fail-closed perimeter stays wired (global guard + middleware on `*`); **no tenant-operational prefix** (`pos/`, `owner/`, `super-admin/`, `tenant/`) is ever in the auth-middleware `.exclude(...)` list; the public exclusion set matches a documented 36-entry baseline. | 4 |
| `realtime-isolation.vitest.spec.ts` | Tenant-scoped room keys keep embedding the tenant id; **no new `@Sse` stream may forward event payloads** — only the documented general POS stream may. | 3 |

Run: `cd apps/api && npx vitest run src/common/tenant-isolation.vitest.spec.ts src/common/auth-boundary.vitest.spec.ts src/common/realtime-isolation.vitest.spec.ts` (10 tests).

## Allowlisted exceptions (intentional, justified)

- **Query-scoping** — PATH `super-admin*` (Super Admin is by-design cross-tenant oversight, `SuperAdminGuard`-only, read-only); plus 7 specific raw statements: the ai-access own-role lookup (keyed by the session `userId`), the hardware-payment platform-billing summary, one membership-billing status update (by UUID primary key) and the membership version-sequence select, and three NailShowcase global-scope reads — leaderboard/rank, "my rank", and the moderation queue (intentionally platform-wide social surface, not tenant business data). The audit triaged all 38 raw-SQL flags and found **zero genuine cross-tenant leaks**.
- **Auth-boundary** — the 36 excluded routes are all pre-auth flows, public booking discovery, device/cron-token endpoints (`go-check-in/*`, customer-display, `jobs/*`, `internal/hardware-payment/run-monthly`), the payment webhook (signature-verified), and `health`/`platform/branding`. Each is authenticated by a mechanism other than a user session.
- **Real-time** — `realtime/realtime.controller.ts` (the general POS floor stream) is the one stream permitted to forward payloads: it subscribes **only** to the caller's own `tenant:${t}:branch:${b}` room and is `pos.login`-gated, so the payload is the subscriber's own shared floor state. The four per-actor streams (tech/customer/owner/customer-display) forward the event **name only**.

## Standing hardening rules

- **`toTenant()` payloads are visible to every `pos.login` user at that branch** (via the general POS stream). Any
  per-actor-sensitive data must be published to the private actor rooms (`toTechnician` / `toOwner` / `toCustomer`),
  never `toTenant()`. Nothing currently violates this — it is a rule to keep.
- New public routes must be added to the `auth-boundary` baseline deliberately (the test forces review).

## Open hardening questions (need a decision — not yet actioned)

1. **ai-access role lookup** — currently scoped by the session `userId` (allowlisted). Adding an explicit `tenant_id`
   filter would be defense-in-depth, but it touches an auth-adjacent path and should be verified against live Postgres
   before merging.
2. **NailShowcase global leaderboard** — reads across tenants by design (allowlisted as global scope). Confirm the
   cross-tenant visibility is the intended product behavior.

## What these guards do NOT cover

Static source invariants only. They do **not** validate runtime behavior, the live SSE socket (can't stream in CI),
RLS (there are 0 DB policies — app-layer scoping is the documented §8 alternative), or constitute penetration testing or
human security review of a payment platform. Live-Postgres smoke for migrations 170–171 and the super-admin-memberships
module remains a manual step.
