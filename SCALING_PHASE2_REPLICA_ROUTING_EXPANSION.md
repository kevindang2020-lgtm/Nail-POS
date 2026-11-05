# Scaling Roadmap — Phase 2 (cont.): expand read-replica routing (2026-07-03)

_Phase 2's seam (`DATABASE_READ` token + `createReadDatabase`) was already built and 5 feature modules routed to it.
This ticket routes MORE genuinely read-only modules to the replica so that turning on `DATABASE_REPLICA_URL` shifts
more load off the primary. Every module moved was verified write-free first — routing a writing module to a read-only
replica would break it, so this is a place where honest verification is load-bearing, not optional._

## What changed
Routed two additional verified-read-only surfaces from `DATABASE` to `DATABASE_READ`:
- **`menu-insights`** — AI pricing/menu insights. Controller is GET-only (2 GETs), zero writes (no `insertInto/
  updateTable/deleteFrom`, no raw `sql\`\`` INSERT/UPDATE/DELETE). Safe.
- **`super-admin-appointment-oversight`** — the oversight overview gap repo. Controller is GET-only (11 GETs), the gap
  repo has zero writes. Only the gap repo's DB handle was switched; the composed platform service is untouched. Safe.

Feature modules on the replica seam: **5 → 7** (now: overview, dashboard, reports, super-admin-overview,
super-admin-dashboard, **menu-insights**, **super-admin-appointment-oversight**).

## What was DELIBERATELY excluded (and why) — the important part
Several read-heavy-looking modules were checked and **rejected** because they write, despite looking like pure
read/analytics surfaces. Routing any of these to a replica would have broken them:

| Module | Looked read-only? | Reality | Verdict |
|---|---|---|---|
| `super-admin-ai-insights` | GET-heavy | Writes: raw `UPDATE ai_insights` + `INSERT INTO audit_logs` on review actions | **excluded** |
| `super-admin-analytics` | 2 GETs only | Writes an `audit_logs` row when analytics are viewed | **excluded** |
| `super-admin-revenue-residuals` | reporting | Has write paths (residual records) | **excluded (not verified safe)** |
| `super-admin-system-status` | status board | Has write paths (heartbeats/state) | **excluded (not verified safe)** |
| `super-admin-overview-aggregate` | 1 GET, read-only | Declares no DB provider of its own — composes other services' repos; can't be cleanly switched at the module level without touching those modules | **out of scope** |

The lesson this encodes: a GET-only controller is **not** proof a module is read-only. `super-admin-ai-insights` and
`super-admin-analytics` both expose only GETs yet write to the database (audit trails, status updates via raw `sql\`\``
templates that a Kysely-only `insertInto` grep misses). Each candidate was checked for raw-SQL writes too, and only
the ones with truly zero write paths were moved.

## Why this is safe to ship now (no behavior change today)
`createReadDatabase(primary)` returns the **primary handle** when `DATABASE_REPLICA_URL` is unset (verified,
`kysely.provider.ts` line 34). So until you actually provision a replica and set that env var, these modules read from
the primary exactly as before — this is a pure no-op today that only takes effect when Phase 2 infra is turned on. When
it is, two more read surfaces (menu insights + appointment oversight) automatically shift off the primary.

## Verification (fresh runs)
- **Typecheck:** api `tsc` **0 errors**.
- **Tests:** menu-insights + appointment-oversight suites **18/18**; **full api suite 2572/2572 across 409 files**.
- **Build:** api production build **clean**.

## Files changed
- `apps/api/src/menu-insights/menu-insights.module.ts` — `DATABASE` → `DATABASE_READ`.
- `apps/api/src/super-admin-appointment-oversight/super-admin-appointment-oversight.module.ts` — gap repo `DATABASE` →
  `DATABASE_READ`.

## Phase 2 status
The replica seam now covers 7 read-only feature modules. Further expansion is possible (more super-admin read surfaces)
but each requires the same write-free verification; the low-risk, clearly-safe ones are done. Turning on the replica
(set `DATABASE_REPLICA_URL`) remains a pure infra step with instant rollback (unset = fall back to primary).
