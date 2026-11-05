# Commission & Compensation Architecture

Technician commission, revenue-share, product-cost, payroll, and earnings-rules for AIPowerSalon.
All money is **integer cents**. All tenant data is server-isolated. Ledgers and snapshots are immutable.

This document describes the compensation system as it stands after the §1–§35 build. Much of the core
engine pre-existed; the build wired it to real configuration surfaces and added the missing feature areas.
Each section notes the module(s) involved.

---

## 1. The engine and where commission is decided

There is exactly **one** compensation engine: `compensation/compensation-engine.ts`. It computes, per
`(service line, technician)`, the technician's share and the salon's share using integer-cent arithmetic and
largest-remainder allocation, with an internal reconciliation check. The commissionable base is:

```
eligibleForSplit = price − supply − otherNonCommissionable
```

so **supply (product cost) reduces the base** — a fact that governs the product-cost design (§4).

Commission for a line is **baked (snapshotted) at line creation**, at exactly two write sites:

- `serving.kysely.repository.ts → addService`
- `queue.kysely.repository.ts → createTicketFromQueueItem`

Everything downstream (checkout, earnings, payroll) reads those per-line snapshots. Payroll aggregates
snapshots into per-period lines via `payroll/` → `compensation-payroll-autobuild.ts`.

Retail is kept entirely separate from service commission (spec §5) and computed on its own path in the engine.

---

## 2. Commission rules — store, resolver, and configuration (Phases 1–2)

A full 7-level policy hierarchy resolver (`compensation-policy.ts`) already existed but was **orphaned** — no
rules to resolve. Phase 1 gave it a store and wired it to the money path.

**Store** (migration `409_compensation_policies.sql`):

- `compensation_policies` — scope (`tenant` / `branch` / `technician` / `service` / `service_category` /
  `ticket`; more non-null fields = more specific), a label, and creator.
- `compensation_policy_versions` — the versioned terms: `commission_type` (`percent` | `fixed`) + value,
  `supply_method` + value, `discount_funding`, effective dates, and a lifecycle `status`
  (`draft` → `pending_approval` → `scheduled` → `active` → `replaced` / `expired` / `canceled`).

**Resolution** (`compensation-rule-loader.ts`): `resolveLineCommission(db, ctx)` loads effective rules and runs
the pre-existing resolver, returning the resolved commission or **null**. Null means "no rule matched" — the
caller keeps the service-default, so behavior is **unchanged until a tenant authors rules** (zero regression).
The loader never throws (money-path safety: the whole Kysely builder + execute is wrapped).

**Configuration** (Phase 2): `compensation-rules.repository.ts` / `.service.ts` provide the authoring lifecycle
(create → approve → activate, with activation transactionally superseding the prior active version to
`replaced` and never deleting history). Endpoints live under `owner/compensation`. The owner-web
`CommissionRulesPanel` authors scoped/versioned rules and offers an opt-in "standard 60/40 split" seed
(spec §3 — never silent). Writes require role `OWNER`/`SUPER_ADMIN` or the `compensation.manage` permission.

---

## 3. Product cost / supply (Phase 3)

Migration `410_ticket_line_supply_snapshot.sql` adds `supply_method_snapshot` + `supply_value_snapshot` to
`ticket_service_lines`. The engine applies supply as follows:

- `none` / unset → **0** — commission on gross, product cost **not** deducted (the safe default; Method A).
- `fixed` / `percent` → reduce the commissionable base (Methods B / C).
- `tiered` / `recipe` → tracked separately, **not** deducted by the engine.

Base reduction happens **only** when a tenant explicitly authors fixed/percent supply on a rule. The owner UI
adds a product-cost selector with a warning that base-reducing supply lowers technician commission.

Recipe-based product-cost **tracking** (as information, not a deduction) already exists in the `inventory`
module (`recipeCostCents`, service recipes, POS surface) and was reused, not rebuilt.

---

## 4. Tiered commission (Phase 4a–c)

Some technicians earn a rate that rises with their **period production** — which cannot be a per-line rule, so
it is applied at payroll-aggregation time.

- **Calculation** (`compensation-tiered.ts`): `computeTieredCommission(productionCents, bands, mode)` where each
  band has an upper bound (null = top) and a percent. Two methods, deliberately distinct:
  - **entire-period** — the band the total lands in sets one rate applied to the whole production.
  - **marginal** — each band's rate applies only to the production slice within it (like tax brackets).
- **Storage** (migration `411_technician_tier_plans.sql`): `technician_tier_plans` (mode + JSONB band ladder,
  per technician, optionally per branch).
- **Payroll wiring**: `autoBuildPeriod` applies the tiered result **before** the guarantee, so a tiered
  technician's guarantee floors against their tiered earnings. No plan → per-line commission is used unchanged.
- **Configuration**: `TierPlansService` + endpoints under `owner/compensation/tier-plans`, and the owner-web
  `TierPlansPanel` with a live entire-vs-marginal preview.

---

## 5. Retail commission configuration (Phase 4d)

The engine already computed retail commission from a retail line's rate, but there was no way to **set** that
rate. `RetailCommissionService` stores a salon-level retail policy (`method` `none`/`percent`/`fixed` + value)
in `tenant_settings` (category `compensation`, key `retailCommission`), defaulting to **off**.
`loadTicketMeta` reads it and `engineInputFromLines` applies it to retail lines. Safe (default off = unchanged)
and forward-compatible. Covers §16's percent-of-gross and fixed-per-item; gross-profit, tiered-retail, and
per-category are documented follow-ons.

