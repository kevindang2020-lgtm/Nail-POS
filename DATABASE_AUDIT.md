# DATABASE_AUDIT.md — schema, migrations, integrity, concurrency, backup (FullSystemTest.pdf Part 13 / §81 / B3 / B7)

| | |
|---|---|
| Date | 2026-10-28 |
| Commit | code `07e599ea` (`merge-github-main`); migrations head `706_ai_receptionist_english_only.sql` |
| Database | **real PostgreSQL 16.15** (local cluster, `wal_level=replica`, `archive_mode=on`, UTC) — not PGlite |
| Scripts (in the repo) | `tooling/full-system-test/migrate-psql.sh` (a psql mirror of `apps/api/scripts/migrate.mjs`), `db-races.sh`, `backup-drill.sh`, `pg-standin/` (lets the PGlite-based DB gates run against a real server) |
| Logs | `docs/full-system-test/2026-10-28/` |

Deeper, older references (not repeated here): `DATABASE_ARCHITECTURE.md`, `DB_TRANSACTIONS_AND_CONCURRENCY.md`,
`DB_INDEX_AUDIT.md`, `RLS_READINESS.md`, `docs/UNIQUE_INDEX_TENANT_REVIEW.md`, `DISASTER_RECOVERY.md`.

## 1. Migrations — PASS

| Check | Result |
|---|---|
| Fresh database, every migration in order (LC_ALL=C), one transaction per file unless `-- migrate: no-transaction` | **646 / 646 applied**, 2 min 0 s wall (47.1 s inside the files); slowest `537_tenant_leading_indexes` 333 ms, `672_expense_finance` 209 ms, `538_core_constraints` 182 ms — `migrations-pg16.log` |
| Second run (idempotency of the runner) | 0 applied |
| Ledger | `schema_migrations` 646 rows with sha256 + duration |
| Invalid indexes / NOT VALID constraints after the run | 0 / 0 |
| `check:migration-safety` (every destructive statement reviewed) | PASS |
| `check:types-drift` — `kysely.types` vs the migrated schema | PASS — 772 tables, every column declared, no ghosts |
| `check:sql` — every raw SQL statement in the code prepared against the real schema | PASS — 3,358 statements, 0 schema errors |
| `check:sql-identifiers` | PASS |

Resume after a failure: the runner stops at the first failing file and leaves it unrecorded; fix it and re-run — recorded files
are skipped by name (the checksum is stored for review, a changed applied file is not re-run). Production applies
`node apps/api/scripts/migrate.mjs` with `MIGRATE_DATABASE_URL` (owner role); the state per environment is the
`schema_migrations` table there. **Production migration state is NOT_TESTED** from here.

## 2. Schema census (real PG 16, after 706)

773 tables (772 application + `schema_migrations`), 2,466 indexes (437 non-primary unique), 2,521 constraints (1,092 CHECK, 380
FOREIGN KEY), 210 triggers, 32 tables with row-level security (all FORCE).

| Rule | Result |
|---|---|
| Money is integer cents | PASS — every `*_cents` column is `integer` / `bigint`; no `real` / `double precision` money; `numeric(5,2)` only for `tax_rate_percent`, `max_tip_percent`; floats only for latitude / longitude / metrics. A fractional value cast into an `_cents` column is rounded by Postgres (12.5 → 13) — the API sends integers (`packages/money`) |
| Tenant ownership classified | PASS — `check:db-ownership`: tenant_owned 477, tenant_branch_owned 82, platform_identity_tenant_relationship 43, platform_global 148, cross_tenant_platform_data 22; the 189 tables without `tenant_id` are all classified |
| Unique indexes on tenant tables without `tenant_id` | PASS — 98, each reviewed (`check:unique-tenant-review`) |
| Actor stamps | PASS — 329 stamped tables; every tenant table with `updated_at` has `updated_by` (`check:actor-stamp`) |
| Idempotency keys | unique per tenant on payments (`payments_tenant_idem_uq`), payment attempts, refunds (processor refund id), gift cards, wallet, cash drawer, payroll payouts (+ check number), deposits, queue stages, tickets |
| Overlap exclusion | `booking_holds_no_overlap` (tenant, branch, technician, time range), `pos_tech_appointments_no_overlap` (tenant, technician, day, minute range, live statuses), `technician_pay_plans` (active plan date ranges) |
| Append-only / locks | `audit_events`, `audit_logs`, `security_events`, `technician_employment_events`, `technician_turn_events` refuse UPDATE / DELETE (DELETE only by the retention job, outside legal holds); TRUNCATE refused on the audit tables (migration 703); `payroll_lines` locked once the period is review / finalized / paid; `payroll_statements` immutable |

