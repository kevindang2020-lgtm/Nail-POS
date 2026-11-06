# BACKUP_AND_DR.md — Enterprise Backup & Disaster Recovery (G9, Nov 5 2026)

Guide: *AI PowerSalon — Backup & Disaster Recovery, Claude Build Mandate v1.0 (Oct 2026)*. This file is the §50 final
report. It builds on what already existed — it does not replace it:

| Existing (kept) | Path |
|---|---|
| Disaster recovery plan, scenarios 3.1–3.9, reconciliation checklist | `DISASTER_RECOVERY.md` |
| What a backup holds; key survival | `SECURITY_DR.md`, `docs/HOSTING_ACTIONS_FOR_KEVIN.md` A1–A5 |
| Backup / drill heartbeat (`backup_reports`, 447), staleness P2 alert | `apps/api/src/observability/backup-reports.ts` |
| Restore verifier (schema, data, decrypt sampling) | `apps/api/src/common/restore-verify.ts`, `apps/api/scripts/restore-verify.ts` |
| Drills: restore fidelity, worker loss, Redis loss, DB failover | `apps/api/scripts/drills/*`, `docs/DR_DRILLS_2026-10-08.md` |
| Post-restore side-effect hold (`POST_RESTORE_HOLD=1`) | `packages/config/src/post-restore-hold.ts` |
| Tenant "Run backup now" export requests | `tenant_backup_requests` (140) |

**Hosting today:** Railway Postgres (host of record), media in S3/R2. The platform cannot see the provider's backup
console; it records what the provider job REPORTS and what a real restore test PROVES. Nothing in Super Admin is green
because a file exists (§32).

## 1. What G9 added (§50 B)

| Layer | Change |
|---|---|
| Database | Migration `819_backup_recovery_catalog.sql`: `backup_recovery_points` (manifest + sha256, key references, schema version, retention class, immutable-copy status, verification status), `backup_point_verifications` (append-only evidence), `backup_restore_plans` (checksummed plan + job state; one-active-restore-per-tenant unique index), `backup_restore_events` (append-only). |
| Rules (pure) | `apps/api/src/backup-center/backup-center-core.ts`: manifest validation (refuses credentials, embedded passwords, unencrypted or checksum-less artifacts), DST-safe 12:00 AM America/New_York schedule + missed-checkpoint rule, retention by the point's own local date, planner blockers/warnings, approval rules, state machines `BACKUP_RECOVERY_POINT` / `BACKUP_RESTORE_PLAN`. |
| Service / API | `backup-center.service.ts`, `backup-center.controller.ts`: `super-admin/backups/*` (overview, salon search, recovery points + verified-coverage calendar, restore plans, approve, execute, cancel) and `internal/backups/recovery-points[/:id/verification]` (service token or `BACKUP_REPORT_TOKEN`). |
| Job | `backups.restore_execute` on the one job queue (`reconciliation` class, idempotency key `restore:<plan>`, 1 attempt). |
| Alerts | `backup:midnight_checkpoint` P2 (health aggregator), beside the existing 26-hour staleness P2. |
| Permissions | `super_admin.backups.view / plan / approve / execute`; approve + execute are Super-Admin-only keys. Operations may view and plan; Security and Auditor may view. |
| Super Admin UI (English) | `apps/admin-web/src/screens/backup/BackupCenterScreen.tsx` — System → Backup & Disaster Recovery: Overview, Restore Center, Restore Jobs. |
| Scripts | `report-backup.mjs --manifest <file>` posts a recovery point; `restore-verify.ts` with `RECOVERY_POINT_ID` (+ `ARTIFACT_PATH`/`ARTIFACT_SHA256`) posts the verification. |

## 2. Feeding the catalog (the provider job)

After every backup (target: the 12:00 AM America/New_York platform checkpoint; WAL/PITR windows as the provider offers):

```json
{
  "backupRef": "railway-pg-2026-11-06T05:00Z", "environment": "production", "scope": "platform",
  "source": "provider_snapshot", "recoveryTimestamp": "2026-11-06T05:00:00Z",
  "schemaVersion": "819_backup_recovery_catalog.sql", "appRelease": "<git sha>",
  "artifacts": [
    { "kind": "database", "location": "s3://<offsite-bucket>/2026-11-06.dump", "sha256": "<64 hex>",
      "sizeBytes": 123456789, "keyRef": "kms:alias/aps-backup", "immutable": true }
  ]
}
```