---

## 6. Bonuses (Phase 5) — recommends, never auto-pays

- **Evaluation** (`compensation-bonus.ts`): a bonus rule ties a measurable metric (`service_production`,
  `retail_sales`, `rebooking_count`, `membership_count`, `attendance_days`, `rating_avg`, `team_goal`) to a
  target and an amount; `evaluateBonus` returns the metric value, the target, a qualified flag, and the earned
  amount. Every rule is returned with its flag for transparent review.
- **Store** (migration `412_bonus_rules.sql`) + `BonusRulesService`, with a facts loader. Today
  `service_production` is derived from the immutable snapshots; the other metrics live in separate modules and
  read as 0 until wired (documented follow-on) — so those bonuses simply don't qualify yet.
- **Approval → payroll**: `approveBonus` records an **approved** `bonus` compensation adjustment via the existing
  manual-adjustment path; payroll's `netForTechnicianPeriod` (which sums approved/applied adjustments) picks it
  up. This is the **only** path a bonus becomes payable — always an explicit human action.
- **Surfaces**: owner-web `BonusRulesPanel` (define + preview per technician + approve).

---

## 7. Worker classification & wage compliance (Phase 6) — flags, never enforces

- **Classification** (migration `413_technician_classifications.sql`): each technician is `employee`,
  `contractor`, or `booth_renter`, **owner-set and never auto-derived**. One row per technician (upserted).
- **Compliance check** (`compensation-compliance.ts`): given a classification, period pay, hours, and the
  tenant-configured minimum wage / overtime threshold, `checkCompliance` returns flags — `below_minimum_wage`
  (with the shortfall) and `overtime_hours`. Wage-and-hour rules apply to **employees only**; contractors and
  booth renters are excluded by classification. Messages are review-oriented, not legal determinations. It
  never changes pay, tops up wages, or classifies anyone.
- **Surfaces**: `ComplianceService` + endpoints (classifications, wage-config, compliance-preview) and owner-web
  `CompliancePanel`.

---

## 8. Compensation agreements & acknowledgment (Phase 7) — §19

- **Store** (migration `414_compensation_agreements.sql`): a technician's terms captured as a versioned,
  acknowledgeable agreement (`terms_json` snapshot, status `draft`/`sent`/`acknowledged`/`superseded`). Creating
  a new agreement transactionally supersedes the technician's prior one; acknowledged agreements are retained as
  history.
- **Owner side**: `AgreementsService` + endpoints (create, list) and owner-web `AgreementsPanel`.
- **Technician side**: `TechAgreementsController` under `tech/compensation-agreements` resolves the current
  technician from the authenticated user (the active `technicians` row for that `user_id`) so a technician only
  sees and signs off on their **own** agreements. Tech-web `TechAgreementsPanel` lists and acknowledges them.

This records what was agreed — it does **not** itself change how pay is computed.

---

## 9. Super-Admin oversight (Phase 8) — §27

`super-admin/compensation/overview` (SuperAdminGuard) aggregates, per tenant that has configured anything, the
counts of active commission rules, tiered plans, bonus rules, worker classifications, and agreements (acknowledged
of total). Admin-web `SuperAdminCompensationScreen` renders it. Read-only.

---

## Data model summary (migrations added by this build)

| Migration | Table(s) | Purpose |
|-----------|----------|---------|
| 409 | `compensation_policies`, `compensation_policy_versions` | scoped, versioned commission rules |
| 410 | (columns on `ticket_service_lines`) | per-line supply snapshot |
| 411 | `technician_tier_plans` | tiered commission plans |
| 412 | `bonus_rules` | target-based bonus rules |
| 413 | `technician_classifications` | owner-set worker classification |
| 414 | `compensation_agreements` | versioned, acknowledgeable comp agreements |

Retail rate and wage-compliance thresholds are stored in `tenant_settings` (category `compensation`).

---

## Compliance stance (governs the whole design)

Build guardrails and inputs; surface exceptions; require human review. The system **never** auto-classifies
workers, **never** auto-deducts product cost from wages, and **never** auto-pays a bonus. Product cost applies
only through explicitly authored commission-base rules. Minimum-wage and classification questions are legal
determinations the salon and its advisors make — the system records their decisions and flags exceptions for
review. (Wage deductions for employees are legally restricted; the tenant decides.)

---

## Known follow-ons (documented, not defects)

- Wire the remaining bonus fact sources (`retail_sales`, `rebooking_count`, `membership_count`,
  `attendance_days`, `rating_avg`) — each lives in a separate module.
- Surface bonuses and compliance flags **inside the actual payroll-build screen** (today the standalone panels
  take pay/hours as inputs); auto-gather pay and hours per period.
- The retail sale flow that **creates** commissioned retail lines is unclear (`line_kind='retail'` is read but
  no insert was found); retail config is ready when such lines flow.
- Advanced retail methods (gross-profit, tiered-retail, per-category); granular commission permissions (§28);
  product cost in the owner financial dashboard (§23); waste factor from the rich recipe structure in cost.
