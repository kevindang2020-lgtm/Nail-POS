# Full System Test — Oct 28 2026 — evidence

Mandate: FullSystemTest.pdf ("Full System Audit, Repair & Validation"). Branch `merge-github-main`; code tested at `07e599ea`.
Environment: sandbox, 2 vCPU, Node 22.23.4, PostgreSQL 16.15 local, no npm registry (no `node_modules`), TypeScript 6.0.2 from
the offline npm cache. No secrets, customer data or tokens are in these files (grepped before commit; only migration file names
such as `018_password_reset.sql` match key-like words).

| File | What it shows | Produced by |
|---|---|---|
| `DEV_HANDOFF_LOG.md` | the running task log, in the mandate's working order | by hand |
| `migrations-pg16.log` | 646 migrations from zero: `<ms> <file>` per line | `tooling/full-system-test/migrate-psql.sh` |
| `run-gates-before-unblock.log` | first `run-gates.mjs` run: 61 PASS / 17 FAIL (environment) | `node tooling/ci/run-gates.mjs` |
| `db-gate-*.log` | the six database gates on real PostgreSQL | `node --import ./tooling/full-system-test/pg-standin/register.mjs apps/api/scripts/<gate>.mjs` |
| `run-all-gates.log` | final gates: `run-gates.mjs` 66 / 78 + one `RESULT <gate> <exit>` line per re-run gate | `tooling/full-system-test/run-all-gates.sh` |
| `db-races.log` | 22 / 22 concurrency, trigger and RLS checks | `tooling/full-system-test/db-races.sh` |
| `db-races-negative-control.log` | the same with three protections dropped: 8 FAIL | same script, mutated clone |
| `backup-drill.log` | dump / restore identical; PITR to a timestamp | `tooling/full-system-test/backup-drill.sh` |
| `typecheck-shimmed-summary.txt` | whole-backend type-check with untyped stand-ins: counts + the 135 non-shim lines | `tooling/full-system-test/shimmed-typecheck.py` + `tsc` |
| `unit-sweep.tsv`, `unit-sweep-rerun.tsv` | one row per spec file: status, file, passed, failed, total, ms, first failure | the stand-in harness (`TEST_RESULTS.md` §4) |

Not here (could not be produced in this environment): pilot logs and screenshots, browser proofs, vitest output, race-lane
output. The last ones are in `docs/pilot-runs/2026-10-27-final/`.