`node apps/api/scripts/report-backup.mjs --manifest manifest.json` (env `BACKUP_REPORT_URL`, `BACKUP_REPORT_TOKEN` —
names only; values live in Railway). A PITR window is `"source": "pitr_window"` with `pitrWindowStart/End`. A tenant
logical export is `"scope": "tenant"` with `tenantId`. The point appears as **UNVERIFIED** until step 3.

## 3. Proving a point (§36)

Restore the dump into a scratch database (never production), then:

```
DATABASE_URL=<scratch> RECOVERY_POINT_ID=<catalog id> ARTIFACT_PATH=<the dump> ARTIFACT_SHA256=<manifest value> \
BACKUP_REPORT_URL=https://<api>/internal/backups/report BACKUP_REPORT_TOKEN=… npx tsx apps/api/scripts/restore-verify.ts
```

VERIFIED requires `schema`, `data` and `checksums` to pass; a missing check leaves the point PARTIAL; a failed one
FAILED. Only VERIFIED points are selectable in the Restore Center and counted as "latest recoverable time".

## 4. Restoring a salon or a branch (§11–14, §17–18)

Super Admin → Backup & Disaster Recovery → Restore Center: search salon (name, tenant ID, store code, branch) → scope
(Compare only / Whole salon / One branch) → a VERIFIED point (others disabled; PITR points take a time) → reason →
**Preview impact**. The dry run is stored as a plan with a sha256 checksum and lists:

* **Blockers** — point not verified / expired / another tenant's / outside its coverage, target in the future, schema
  newer than this deployment, **unresolved card attempts** (§25 P0), selected-domain (not offered, §13), full platform
  (a runbook, not a button).
* **Warnings** — payments, payroll payouts and checks, gift-card and loyalty ledger entries, messages and published
  events AFTER the restore time (kept and reconciled, never repeated), changed tickets/appointments/customers, customers
  shared with sibling branches, central identity links (never replaced), forward migration required.

**Approval**: a different Super Admin (two-person) with a fresh step-up, bound to the exact checksum, valid 30 minutes;
when money moved after the restore time the approver must confirm finance reviewed it. A compare-only plan may be
approved by its requester (it never writes).

**Execution**: one durable job; repeated clicks return the same job; the database refuses a second in-flight restore for
the same salon. The worker re-checks the plan against the catalog, opens the **isolated staged clone**
(`RESTORE_STAGING_DATABASE_URL`; refused if it equals the live database), and requires the clone's schema version to
equal the point's (proof it is the recovered copy of THIS point). Then:

* **Compare only** → RESTORING (read) → VERIFYING → COMPLETED with per-table tenant/branch row counts of staged vs live
  (`liveWritten: false`). It FAILS if the comparison did not cover the core tables.
* **Whole salon / One branch** → after every check passes: **BLOCKED `DESTRUCTIVE_APPLY_NOT_AVAILABLE`**. Writing staged
  rows into the live shared schema is deliberately not enabled until pilots A, B and G (§47) are run and signed off. Until
  then, an actual salon restore follows `DISASTER_RECOVERY.md` §3.1 with the comparison evidence in hand.

### 4a. Decision — when a backup is restored into live data (Kevin, Nov 6 2026: "pick best for my POS")
* **Never in place, never automatically.** A restore always goes into a NEW, separate database first (the isolated staged
  clone above; for the whole platform a new Railway Postgres per `DISASTER_RECOVERY.md` §3.1 with `POST_RESTORE_HOLD=1`).
* **Whole platform lost / corrupted:** restore the newest verified point into a new database, run `restore-verify.ts`,
  then CUT OVER (point `DATABASE_URL` at it) — the old database is kept untouched until the restored one is confirmed.
* **One salon or one branch:** stays COMPARE-ONLY in the product (`DESTRUCTIVE_APPLY_NOT_AVAILABLE` remains). The owner gets
  the comparison evidence; any correction is made by Kevin's developer from the staged clone with the runbook, one salon
  at a time. The in-product destructive apply is enabled only after pilots A, B and G pass on STAGING and the drill below
  has been done once — that is a separate, explicit change, not a setting.
