# DISASTER_RECOVERY.md — AIPowerSalon disaster recovery plan

Constitution 4 §95–101, §147–151 (BUILD_PLAN Phase 11). Written October 8, 2026 against this tree. Railway is the host of
record (`railway.json`, `railway.worker.json`); the AWS Terraform in `deploy/terraform` is legacy and not applied.

This file says **what can be lost, how fast it comes back, and exactly what to do**. Every claim points at a file or a
drill output. Where the answer depends on a hosting setting this repository cannot see, the line is marked **HOSTING**
and the action is in `docs/HOSTING_ACTIONS_FOR_KEVIN.md`. Companion files:

- `SECURITY_DR.md` — what a database backup does and does not contain; why the encryption keys are part of the backup.
- `RUNBOOKS.md` — symptom-first runbooks the health alerts link to (`database-outage`, `redis-outage`, …).
- `docs/DR_DRILLS_2026-10-08.md` — the four drills, run on Oct 8 2026, with their full output.
- `docs/DEPENDENCY_INVENTORY.md` — every external service, its failure mode, timeout and fallback.

Owner of every scenario below: **the platform owner (Kevin)** — one person today. "Incident commander" means whoever is
handling it; for a solo operator that is the same person, and the rule is: write each decision in the incident record
(Super Admin → Security Center → incidents, `security_incidents`, or a status incident, `status_incidents`) before acting.

---

## 1. Data classes, RPO and RTO

RPO = how much recent data may be lost. RTO = how long until the platform serves again. **Targets are decisions made
here**; "measured" is what a drill has shown. A target the hosting cannot meet yet is marked **HOSTING**.

| Data class (retention class in `apps/api/db/retention-policy.json`) | Where it lives | Backed up by | RPO target | RTO target | Measured |
|---|---|---|---|---|---|
| Money: payments, payment attempts, refunds, ledgers, cash drawer (`financial`) | PostgreSQL | Railway Postgres backups (**HOSTING**) | **≤ 5 min** with PITR; 24 h with daily snapshots only | 2 h | restore of a 2.4 MB dump: 4.0 s (drill-restore) |
| Tickets, bookings, appointments, queue (`operational` + domain tables) | PostgreSQL | same | ≤ 5 min (PITR) / 24 h | 2 h | same drill: row counts and checksums identical |
| Customers, salon configuration (`customer_history`) | PostgreSQL | same | ≤ 5 min (PITR) / 24 h | 2 h | same drill |
| Audit and security logs (`audit`, `security`) | PostgreSQL (append-only) | same | ≤ 5 min (PITR) / 24 h | 2 h (not needed to serve) | same drill |
| Encrypted credentials (payment processor, Twilio, bank, MFA, webhook) | PostgreSQL, as ciphertext | same + **the keys, kept outside Railway** (**HOSTING**) | as the database | 2 h — **only if the keys survive** | restore-verify opens a sealed value with the configured key (drill-restore) |
| Uploaded media: avatars, portfolios, showcase (`media`) | S3 when `MEDIA_STORE=s3`; container disk otherwise | bucket versioning (**HOSTING**); container disk: **nothing** | 0 with a versioned bucket; **total loss at every deploy on container disk** | bucket: none needed | not drilled |
| Safety evidence blobs | S3 `EVIDENCE_S3_BUCKET` (private) | bucket versioning (**HOSTING**) | 0 with versioning | none needed | not drilled |
| Durable jobs (`jobs`), outbox events, dead letters (`operational`) | PostgreSQL | as the database | as the database | as the database | drill-worker-loss: 12/12 jobs completed after a worker was killed |
| Redis: cache, rate-limit windows, login-throttle windows, realtime fan-out, presence | Redis (optional) | **nothing — by design** | everything (rebuilt) | immediate (the API runs without Redis) | drill-redis-loss: see §3.3 — two defects found |
| Secrets and encryption keys | Railway variables | **an off-Railway copy** (**HOSTING**) | 0 | 15 min (re-enter) | not drillable here |
| Metrics, traces, logs | in-process registry, OTLP collector, Railway logs | nothing | acceptable loss | n/a | — |

Why these numbers. The backups health signal already treats a backup older than 26 h as `stale`
(`apps/api/src/observability/backup-reports.ts`, `BACKUP_MAX_AGE_HOURS`), so the platform assumes at least a daily
backup. A salon business loses a day of tickets and payments only at real cost, so the money target is PITR (≤ 5 min);
until PITR is confirmed on the Railway plan, the honest RPO is 24 h. RTO 2 h is the target `SECURITY_DR.md` set; the
measured restore at today's size is seconds, so the RTO is dominated by people and DNS, not by `pg_restore`.

