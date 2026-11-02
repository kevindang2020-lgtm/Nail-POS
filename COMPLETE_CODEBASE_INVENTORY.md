# COMPLETE_CODEBASE_INVENTORY.md

_Full codebase audit, 2026-07-09, of the four-package merged AIPowerSalon monorepo. Figures are extracted from
source (controller decorators, route files, nav configs, migrations). Companion deliverables:
`COMPLETE_ROUTE_INVENTORY.md` and `COMPLETE_MODULE_WIRING_MATRIX.md`._

## Applications & packages (npm workspaces: `apps/*`, `packages/*`)

| App | Kind | Router | Screens | Backend namespace |
|---|---|---|---|---|
| **api** | NestJS 10 + Kysely + Postgres 16 | — | — | 266 controllers, ~2,142 routes |
| **pos-web** | Tenant POS (React 18 + Vite) | react-router | 167 | /pos/*, /tenant/* |
| **admin-web** | Super Admin | react-router | 133 | /super-admin/* |
| **owner-web** | Owner mobile web | tab switch | 32 | /owner/* |
| **tech-web** | Technician mobile web | tab switch | 20 | /tech/* |
| **customer-web** | Customer app | react-router | 58 | /customer/* (+ SSE) |
| **manager-pay-web** | Manager tap-to-pay | screen switch | 7 | /mobile-checkout/* |
| **customer-display** | In-salon iPad display | SSE state machine | 1 view | /customer-display/* (+ SSE) |
| **go-check-in-admin** | Kiosk admin (Capacitor) | static wrapper | — | /go-check-in/* |
| **go-check-in-kiosk** | Check-in kiosk (Capacitor) | static wrapper | — | /go-check-in/* |
| **packages/ui** | Shared component library + design tokens | — | — | (imported by frontends) |

## Backend totals

- **186** NestJS modules (`@Module`), **184** registered in `app.module.ts`'s top-level import array; the remainder
  are transitively imported feature sub-modules. Full graph resolves: `DI_GRAPH_OK`.
- **266** `@Controller` classes, **~2,142** HTTP routes including **6** SSE (`@Sse`) streams.
- **356** SQL migrations (`apps/api/db/migrations/`, applied via `scripts/migrate.mjs`) → **537** tables from scratch.
- Empty global prefix (`setGlobalPrefix('')`); frontends call same-origin, so a frontend path maps 1:1 to a route.

## Sidebar coverage

| Sidebar | Items | Resolve to a real screen | Dead links | Duplicate registrations |
|---|---|---|---|---|
| Tenant POS (`tenant-nav.tsx`) | 187 | **187 (100%)** — 0 render the FeaturePage placeholder | 0 | 0 |
| Super Admin (`AdminLayout.tsx` `NAV_GROUPS`) | 129 dests | **129 (100%)** | 0 | 0 |

Both are now protected by executable wiring specs: `pos-web/src/shell/tenant-nav.wiring.test.ts` (pre-existing) and
`admin-web/src/shell/AdminLayout.wiring.test.ts` (**added in this audit**).

## Frontend → backend contract

Every distinct backend namespace referenced by every frontend API client (pos-web 88, admin-web 64, owner-web 37,
tech-web 23, customer-web 37, manager-pay-web 6) resolves to a real controller — **0 mismatches**. The check accounts
for inline controllers declared in `.module.ts` files and for `@Sse` streams (e.g. `GET /customer/stream`).

## Marker / placeholder scan

- **0** genuine `// TODO`, `// FIXME`, `// HACK` comment markers in production source.
- The admin-web "Coming soon" disabled-nav render branch exists in `AdminLayout.tsx` but **no nav item sets
  `disabled: true`** — every Super Admin item is live. (Harmless unused defensive branch.)
- Two placeholder components are **test-only reachable** and superseded, classified below.

## Status classification of apparently-unconnected code

| Item | Classification | Action |
|---|---|---|
| `pos-web ComingSoon.tsx` | Deprecated — superseded by the gated `FeaturePage`; reachable only from its own test | Documented; not deleted (would require removing a passing test for marginal gain) |
| `admin-web SuperAdminPlaceholder.tsx` | Deprecated — all Super Admin sections now have real screens; reachable only from `AdminLayout.test.tsx` | Documented; not deleted |
| `AdminLayout` `disabled`/"Coming soon" render branch | Internal defensive code, currently unused | Left in place (correct pattern if a future section ships gated) |
| Realtime SSE gateways (`*-realtime.controller`, `realtime.gateway`) | Internal infrastructure | Correctly no sidebar entry |
| Scheduled workers (billing-export, reconciliation sweep, marketing-send, follow-up purge, customer-profile scan) | Background jobs (opt-in via env) | Correctly no sidebar entry |
| Webhook receivers (`/webhooks/bank`, `/webhooks/payments`, `/webhooks/twilio`) | Inbound integration endpoints | Correctly no sidebar entry |
| `security-core`, DB adapters, `packages/ui` | Shared/infra code | Correctly no sidebar entry |

No production business code was found to be truly dead/unreachable, so **no code was removed**. Nothing user-facing
was found orphaned; nothing internal was forced into a sidebar. **Three latent permission bugs WERE found and fixed**
(see "What this audit changed").

## Invariants (re-verified this audit)

Money = integer cents; Fiserv/CardPointe/Bolt/Clover only (no Stripe/Square for salon payments); server-derived
tenant/branch (fail-closed); strict tenant + branch isolation; RBAC + SuperAdminGuard (every gate now proven role-reachable); append-only read-only audit;
no credentials returned to the frontend; cream/gold + Mac-fit shell; no standalone HTML demos. All hold.

## What this audit changed

1. **Fixed 3 real latent-403 permission bugs** (same class the merge fixed for marketing). The tenant **Audit Log
   view** (`GET /audit/events`), the entire **Communications** sidebar (`/pos/communications/*`), and **Payroll**
   (`/pos/payroll/*`) each `@RequirePermission` a coarse capability (`audit.view`, `communications.*`, `payroll.*`)
   that **no role granted** — so every one 403'd for every user including OWNER, while the frontend screens actively
   called them. Fixed in `auth/rbac.ts` by minting the capabilities and granting them to the correct roles:
   `communications.*` -> all operational roles (the nav section is `roles: OPS`); `payroll.*` + `audit.view` ->
   OWNER/MANAGER (management). Verified against the compiled `hasPermission` for every role.
2. Added `apps/api/src/common/permission-reachability.vitest.spec.ts` — scans every real permission gate
   (@RequirePermission / service .need / hasPermission) and asserts each is grantable by at least one role. This is
   what surfaced the three bugs above; it now locks the invariant permanently (it is the guard recommended in the
   merge's REMAINING_ISSUES.md, now implemented). 3 tests, green.
3. Added `admin-web/src/shell/AdminLayout.wiring.test.ts` — 4 invariants making the Super Admin sidebar
   dead-link/duplicate/absolute-path guarantees regression-proof (the tenant POS side already had its equivalent).
4. Produced the three inventory/matrix deliverables.

The sidebar↔route↔controller *structural* wiring was already complete and green; the defects this audit fixed were
in the **permission layer** — invisible to the wiring test, the DI check, and the (client-mocked) frontend tests,
and only catchable by exercising the real gates against the real role catalog.

5. **Reverse-alignment pass (nav-visibility ↔ backend grants)** found 2 more real misalignments, both fixed:
   (a) **MANAGER 403'd on the package-B AI modules** — the AI CENTER section is `roles: MGMT` (OWNER+MANAGER) and 8/8
   other AI modules grant MANAGER `.view`, but queue-assignment / money-protection / voice-transcription granted
   MANAGER nothing, so managers saw those items and 403'd. Fixed in `rbac.ts` by granting MANAGER the read-tier
   (`ai_queue_assignment.view`, `ai_money_protection.view`+`view_alerts`, `ai_voice_transcription.view`+`view_transcripts`);
   sensitive mutations stay owner-gated. (b) **Front-desk/reception 403'd on 3 Communications config items** — Phone &
   Caller ID, Email, and Message Templates read `/pos/settings` (`settings.view`, management-only) but sat in the
   `roles: OPS` section without a restriction, unlike the sibling config items which are `roles: MGMT`. Fixed in
   `tenant-nav.tsx` by marking those three `roles: MGMT`. After both, the nav↔permission alignment sweep reports
   **0 violations across 126 mapped items**; MANAGER AI-view grants are pinned in the reachability spec.
