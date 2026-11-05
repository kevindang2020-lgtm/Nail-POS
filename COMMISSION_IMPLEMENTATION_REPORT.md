# Commission & Compensation — Implementation Report

Delivery summary for the Technician Commission / Revenue-Share / Product-Cost / Payroll / Earnings-Rules build
(spec §1–§35) for AIPowerSalon. See `COMMISSION_ARCHITECTURE.md` for the design.

## Approach

The build was **audit-first**. The audit found that the compensation *engine* and much of the plumbing already
existed but were often orphaned (a full policy-hierarchy resolver with no rules to resolve; a supply mechanism
hardcoded to zero; retail commission with no rate config) or already-built (recipe-based product-cost tracking).
The #1 rule throughout was **reuse, don't duplicate** — every phase began by grepping for real callers and
tables before writing anything.

Work proceeded in verified phases. Money-path changes were **additive and default-off**, proven byte-for-byte
unchanged for existing tenants before any new behavior could be enabled. Each phase was gated (below) before
moving on.

## What was delivered, by phase

- **Phase 1 — Commission rule store + resolver (wired).** Migration 409; `compensation-rule-loader.ts` bridging
  the store to the pre-existing resolver; wired into the two line-creation write sites with a service-default
  fallback (zero regression). Behavior unchanged until rules are authored.
- **Phase 2 — Rule configuration surface.** Repository + service for the create → approve → activate lifecycle
  with transactional supersede; owner endpoints; owner-web `CommissionRulesPanel`; opt-in 60/40 seed.
- **Phase 3 — Product cost / supply.** Migration 410; supply baked and applied by the engine (default = no
  deduction); owner UI selector with a base-reducing warning. Recipe cost *tracking* found already-built; reused.
- **Phase 4 — Tiered commission + retail config.** Pure tiered calculator (entire-period vs marginal); migration
  411 + payroll wiring (applied before the guarantee); tier-plan config UI with live preview. Retail rate config
  (migration-free, in `tenant_settings`), default off, applied to retail lines at engine-input time.
- **Phase 5 — Bonuses.** Pure target-based evaluator; migration 412 + rule store + per-technician preview; approval
  routed through the existing `bonus` adjustment so payroll picks it up. Recommends only — never auto-pays.
- **Phase 6 — Worker classification + wage compliance.** Pure compliance checker (flags, employees-only); migration
  413 (owner-set classification, never auto); wage-config + review preview. Flags only — never enforces.
- **Phase 7 — Compensation agreements + acknowledgment.** Migration 414 (versioned, supersede-on-create); owner
  create/list; technician view + acknowledge from tech-web (identity resolved from the authenticated user).
- **Phase 8 — Super-Admin oversight + docs.** Cross-tenant compensation-config overview endpoint + admin-web
  screen; this report and the architecture document.

## Verification

Every phase was validated with the repo's gates from `apps/api`:

- **Type safety**: `tsc --noEmit` clean across `api`, `owner-web`, `tech-web`, `admin-web`.
- **Dependency injection**: `check:di` — every injected token has a provider.
- **Raw SQL**: `check:sql` — every raw SQL statement resolves against the real schema (it caught a
  `tenants.name` → `display_name` slip that no unit test would have).
- **Endpoint/caller wiring**: `check:crosswire` — 0 orphaned endpoints; every endpoint has a frontend caller
  (owner-web, tech-web, or admin-web as appropriate).
- **Dead code / reachability**: `check:unreached`, `check:nav`, `check:public` — all clean.
- **Migrations**: `verify-migrations-pglite.mjs` — all migrations (through 414) apply in order on real PG16.
- **Tests**: the compensation suite ends at **197** passing (unit + PGlite integration), plus owner-web,
  tech-web, and admin-web component tests. Integration was proven against real PG for the money-sensitive paths
  (rule resolution, tiered payroll ordering, JSONB round-trips, approved-bonus → payroll pickup,
  classification upsert, wage-compliance end-to-end, agreement supersede/acknowledge, and the SA aggregate).

## Compliance posture

The system builds inputs and surfaces exceptions for human review. It never auto-classifies workers, never
auto-deducts product cost from wages, and never auto-pays a bonus. Minimum-wage and classification decisions are
left to the tenant and their advisors; the system records those decisions and flags exceptions.

## Known follow-ons (documented, not defects)

1. Wire the remaining bonus fact sources (`retail_sales`, `rebooking_count`, `membership_count`,
   `attendance_days`, `rating_avg`) from their respective modules.
2. Surface bonuses and compliance flags inside the actual payroll-build screen, auto-gathering pay and hours per
   period (today the standalone panels take these as inputs).
3. Clarify/complete the retail sale flow that creates commissioned retail lines (`line_kind='retail'` is read but
   no writer was found); the retail rate config is ready when such lines flow.
4. Advanced retail methods (gross-profit, tiered, per-category); granular commission permissions (§28); product
   cost in the owner financial dashboard (§23); waste factor from the rich recipe structure in cost estimates.

These are additive extensions on top of a complete, verified core; none blocks the delivered functionality.
