# Payment Gateways — Backend Aggregation API (built + tested this pass)

Extends the **existing** `super-admin-platform` module (no new/duplicate gateway module). All endpoints are
`SuperAdminGuard`-only and return **masked** data — the raw MID and raw secrets never leave the backend.

## New endpoints
| Method | Path | Returns |
|---|---|---|
| GET | `/super-admin/platform/payment-gateways/state` | The §18 single state object: `{ kpis, filters, gateways[], pagination, analytics{statusBreakdown, topProcessors, recentEvents, recentActivity}, permissions }`. Supports `?search=&status=&processor=&setupStage=&settlementStatus=&dateFrom=&dateTo=&page=&limit=`. |
| GET | `/super-admin/platform/payment-gateways/export` | `{ filename, csv }` of the **filtered** rows (masked MID only). |
| GET | `/super-admin/platform/payment-gateways/analytics/status-breakdown` | Donut slices (Active / Pending Setup / Needs Setup / Issues / Disabled) with counts + pct. |
| GET | `/super-admin/platform/payment-gateways/analytics/top-processors` | Ranked processors: active gateways + monthly volume. |
| GET | `/super-admin/platform/payment-gateways/recent-events` | Mapped recent gateway events. |
| GET | `/super-admin/platform/payment-gateways/recent-activity` | Recent activity timeline. |
| GET | `/super-admin/platform/payment-gateways` | (existing list — kept) |

KPIs + analytics are computed over **all** gateways (platform totals, filter-independent); the table list is the
filtered + paginated slice.

## Where each field comes from (all real tables; nothing fabricated)
- **Gateway / processor / MID / environment / status** ← `tenant_payment_config` (MID masked to `••••last4`).
- **Owner** ← `tenants.owner_user_id` → `users.full_name`.  **City/State** ← first `branches` row per tenant.
- **Settlement status / Failed settlements / Monthly volume** ← `payment_settlements` (latest status; `sum(gross_cents)` and
  `count(*) filter (status='failed')` for the current month).
- **Payment Setup stage** ← derived from config completeness (config row? creds present? active? terminals paired?).
- **Paired terminals** ← `pos_payment_terminals` (status `paired`).  **Last sync / last payment** ← config `updated_at` / `payments`.
- **Recent events & activity** ← `payment_gateway_events` (event_type + signature validity → labelled/kinded).
- **Connected processors / Top processors** ← distinct configured `processor` + per-processor aggregates.

## Honest blocker
- **Chargeback Alerts** — there is no `chargebacks` source table, so the KPI returns `chargebackAlerts: 0` with
  `chargebacksTracked: false` (the UI should render "not tracked yet", not a misleading real 0). Chargeback-type
  `payment_gateway_events`, if present, still surface in the events feed.

## Architecture & security
- All transformation logic lives in a **pure, dependency-free** module `payment-gateways-core.ts` (KPI math, status
  mapping, masking, setup-stage, server-side filter/paginate, analytics, event mapping, CSV) — unit-tested by
  `payment-gateways-core.spec.ts` (**60 assertions**, incl. explicit checks that a **raw MID never appears** in any
  view or CSV). The repository (`paymentGatewaysState`) only does data access; the service composes core + repo.
- **Reused, not rebuilt** (per the audit): the secure per-tenant config CRUD + test (`/super-admin/tenants/:id/payment-gateway`),
  the `PaymentGatewayResolver` (encryption / tenant isolation), and the POS own-gateway read (`/pos/payment-gateway`).

## Verification (this pass)
- `npx tsc --noEmit` (apps/api) → clean (0 diagnostics).
- `payment-gateways-core.spec.ts` → 60 assertions pass.
- Full backend suite (`scripts/run-core-specs.sh`) → **603 vitest + all harness suites, RESULT: PASS** (no regression).

## Next pass (frontend)
Rebuild `PaymentGatewaysScreen` to the design against `…/state` (8 KPI cards w/ drill-down, search + 5 URL-synced filters,
rich table + Actions menu, selected-gateway detail panel, the 4 analytics modules, Export/Refresh) — **reusing
`PaymentGatewayPanel` as the Configure drawer** (the secure write-only credential form already exists). Then the FE tests
and the remaining §24 reports (BUILD / WIRING / SECURITY / TEST / BUG_FIX / BLOCKERS).
