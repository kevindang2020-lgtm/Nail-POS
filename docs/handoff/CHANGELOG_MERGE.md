# CHANGELOG_MERGE.md — Two-snapshot merge (2026-06-26)

This document records exactly what happened when the two uploaded archives were combined into one
working monorepo. Read it together with `MERGE_TEST_REPORT.md` (real verification results) and
`NEXT_CHAT_START_HERE.md` (entry point).

## What the two uploads actually were

The task framed the uploads as "frontend" and "backend". On inspection that framing did not match the
files. **Both** uploads contained a nested `AI-PowerSalon-Complete-Handoff-2026-06-26.zip`, and **each
nested zip was a complete full-stack monorepo** (all 9 frontend apps **and** the `apps/api` NestJS
backend). They were not a front/back split — they were **two divergent snapshots of the same monorepo**,
forked from a common base and each carrying a different stream of feature work:

| | Branch identity | Migrations | Distinctive work | Self-reported gates |
|---|---|---|---|---|
| **V1** (`files__1_`) | admin-web Super-Admin / oversight | 126–129 | `super-admin-platform` module; Appointment/Customer/Product **oversight** screens; reminders, customer-privacy-requests, service/product **category-merge** engines | API 778 / admin-web 211 |
| **V2** (`files__2_`) | pos-web queue / checkout analytics | 126–128 | `tech-utilization`, `tech-recommendation` ("Best Match"), `kpi-snapshots` modules; queue/checkout/serving/service-done **analytics**; pos-web operational screens 1:1 | API 849 / pos-web 129 |

The two trees differed in **86 shared files** plus **27 V1-only** and **32 V2-only** files. Migrations
000–125 were **byte-identical** in both. The only structural collision was that **both branches numbered
new migrations 126/127/128**, meaning those numbers referred to different DDL in each tree.

## Merge strategy (path-ownership, not blind file-pick)

The divergence was a clean partition once mapped, so the merge assigned **ownership by path** rather than
guessing per file:

**Taken from V1 (admin-arc):**
- `apps/admin-web/**` — entire app (its `App.tsx` already redirects `products → product-catalog`,
  `appointments → appointment-oversight`, `customers → customer-data-oversight`; V2's `ProductsScreen`/
  `AppointmentsScreen` were the **superseded predecessors** and were intentionally dropped).
- `apps/api/src/super-admin-platform/**` and `apps/api/src/reminders/**` (V1 supersets).
- Migrations `126_appointment_reminder_attempts`, `127_customer_privacy_requests`,
  `128_service_category_merge_logs`, `129_product_category_merge_logs`.
- All repo-root historical `*.md` reports.

**Taken from V2 (pos-pipeline):**
- `apps/pos-web/**` — entire app (operational screens 1:1, `AssignTechSheet`, `POSTeamScreen`,
  `techQueueDnd`, story fixtures). This also dropped V1's orphan `apps/pos-web/src/api/techAppApi.ts`
  (zero references anywhere in the repo).
- `apps/api/src/{queue,checkout,serving,service-done,tech-queue,check-in,customers,dashboard,overview,pos-team}/**`
  (V2 supersets — the analytics extensions).
- New shared utility modules `apps/api/src/{kpi-snapshots,tech-recommendation,tech-utilization}/**`
  (pure functions, no `@Module`; imported by the pipeline cluster above).
- `apps/api/src/database/kysely.types.ts` — V2 is a **proven strict superset** of V1 (it adds
  `ticket_service_lines.line_kind`, `pos_queue_items.requested_technician_id`, and the
  `PosKpiDailySnapshotsTable`; V1 had nothing V2 lacked).

**Why this is safe at the module boundary (verified, not assumed):**
- V1's `super-admin-platform` imports only from `auth/`, `customer-salons/`, `common/`,
  `super-admin-tenants/` (all **byte-identical** across both branches) plus `database/kysely.types`
  (V2 superset). V1's `reminders` imports only from `notifications/`, `common/`, `kysely.types`.