## 2. Detection — how each failure is noticed

| Signal | Where | Goes to |
|---|---|---|
| Health components `api`, `database`, `redis`, `workers`, `events`, `payments`, `communications`, `backups`, `synthetic`, … | `apps/api/src/observability/health-core.ts` (aggregated every minute) | Super Admin → System Operations; alert email to Super Admins, SMS to `ONCALL_PHONE`, email to `ONCALL_EMAIL` (`alert-notifier.ts`) |
| `/health/ready` 503 (database unreachable or shutting down) | `apps/api/src/health/health.controller.ts` | Railway deploy health check (`railway.json` `healthcheckPath`) |
| Synthetic probes against the public URL | `apps/api/src/observability/synthetic-probes.ts` (`SYNTHETIC_BASE_URL`) | `synthetic` component |
| Backups stale / failed / drill overdue (90 days) | `backup-reports.ts`, `POST /internal/backups/report` | `backups` component |
| Prometheus scrape | `GET /metrics` (`apps/api/src/health/metrics.controller.ts`, `METRICS_TOKEN`) | an external scraper (**HOSTING**) |
| Traces | OTLP exporter (`packages/observability/src/tracing/`, `OTEL_EXPORTER_OTLP_ENDPOINT`) | an OTLP backend (**HOSTING**) |
| **The API itself is down** | none of the above — they run inside the API | an **external uptime monitor** on `/health/ready` (**HOSTING**: the in-process alerts are silent when the process is) |

## 3. Scenarios

Each: **Detection · Decision · Steps · Verification · Owner.** Commands assume the Railway CLI or dashboard; "redeploy"
means Railway → service → Deployments → Redeploy.

### 3.1 Database lost or corrupted (§99, §147)
- **Detection.** `database` OUTAGE (`probe_failed`); `/health/ready` 503 on every instance; Railway Postgres service
  shows crashed / volume error; or data visibly wrong (corruption — a bad migration, a bug writing bad rows).
- **Decision.** Outage with intact data → wait for Railway / restart the Postgres service (the API needs no action:
  drill-db-failover shows the process stays up and readiness returns to 200 by itself). Data lost or corrupted →
  restore. Corruption by a bug → first stop writes: set `MAINTENANCE_BREAK_GLASS=read_only` on the API service and
  restart it (works with the database down — `apps/api/src/common/maintenance-break-glass.ts`), then decide the restore
  point (just before the bad write).
- **Steps (restore).**
  1. `MAINTENANCE_BREAK_GLASS=full` on the API (and the worker, if split) → restart. The platform answers 503 with the
     message; `/health/*` keeps answering.
  2. Railway → Postgres → Backups: restore the chosen backup (PITR: the chosen timestamp) **into a new database
     service** — never over the damaged one (it is the evidence and the fallback). **HOSTING**
  3. Verify the restored copy BEFORE pointing the API at it, with the production keys in the environment:
     `DATABASE_URL=<new db> npx tsx apps/api/scripts/restore-verify.ts` (exit 0 = schema complete, core tables hold
     data, every sampled encrypted column opens). Add `BACKUP_REPORT_URL` + `BACKUP_REPORT_TOKEN` to record the result.
  4. **`POST_RESTORE_HOLD=1` on the API AND the worker** (mandate §212, Oct 20 2026 — `packages/config/src/post-restore-hold.ts`)
     BEFORE pointing anything at the restored data. The restore rolled back everything the workers already did after the
     snapshot: receipts / SMS / push sit "pending" again, membership renewals look unbilled (their idempotency key lives in
     the database that was just rolled back; CardPointe does not dedupe), payouts and partner webhooks look unsent. With the
     hold set the job worker claims no job of any class, the outbox publisher dispatches nothing and every scheduler skips its
     tick (logged once per worker; System Status `workers` shows DEGRADED "post-restore hold"); the HTTP API works normally.
  5. Point the API's (and worker's) `DATABASE_URL` at the new database (Railway variable reference) → redeploy. The
     pre-deploy step runs `db-preflight.mjs` + `migrate.mjs` (`railway.json` `preDeployCommand`); migrations newer than
     the backup apply in order.
  6. `MAINTENANCE_BREAK_GLASS=off` → restart. People can work; nothing goes out yet.
  7. **Reconcile the RPO window from the outside records — the checklist (a Super Admin, with the portals open):**
     - **Card payments / refunds / voids**: CardPointe (`inquireByOrderid`, settlement report) and Clover reports since the
       snapshot. A charge the processor holds that is `processing` or absent here → the cashier's Verify / the stranded-attempt
       sweep records it once the hold lifts (never re-charged); a refund the processor holds → settle it (REFUND_STATUS_UNKNOWN
       runbook); a charge here the processor does not hold → void the local record.
     - **Membership renewals / autobill** (`membership_renewals`, `renewalIdempotencyKey`): CardPointe shows which renewal
       charges were made after the snapshot → mark those renewals billed by hand (processor reference) BEFORE lifting the hold,
       or the autobill scheduler charges the card again.
     - **Payouts** (`payouts`): the bank / payroll export since the snapshot → mark sent.
     - **Receipts / SMS / e-mail / push**: Twilio message logs and SendGrid activity since the snapshot → mark the matching
       `notification_delivery_logs` / outbox rows done (or accept a duplicate receipt — the only harmless class).
     - **Partner webhooks / exports**: the partner's inbox vs `api_webhook_deliveries` → mark delivered.
     - **Twilio A2P / number changes, Super Admin settings** since the snapshot → re-enter by hand.
  8. `POST_RESTORE_HOLD` cleared on the API and the worker → restart. The outbox drains, schedulers resume, the sweep
     settles the `processing` attempts from the processor's answer.
