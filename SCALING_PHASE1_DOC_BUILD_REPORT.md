# Scaling Roadmap — Phase 1 (from the uploaded Phase 1 doc): audit + build (2026-07-03)

Read the uploaded Phase 1 document and reconciled all 12 sections against the codebase. Most of Phase 1 was already
built across prior sessions or is pure infrastructure. Three items were genuinely new, buildable code work; this ticket
delivers them. The headline: **the PgBouncer transaction-pooling audit came back clean — no code changes needed to
adopt it** — and the one real gap (unbounded report date ranges) is now closed.

## Section-by-section reconciliation

| Doc section | Status | Notes |
|---|---|---|
| §1 PgBouncer pooling | infra + **audit built** | Deploying PgBouncer is infra; the required Step-1 compatibility audit is done (below). |
| §2 Read replica / `DATABASE_READ` | **already built** | `DATABASE_READ` token + `createReadDatabase(primary)` with `replica ?? primary` fallback — exactly the doc's design. |
| §3 What uses the replica | **already built (7 modules)** | overview, dashboard, reports, super-admin-overview, super-admin-dashboard, menu-insights, appointment-oversight. |
| §4 What stays on primary | **respected** | Only GET-only, write-free modules were routed; all writes/read-after-write stay on primary. |
| §5 Replication lag | doc/ops note | No code. |
| §6 Hot-path index audit | **already built (verified)** | The doc's booking/queue/payment indexes already exist and are better-specified (include `branch_id`). See below. |
| §7 EXPLAIN (ANALYZE, BUFFERS) | **already done** | Ran on a seeded 200k/4M dataset; shipped migrations 296/297 (statistics targets + audit composite indexes). |
| §8 Super Admin summary tables | **partially present** | Daily snapshot tables exist (e.g. pos_kpi_daily_snapshots); further aggregates deferred until needed. |
| §9 Pagination everywhere | **already built** | `common/pagination.ts` (MAX_PAGE_SIZE=100, clamps) across ~29 repos. |
| §10 Query range caps | **BUILT THIS TICKET** | Was the real gap — reports accepted raw from/to with no ceiling. |
| §11 What the user notices | n/a | Backend-only. |
| §12 Implementation order | followed | Audit → (infra) → tokens → routing → profiling → pagination/range caps. |

## 1. PgBouncer transaction-pooling compatibility audit (the doc's Step 1) — CLEAN
Transaction pooling is unsafe if the app relies on session-persistent Postgres state. Swept the codebase for every
hazard the doc lists:

| Hazard | Found | Verdict |
|---|---|---|
| `SET search_path` (session tenant state) | **none** | Tenant identity is passed explicitly in every query (server-derived), never via session search_path. |
| `LISTEN` / `NOTIFY` / `pg_notify` | **none** (only app-level "notify branch/tenant" email/SMS methods) | Realtime uses the Redis bus, not Postgres pub/sub. |
| Session advisory locks (`pg_advisory_lock`) | **none** | All 5 advisory locks are the transaction-scoped `pg_advisory_xact_lock` variant — auto-released at commit, txn-pool safe. |
| Temp tables | **none** | — |
| Non-`LOCAL` session `SET` | **none** (matches were ordinary `UPDATE … SET column`) | — |
| Session-scoped prepared statements | **none** | No statement-cache/prepared-statement config on the pg driver. |
| Connect-time session state (pool `on('connect')`) | **none** | Standard shared `Pool`; no per-connection session setup. |
| Multi-statement same-session assumptions | **none** | All 90 transaction blocks use Kysely's scoped `.transaction()` (self-contained BEGIN…COMMIT). |

**Conclusion: the codebase is PgBouncer transaction-pooling safe as-is.** No code changes are required to point
`DATABASE_URL` at a transaction-mode pooler. (This was foreshadowed by the architecture — stateless API, Redis realtime
bus, explicit tenant scoping — and the audit confirms it end to end.)

## 2. Hot-path index verification (§6) — already covered, better than the doc
The doc suggests specific indexes; the real schema already has equivalents that also include the `branch_id` dimension
AIPowerSalon filters on:
- **Booking day-grid:** `idx_pos_tech_appts_tenant_date (tenant_id, branch_id, appt_date, technician_id)` and
  `idx_pos_tech_appts_status (tenant_id, appt_date, status)` (migration 028). (Real column is `appt_date`, not the
  doc's `appointment_start`.)
- **Queue-state:** `idx_pos_queue_items_tenant (tenant_id, branch_id, status, checked_in_at)` (026) and
  `idx_pos_tech_queue_tenant (tenant_id, branch_id, status, assigned_at)` (027).
- **Payments:** `idx_payments_tenant_branch_created_method (tenant_id, branch_id, created_at, method)` (029), with a
  prior migration (111) already dropping a duplicate — evidence of existing index hygiene.
No new index migrations were warranted.

## 3. Query range caps (§10) — BUILT (the real gap)
The reports surface accepted raw `from`/`to` with **no ceiling**: `?from=2018-01-01&to=2026-07-03` would scan years of
rows during an interactive request. A few endpoints had scattered `Math.min(90, days)` clamps, but there was no shared
validator and reports had none.

**Built `common/date-range.ts`** (mirroring `common/pagination.ts`):
- `MAX_RANGE_DAYS` per context — appointments 31, transactions 90, reports 90, audit 90.
- `validateDateRange(from, to, context)` — parses bounds, rejects inverted ranges, rejects one-sided (effectively
  unbounded) ranges, and throws `DateRangeError` with the doc's exact remedy ("Use an export job for a larger range")
  when the span exceeds the cap. Both-absent = no range (allowed) unless `requireBoth`.

**Applied to the entire reports surface**: `reports.controller.ts` `filtersFrom` now validates client-supplied custom
from/to (one change covers state, kpis, sales, revenueTrend, services, technicians, customers, payments, tips, and
export — all route through `filtersFrom`). Presets (today/week/month/quarter/year) are server-controlled periods and
pass through untouched. `DateRangeError` maps to HTTP 400.

## Verification (fresh runs)
- **Typecheck:** api `tsc` 0.  **Lint:** changed files 0.
- **New tests:** `date-range.vitest.spec.ts` **7/7** (in-cap allowed; over-cap rejected with export hint + day count;
  tighter 31-day appointments cap; inverted rejected; one-sided rejected; both-absent allowed / requireBoth enforced;
  whole-day diff).
- **Full api suite:** **2594/2594 across 413 files** (was 2582/411).
- **Build:** api production build clean.

## Files changed
- `apps/api/src/common/date-range.ts` — new shared validator.
- `apps/api/src/common/date-range.vitest.spec.ts` — new.
- `apps/api/src/reports/reports.controller.ts` — cap custom ranges in `filtersFrom`; map `DateRangeError` → 400.

## What remains for Phase 1 — all infrastructure, not code
1. **Deploy PgBouncer** in transaction mode and point `DATABASE_URL` at it. (Audit above confirms it's safe.) On
   Railway this is the pooled-connection toggle.
2. **Provision a read replica** and set `DATABASE_REPLICA_URL`. The `DATABASE_READ` seam (7 modules) shifts to it
   automatically; unset = falls back to primary.
Both are console/ops actions, sequenced in `SCALING_TURNON_RUNBOOK.md`. No further offline code is required for Phase 1.