- V2's pipeline modules import **neither** `super-admin-platform` **nor** `reminders`.
- `apps/api/src/app.module.ts` was **byte-identical** in both branches → no module-wiring merge needed.

So the two kept-sets and taken-sets do not cross-import each other's changed surfaces; the only shared
mutable contract is `kysely.types.ts`, which is taken as the superset.

## Migration collision — resolution

V1's and V2's new migrations create/alter **disjoint tables**, so no DDL conflict existed — only the file
numbers collided. Resolution was **append-only renumber** (V1 kept its higher ceiling at 129):

| Old (V2) | New | Effect |
|---|---|---|
| `126_pos_kpi_daily_snapshots.sql` | `130_pos_kpi_daily_snapshots.sql` | creates new table |
| `127_ticket_line_kind.sql` | `131_ticket_line_kind.sql` | `ALTER ... ADD COLUMN IF NOT EXISTS line_kind` |
| `128_queue_requested_technician.sql` | `132_queue_requested_technician.sql` | `ALTER ... ADD COLUMN IF NOT EXISTS requested_technician_id` |

The runner (`apps/api/scripts/migrate.mjs`) sorts migrations lexicographically on zero-padded prefixes, so
130–132 run after 129. Three entries were added to the runner's existing `RENAMED` reconciliation map
(the same mechanism already used for the historical `017a` rename) so that **a database that already
applied the old numbers will not re-run them** — the ledger row is rewritten old→new. Net effect:
- Fresh DB → applies 000…132 in order.
- Existing V1 DB → 130–132 are genuinely new (kpi-snapshots etc. never existed) and apply.
- Existing V2 DB → 130–132 are reconciled to "already applied"; no-op.

## Files removed in the merge

| Path | Reason |
|---|---|
| `apps/pos-web/src/api/techAppApi.ts` (V1) | Orphan — zero imports anywhere in `apps/`. |
| `apps/admin-web/src/screens/ProductsScreen.tsx` (V2) | Superseded by V1's `ProductCatalogScreen` (kept; old route redirects). |
| `apps/admin-web/src/screens/AppointmentsScreen.tsx` (V2) | Superseded by V1's `AppointmentOversightScreen` (kept; old route redirects). |
| `apps/api/_probe.mjs` (V2) | Throwaway debug probe, not part of the app. |

No working functionality was deleted: each removed file either had a canonical replacement that is present
and routed, or was provably unreferenced.

## What was added vs. either input alone

The merged tree is the **union**: V1's complete Super-Admin/oversight surface **and** V2's complete
pos-operational analytics surface now coexist in one repo, sharing one `kysely.types.ts`, one migration
sequence (000–132), one `app.module.ts`, and one set of identical shared modules (`auth`, `notifications`,
`common`, `packages/ui`, etc.).

## Verification

Every gate below was **actually executed** on the merged tree after `npm install` (617 packages). Numbers
are real, not carried over from the input manifests. See `MERGE_TEST_REPORT.md` for full command output.

- API `tsc --noEmit` → **0 errors**
- admin-web / pos-web / owner-web / tech-web / customer-web / customer-display `tsc --noEmit` → **0 errors each**
- DB-free harness (`scripts/run-core-specs.sh`) → **57 suites passed, 0 failed** (includes all 17 V1 super-admin core specs)
- API vitest → **134 files / 849 passed**
- admin-web vitest → **51 files / 211 passed**
- pos-web vitest → **48 files / 129 passed**
- Builds: `api`, `pos-web`, `admin-web` → **all OK**

## Standing limitation (unchanged by the merge)

This sandbox had **no live Postgres**. New SQL (V1's 126–129 and V2's renumbered 130–132) is verified by
`tsc` + the DB-free harness + mocked frontend tests only. Before relying on transactional behaviour of
those seven migrations, run a live smoke: `npm run db:up && npm run db:setup`. This is the same limitation
both input branches documented; the merge does not change it.