- **Verification.** `restore-verify` exit 0; `/health/ready` 200; System Operations `database` HEALTHY three runs in a
  row; `workers` no longer says "post-restore hold"; a test ticket checks out end to end; outbox (`events`) drains; no
  duplicate renewal charge in CardPointe for the window (the drill checks this — `drill-restore.mjs`).
- **Owner.** Platform owner. P1.

### 3.2 Region / whole Railway project lost (§100)
- **Detection.** Every component down; Railway status page; the external uptime monitor (**HOSTING**).
- **Decision.** Railway region outage expected to end within the RTO → wait and post a status incident. Project
  unrecoverable or outage beyond 2 h → rebuild elsewhere from the off-site backup.
- **Steps.** (1) New Railway project (another region) or another container host — the image is host-neutral
  (`Dockerfile`; `MIGRATE_ON_START=1` for a host without a pre-deploy hook). (2) Restore the latest **off-site** backup
  copy into a new Postgres 16 (**HOSTING**: an off-Railway backup copy must exist — Railway's own backups live in the
  same project). (3) Re-enter every variable from the off-Railway record (`DEPLOYMENT.md` §6 lists the names; the
  encryption keys especially). (4) Deploy; run `restore-verify`; (5) repoint DNS (**HOSTING**: Cloudflare/registrar)
  and update `WEB_CORS_ORIGINS`, `APP_BASE_URL`, `PUBLIC_APP_URL` if the hostnames changed.
- **Verification.** As 3.1, plus every frontend loads against the new API origin.
- **Owner.** Platform owner. P1.

### 3.3 Redis lost (§47, §112)
- **Detection.** `redis` DEGRADED `down:<role>` / OUTAGE; `aipowersalon_redis_connection_up{role}` = 0.
- **Decision.** None needed to keep serving: Redis holds no system-of-record data (booking and money never touch it —
  `apps/api/src/common/redis-down.vitest.spec.ts` §66). Restart or replace Redis; the clients reconnect by themselves
  (drill-redis-loss: reconnected and writing keys within 2 s of Redis returning).
- **Found by drill-redis-loss (Oct 8 2026) and fixed the same day:** sign-in answered 500 during a Redis outage
  (`RedisLoginThrottle` now fails open — no history, writes dropped), and every Redis command waited 2–6 s before failing
  (request/response commands now time out after 500 ms, `REDIS_COMMAND_TIMEOUT_MS`; blocking / pub-sub commands are
  exempt). The re-run passes 13/13 with the slowest request at 2.0 s — `docs/DR_DRILLS_2026-10-08.md` §3. No variable
  needs changing during an outage.
- **Steps.** Railway → Redis service → restart / redeploy (**HOSTING**: Redis with persistence is not needed; HA is
  optional — a single instance plus the fallbacks is acceptable).
- **Verification.** Every `redis` role `up=1`; `GET /pos/services/categories` and sign-in answer in < 100 ms.
- **Owner.** Platform owner. P2.

### 3.4 Worker (or API instance) lost (§28–34, §148)
- **Detection.** `workers` DEGRADED `stalled:<job types>`; Super Admin → Jobs: queued age rising, running jobs with an
  expired lease; Railway shows the service crashed/restarting.