## 3. Concurrency and protective triggers — PASS (22 / 22) with a negative control

`tooling/full-system-test/db-races.sh` on a fresh clone of the migrated database (parallel `psql` connections, real locks):

| Case | Result |
|---|---|
| 20 concurrent payments with one idempotency key (`ON CONFLICT DO NOTHING`) | 1 row |
| 20 concurrent plain inserts, one key | 1 row, 19 refused by `payments_tenant_idem_uq` |
| The same key in another salon | accepted (uniqueness is per tenant) |
| 20 concurrent bookings, one technician, one slot | 1 row (`pos_tech_appointments_no_overlap`) |
| Back-to-back 11:00–12:00 after 10:00–11:00 | accepted (`[)` range) · overlapping 10:30–11:30 refused |
| 20 concurrent online-booking holds, one slot | 1 row (`booking_holds_no_overlap`) |
| `audit_events` UPDATE / DELETE / TRUNCATE; `security_events` TRUNCATE | all refused |
| `payroll_lines` UPDATE in review / finalized / paid; INSERT and DELETE in paid | all refused |
| RLS as an ordinary role: salon A reads / updates B's payments | 0 / 0 |
| RLS: A inserts a row for B | refused ("new row violates row-level security policy") |
| RLS strict, no tenant on the session | 0 rows · a malformed tenant id → 0 rows |

**Negative control** (`db-races-negative-control.log`): on a clone with `payments_tenant_idem_uq`,
`pos_tech_appointments_no_overlap` and the payroll lock trigger dropped, the same script reports **8 FAIL** (20 payments, 20
bookings, overlap accepted, payroll edits allowed). One honest limit: "INSERT refused in a paid period" still passes without
the trigger, because a separate uniqueness rule refuses that duplicate — that line is not a precise probe of the trigger.

**Finding (configuration, P1 for production):** RLS is defence in depth and is **inert unless `DB_TENANT_RLS=1`**; with the flag
on but `DB_TENANT_RLS_STRICT` unset, a session with no tenant sees every row (by design, `app_session_unrestricted()`).
Production must set both (`EXTERNAL_SETUP_CHECKLIST.md` X-3). The application layer (`check:tenant`, `check:tenant-builder`,
`check:db-ownership`, cross-tenant suites) remains the primary isolation; the API-level cross-tenant probes were last run in the
Oct 27 pilot (phase 11 §66) and were **not** re-run here (no API build).

## 4. Backup and restore — PASS (local drill) · production NOT_TESTED / BLOCKED_EXTERNAL

`tooling/full-system-test/backup-drill.sh` (`backup-drill.log`):

| Step | Result |
|---|---|
| `pg_dump -Fc` → `pg_restore` into a new database | identical: 773 tables, md5 of payments and audit_events equal, 210 triggers, 2,521 constraints, 2,466 indexes, 32 policies, 646 migrations. Dump 0.7–1.3 s (2.5 MB), restore 8.5 s uncontended / 15 s under load |
| `pg_basebackup` + archived WAL → `recovery_target_time` | the recovered copy has the row written **before** the target and not the one **after**; a bad payment edit made after the target is absent (4500 on the copy, 999999 on the live primary). Postgres: "recovery stopping before commit … archive recovery complete" |
| Timings | base backup 8.1 s, recovery → promoted 2.7 s uncontended (64–100 s / 49–88 s while the unit-test sweep loaded both CPUs) |
| RPO | bounded by WAL archiving: this cluster had `archive_timeout = 0` (a segment ships when full or on `pg_switch_wal()`); production RPO = the provider's PITR granularity — to be recorded by the owner |

Not done here (owner approval / infrastructure): restore of a **production** backup into an isolated instance, per-tenant restore,
recovery with Super Admin unavailable (B7 steps 1, 3, 4). The drill script refuses a non-local host.

## 5. Not covered in this run

- PGlite / Kysely-based pgtests and the race lane (`*.postgres-race.vitest.spec.ts`): BLOCKED_DEPENDENCY (no Kysely / vitest
  package). The stand-in harness runs the ones that use raw SQL only; see `TEST_RESULTS.md` §4.
- Query-plan regressions at 200-technician volume: last measured Oct 24 (`PERFORMANCE_REPORT.md`), not re-run.