* **Drill:** before launch, then every quarter: restore the latest nightly backup into a throw-away database (never
  production), run `apps/api/scripts/restore-verify.ts`, record the time taken (RTO) and the age of the data (RPO) in §6.
  (HOSTING A3.)

## 5. Full platform and emergency recovery (§19–21, §37)

Unchanged and authoritative: `DISASTER_RECOVERY.md` §3.1 (database) and §3.2 (project/region lost), with
`POST_RESTORE_HOLD=1` before any worker touches restored data. The emergency path does not depend on Super Admin: the
off-site dump + `restore-verify.ts` + the variable list in `DEPLOYMENT.md` §6 + the key record (HOSTING A4). The catalog
rows are themselves in the database; the provider/S3 listing is the independent catalog when the platform is down.

## 6. Honest status — Appendix B (executed evidence only)

| Acceptance test | Result | Evidence |
|---|---|---|
| Midnight schedule / DST | **PASS** (code) | `backup-center-core.vitest.spec.ts` — EST/EDT, both 2026 change days, grace window |
| Missed-checkpoint alert input | **PASS** (code) | `backup-center.pgtest.vitest.spec.ts` §34 |
| Continuous WAL/PITR restore | BLOCKED_EXTERNAL | Railway PITR availability — HOSTING A2 |
| Restore 24-hour-old tenant (into live) | BLOCKED | destructive apply gated (§4); compare-only PASS in pgtest |
| Branch-only restore | BLOCKED | same gate; branch scoping + tamper refusal PASS |
| Central customer identity safety | PASS (plan) | links counted and declared never replaced; no write path exists |
| Other tenants unchanged | PASS (code) | compare-only never writes; isolation tests |
| 200-tech / 100k-customer test | NOT RUN | — |
| Media objects recover | BLOCKED_EXTERNAL | S3 versioning — HOSTING A10/A12 |
| Full platform clean restore | NOT RUN here | runbook §3.2; drill-restore covers DB fidelity (Oct 8) |
| POS frontend / backend release recovery | NOT RUN | image is host-neutral (`Dockerfile`) |
| Super Admin English-only restore UI | **PASS** | `BackupCenterScreen.test.tsx` |
| Emergency independent access | BLOCKED_EXTERNAL | needs a separate recovery identity/account |
| Backup immutability | BLOCKED_EXTERNAL | S3 Object Lock on the off-site bucket — HOSTING A5; catalog reports `immutable` per artifact |
| Encryption / key recovery | PARTIAL | manifests refused without `keyRef`; decrypt sampling in restore-verify; key record HOSTING A4 |
| Corrupt / unsafe artifact rejected | **PASS** | manifest validation + FAILED point (pgtest) |
| Pre-restore safety snapshot | NOT BUILT | only needed once destructive apply exists |
| Payment reconciliation / unknown payment replay guard | **PASS** (planner) | unresolved attempts block; post-point payments warned + finance ack; `POST_RESTORE_HOLD` |
| Payroll payout dedup / gift-loyalty safety | PASS (planner) | counted and warned; no write path re-opens them |
| Tenant authorization / IDOR, branch authorization | **PASS** | routes are Super-Admin realm only (SuperAdminGuard + declared permission); tampered branch / foreign point refused (pgtest) |
| Approval / step-up / dual control | **PASS** | second person, checksum binding, expiry, finance ack (pgtest) |
| Restore-job idempotency | **PASS** | one job per plan; DB fence refuses a second in-flight restore |
| Rollback recovery | NOT APPLICABLE yet | nothing is written to live |
| Schema compatibility | **PASS** (code) | newer → blocker; older → forward-migration warning; staged schema must equal the point's |
| Real RPO / RTO measured | NOT MEASURED in production | Overview shows RPO from the latest verified point; RTO from the last drill duration |

## 7. Next actions (§50 J)

* **P0 (Kevin, HOSTING):** wire the provider backup job to post manifests (§2) at the midnight checkpoint; run §3 against
  one real backup so the catalog has its first VERIFIED point.
* **P1 (engineering):** pilots A/B/G on seeded data, then the destructive apply (scoped transaction batches, pre-restore
  safety point, rollback) behind the existing gate.
* **P1 (HOSTING):** off-site immutable bucket (A5) + Object Lock; PITR decision (A2); independent recovery identity.
* **P2:** 200-tech / 100k-customer extraction timing; media manifest reconciliation; selected-domain mode.