- **Decision.** None for correctness: a job a dead worker held is put back in the queue when its 5-minute lease lapses
  (the reaper, `apps/api/src/jobs/job-worker.ts`, every 60 s, single-owner) and finished exactly once by another worker.
  drill-worker-loss (real lease): worker SIGKILLed mid-run → 12/12 jobs succeeded, the 4 interrupted ones by the new
  worker (attempts = 2), the 4 already finished were not re-run, the API stayed ready; **recovery 306 s**. Schedulers
  hold a per-tick lease (`scheduler_runs`, migration 518) the same way.
- **Steps.** Railway restarts the container (`restartPolicyType: ON_FAILURE`, 5 retries). If it crash-loops: read the
  boot log (`RUNBOOKS.md` → `worker-crash-loop`); if the worker cannot be fixed fast, set the web service's
  `PROCESS_ROLE=all` and restart it — the web service then runs every job class (`RUNBOOKS.md` → `worker-split`).
- **Verification.** Super Admin → Jobs: nothing `running` past its lease, queued age back to seconds; `workers` HEALTHY.
- **Owner.** Platform owner. P2 (bookings and checkout keep working; reminders and rollups lag).

### 3.5 Provider outage — payments, SMS, email, push, AI (§116–118)
- **Detection.** System Operations → provider health (`OUTAGE` while a circuit is open), `payments` /
  `communications` / `ai` components; the provider's status page.
- **Decision.** Calls are bounded (`PROVIDER_TIMEOUT_MS` in `packages/observability/src/provider-telemetry.ts`: card
  processors 60 s, Twilio and email 15 s, FCM/APNs 10 s) and a circuit opens after 5 consecutive provider failures for
  30 s (`circuit-breaker.ts`), so an outage degrades the feature, not the API. Card processor down → take cash / record
  card payments taken on a standalone terminal; do not retry charges by hand. A card attempt that never got its answer
  stays `processing` and is resolved by the stranded-attempt sweep (`payments.stranded_attempts`, every 5 min,
  threshold `PAYMENT_ATTEMPT_STRANDED_MINUTES`, default 15): it asks the processor and **never charges, voids or refunds**
  on its own; an unknown outcome becomes `needs_review` + an owner alert.
- **Steps.** Kill switches for a misbehaving provider: Super Admin → Kill switches (CardPointe, Clover, SMS, AI —
  `kill-switches.ts`, step-up + reason). Post a status incident if salons are affected. After recovery, work the
  `needs_review` attempts with the processor's report (`RUNBOOKS.md` → `stranded-payment-attempts`).
- **Verification.** Provider `HEALTHY`; no attempt older than the threshold left in `processing`.
- **Owner.** Platform owner. P1 for payments, P2 otherwise.

### 3.6 Bad deploy (§74–75, §232)
- **Detection.** Error rate / latency jump right after a release; the deploy's pre-deploy step failed; readiness never
  turned 200 (Railway keeps the old deployment serving).
- **Decision.** Roll back the **application** to the previous image. **Never roll back a migration automatically.**
  The expand/contract rule (`DEPLOYMENT.md` §5 — a release only adds; removal ships in a later release) is what lets the
  previous image run on the newer schema; a release that broke the rule needs a forward fix instead.
- **Steps.** Railway → API service → Deployments → the previous successful deployment → Redeploy (the worker too, if
  split). A failed migration blocks the release by design (`preDeployCommand` fails → the new deployment never starts;
  `migrate.mjs` applies each file in its own transaction and holds an advisory lock). If the bug is writing bad data:
  `MAINTENANCE_BREAK_GLASS=read_only` first, then 3.1 for the repair.
- **Verification.** Error rate back to the pre-release baseline; System Operations → schema version shows the expected
  latest migration and no checksum mismatch.
- **Owner.** Whoever released. P1/P2 by impact.

### 3.7 Leaked secret (§64–69)
- **Detection.** A secret in a log, a commit, a screenshot, a chat; GitHub secret scanning; the security audit
  (`scripts/secrets-exposure-check.mjs`); a provider's abuse notice.
- **Decision.** Rotate now; investigate after. Which secret decides the blast radius — `apps/api/src/common/secrets-inventory.ts`
  lists every secret, what it protects and its rotation period.
- **Steps.** Session / service-token secrets: set the new value → redeploy (every session is signed out — expected).
  Encryption keys: set `<KEY>_PREVIOUS` = old, `<KEY>` = new → redeploy; rows re-encrypt on their next write
  (`key-ring.ts`), keep `_PREVIOUS` until every backup taken under the old key has aged out (`SECURITY_DR.md`). Provider
  credentials (Twilio, SendGrid, CardPointe, Clover, OpenAI, …): rotate in the provider console, then the variable or the
  tenant's stored credential. `DATABASE_URL`: rotate the Postgres password in Railway (the reference variable updates),
  redeploy every service. `METRICS_TOKEN`, `BACKUP_REPORT_TOKEN`: new value, update the scraper / backup job.
- **Verification.** The old value is refused (sign-in with an old session fails; the provider rejects the old key);
  the security audit passes; the incident record lists what was rotated.
- **Owner.** Platform owner. P1.

### 3.8 Encryption keys lost (§68, `SECURITY_DR.md`)
- **Detection.** After a restore or a variable change: `restore-verify` reports `CANNOT DECRYPT`; salons' payment or
  Twilio connections fail with decryption errors; the boot refuses (production requires every purpose key).
- **Decision.** If the off-Railway copy exists → restore the variables from it (RTO 15 min). If not → **the data those
  keys protect cannot be recovered**: set new keys and have every affected salon re-enter its credentials.
- **Steps.** (1) Re-enter the keys from the off-Railway record → redeploy → `restore-verify`. (2) Without the record:
  generate new keys (`DEPLOY_RAILWAY.md` Step 1), deploy, and contact each salon whose `tenant_payment_config`,
  `tenant_messaging_credentials`, `merchant_funding_profiles` or MFA factors were encrypted under the lost key.
- **Verification.** `restore-verify`: every sampled encrypted column `ok`.
- **Owner.** Platform owner. P1. **Prevention is the only real fix: keep the off-Railway copy current (HOSTING).**

### 3.9 Media storage lost
- **Detection.** Images 404; `storage` runbook symptoms.
- **Decision / Steps.** With `MEDIA_STORE=s3` and bucket versioning: restore the previous object versions
  (**HOSTING**). On container disk (the default): the files are gone at every deploy — set `MEDIA_STORE=s3`
  (`MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`) before go-live; there is nothing to restore.
- **Owner.** Platform owner. P3.

## 4. Drills (§98, §148–151)

| Drill | Script | Last run | Result |
|---|---|---|---|
| Backup → restore → verify | `apps/api/scripts/drills/drill-restore.mjs` | Oct 8 2026, local | PASS |
| Worker killed mid-job | `apps/api/scripts/drills/drill-worker-loss.mjs` | Oct 8 2026, local, real 5-min lease | PASS |
| Redis killed under load | `apps/api/scripts/drills/drill-redis-loss.mjs` | Oct 8 2026 local (FAIL — §3.3 defects, fixed the same day); re-run Oct 13–14 2026 final run | **PASS 13/13** |
| PostgreSQL restart under load | `apps/api/scripts/drills/drill-db-failover.mjs` | Oct 8 2026, local | see `docs/DR_DRILLS_2026-10-08.md` |

Cadence: the restore drill **quarterly against a production backup** (the `backups` component degrades after 90 days
without one), the others before every infrastructure change (replica count, worker split, Redis or Postgres plan) and
after any fix to the code they exercise. Every drill exits non-zero on failure and prints one `DRILL <name>: PASS|FAIL`
line; each was shown to fail when its property is broken (mutation log in the Phase 11 report).

Running the restore drill against production data: restore the Railway backup into a **scratch** database first, then
`DRILL_DATABASE_URL=<scratch> DRILL_ALLOW_REMOTE=1 node apps/api/scripts/drills/drill-restore.mjs` with the production
encryption keys in the environment (it never writes to its source; it restores a second copy into `drill_restore` on the
same server and drops it). Never point any drill at the production database.

## 5. Single points of failure (§101)

| SPOF | Today | Mitigation |
|---|---|---|
| One API replica (`railway.json` `numReplicas: 1`) | an instance crash = minutes of outage until Railway restarts it | replicas ≥ 2 with `REDIS_URL` set (production-config refuses `API_REPLICAS > 1` without Redis) — **HOSTING** |
| One PostgreSQL instance | the platform stops while it is down (by design: no stale money reads) | Railway backups + PITR; HA/replica on a plan that offers it — **HOSTING** |
| Railway project / region | everything | off-site backup copy + off-Railway variable record (§3.2) — **HOSTING** |
| Encryption keys | unrecoverable credentials | off-Railway copy (§3.8) — **HOSTING** |
| Alerts run inside the API | silent when the API is down | external uptime monitor — **HOSTING** |
| The operator | one person | runbooks + this file; the break-glass switch needs no database and no code |
