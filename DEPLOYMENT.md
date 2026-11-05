# DEPLOYMENT.md
### Canonical deployment reference — Railway is the host of record (rewritten Oct 8 2026, BUILD_PLAN Phase 11; re-checked against the code Oct 10 2026, Phase 15: least-privilege DB logins and `MIGRATE_DATABASE_URL` (Phase 14) added, Phase 12–14 variables added, §6.2 regenerated)

Supersedes `DEPLOY.md` (AWS App Runner), `DEPLOY_RUNBOOK.md` (EC2 + nginx + certbot) and the earlier version of this
file; those paths are summarised in the **Legacy appendix** at the end and are not maintained. The first-deploy click
path is `DEPLOY_RAILWAY.md`; the console-only steps are `docs/HOSTING_ACTIONS_FOR_KEVIN.md`; recovery is
`DISASTER_RECOVERY.md`.

## 1. What a deployment is
- **One image, two entry points** (`Dockerfile`): `node dist/main.js` (the API) and `node dist/worker.js` (background
  jobs). Railway builds it from the repository (`railway.json` → `build.builder: DOCKERFILE`), or CD publishes it to GHCR
  with the git sha as its tag (`.github/workflows/build-image.yml`, manual dispatch with `publish: true` through the protected
  `production-image` environment) and Railway deploys that tag.
- **API service** — `railway.json`: pre-deploy `node scripts/db-preflight.mjs && node scripts/migrate.mjs`, start
  `node dist/main.js`, health check `GET /health/ready` (120 s), restart on failure (5 retries), 1 replica.
- **Worker service** — `railway.worker.json`: start `node dist/worker.js`, no HTTP health check, no migration step.
  Until Kevin creates it (`docs/HOSTING_ACTIONS_FOR_KEVIN.md` B3) the API runs every job with `PROCESS_ROLE` unset
  (= `all`). Split: `RUNBOOKS.md` → `worker-split`. `PROCESS_ROLE` is `all` | `api` | `worker` (any other value refuses
  to boot — `packages/config/src/process-role.ts`); the worker serves no HTTP and the image `HEALTHCHECK` passes for it.
- **PostgreSQL 16** (Railway) and, before a second replica, **Redis** (Railway or a managed Redis).
- **Frontends**: static builds (`npm run build:frontends` → `dist-frontends/<app>`) served by Railway static services or
  a CDN; each reads its API origin from `VITE_API_BASE` (HTML kiosk apps: `?api=` / `window.APS_API_BASE`).
- **Native shells** (customer / tech / owner / manager-pay): Capacitor builds — `MOBILE_CONVERSION_HANDOFF.md`.

## 2. A release, step by step
1. **CI** (`.github/workflows/security.yml`) on every push: build, security checks, architecture tests, every repository
   gate, unit/module/app tests, real-PostgreSQL race tests, frontend builds. **Image** (`build-image.yml`): docker build,
   Trivy image scan (fails on a fixable CRITICAL), IaC scan, SBOM artifact. A push is not a deploy.
2. **Deploy**: Railway deploys the commit (GitHub source with "Wait for CI") or the GHCR sha tag (CD dispatch, approved).
3. **Pre-deploy** (once per release, in one container, before any new replica starts): `db-preflight.mjs` (stops on an
   unreachable database, Postgres < 14, or a ledger row the code no longer knows; warns about missing extensions) then `migrate.mjs` (session advisory lock — one runner at a time; each file in its
   own transaction; ledger with checksums). Both connect with `MIGRATE_DATABASE_URL` when it is set, else `DATABASE_URL`
   (§5.1). A failure stops the release; the previous deployment keeps serving.
4. **Rollout**: new replicas start; Railway routes to them when `/health/ready` answers 200; old replicas get SIGTERM —
   readiness turns 503 at once, SSE streams drain, job loops stop claiming and finish (≤ 20 s), the pool closes.
5. **Verify**: `GET /health` shows the new `commit` and `schemaVersion` (latest applied migration, pending files,
   checksum mismatches — none expected); System Operations shows every component HEALTHY.
6. **Rollback**: Railway → Deployments → the previous one → Redeploy. Never roll a migration back automatically.

Hosts without a pre-deploy hook: set `MIGRATE_ON_START=1` (the image's `CMD` then runs preflight + migrate before the
API) and run a single replica.

## 3. Replicas and the worker split
- More than one API replica needs Redis: production refuses to boot with `API_REPLICAS > 1` or `MULTI_INSTANCE=1`
  and no `REDIS_URL` (`apps/api/src/common/production-config.ts`). Set `API_REPLICAS` to the replica count.
- Schedulers are single-owner across processes (`runTick` + `scheduler_runs` lease); the job queue and the outbox claim
  with `SKIP LOCKED`. Any number of web replicas with `PROCESS_ROLE=all`, or worker replicas, is safe
  (drill: `apps/api/scripts/drills/drill-worker-loss.mjs`).
- Worker pools: one worker service runs every class; separate pools = more worker services with `WORKER_JOB_CLASSES`
  (`critical`, `standard`, `ai`, `report`, `import`, `reconciliation`). Concurrency per class:
  `JOBS_CONCURRENCY_<CLASS>` / `JOBS_CONCURRENCY` (default 2); per-tenant cap `JOBS_PER_TENANT_CAP` (default 3).

## 4. Emergency switches (no deploy needed — a variable and a restart)
- `MAINTENANCE_BREAK_GLASS` = `off` | `read_only` | `full` (+ `MAINTENANCE_BREAK_GLASS_MESSAGE`) — works with the
  database down. `RUNBOOKS.md` → `break-glass-maintenance`.
- Kill switches (AI, SMS, booking verification, deals, CardPointe, Clover) — Super Admin, step-up + reason.
- `TENANT_RATE_LIMIT=off` disables the per-tenant limiter (on by default); `JOBS_WORKER=off` stops this process's job
  loops; `MEDIA_LIFECYCLE=off` stops the storage lifecycle job; `PAYMENT_ATTEMPT_SWEEP=off` stops the stranded-attempt sweep.

## 5. Migrations — the rules
- Forward-only, ordered files in `apps/api/db/migrations`; idempotent (`IF NOT EXISTS`); a fresh database defers nothing.
- **Expand / contract** (decided Oct 8 2026): a release may only ADD (tables, nullable columns or columns with defaults,
  indexes `CONCURRENTLY`, new enum values) and backfill; code that stops using a column ships first, and the DROP /
  `NOT NULL` / rename ships in a LATER release. This is what lets the previous image run on the newer schema, so a
  rollback is always an application redeploy.
- Long backfills run as jobs, not in the migration (`MIGRATE_STATEMENT_TIMEOUT_MS` bounds a transactional migration;
  `MIGRATE_LOCK_TIMEOUT_MS`, default 30 s, makes a migration that waits on a busy table give up instead of queueing
  every request behind it).

### 5.1 Database logins — least privilege (BUILD_PLAN Phase 14, Constitution 12)
Three logins, created by `apps/api/scripts/db-provision-roles.mjs` (`--dry-run` / `--write` / `--check`; idempotent;
SQL in `apps/api/db/roles/`): the database OWNER (Railway's default user — DDL; used only by the pre-deploy step),
`aps_api` (rows only — no DDL, TRUNCATE, REFERENCES, TRIGGER) and `aps_worker` (only the tables the job worker touches,
some column-level; grants generated into `apps/api/db/roles/03_worker_grants.generated.sql`).

| Variable | Service | Value |
|---|---|---|
| `MIGRATE_DATABASE_URL` | API (pre-deploy step) | the OWNER's URL — read only by `migrate.mjs` / `db-preflight.mjs`; unset = `DATABASE_URL` |
| `DATABASE_URL` | API, worker | `aps_api` on the `*.railway.internal` host |
| `PG_WORKER_DATABASE_URL` | worker (and the API while it runs jobs) | `aps_worker` |

Until Kevin runs the provisioning (`docs/HOSTING_ACTIONS_FOR_KEVIN.md` D1) every service uses the one owner URL, as
before. Re-run the script after any deploy that changes `03_worker_grants.generated.sql`. Proof:
`apps/api/src/common/worker-role.postgres-race.vitest.spec.ts` (race lane).

## 6. Environment variables
The full list is in the table below (§6.2), generated from the code. Secrets are set in Railway Variables (shared
variables for values both services need); the repository ships no values. `SECRETS_REQUIRED.md` says which values only
the owner can provide; `apps/api/src/common/secrets-inventory.ts` classifies every secret (and its spec fails when a
secret-like name is missing from it); `.env.production.template` marks REQUIRED / SECRET / SET-FOR-PROD.

### 6.1 Added in BUILD_PLAN Phases 10–11
| Name | Purpose | Default |
|---|---|---|
| `PG_CONNECT_TIMEOUT_MS`, `PG_IDLE_TIMEOUT_MS` | pool connect / idle timeouts | 10 000 / 30 000 |
| `PG_STATEMENT_TIMEOUT_MS`, `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS` | primary-pool timeouts (0 = off) | by `PROCESS_ROLE`: api 30 s/30 s, all 120 s/60 s |
| `PG_WORKER_POOL_MAX`, `PG_WORKER_DATABASE_URL`, `PG_WORKER_STATEMENT_TIMEOUT_MS`, `PG_WORKER_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `PG_WORKER_APPLICATION_NAME` | the job worker's own pool | 5 connections; 600 s / 120 s |
| `PG_APPLICATION_NAME`, `PG_READ_POOL_MAX` | connection naming; replica pool size | `aipowersalon-<role>` / `PG_POOL_MAX` |
| `MIGRATE_ON_START` | run preflight + migrate in the container `CMD` (hosts without a pre-deploy hook) | unset |
| `MIGRATE_LOCK_TIMEOUT_MS`, `MIGRATE_STATEMENT_TIMEOUT_MS` | migration runner limits | 30 000 / 0 |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_SAMPLER_ARG` | distributed tracing (off without the endpoint) | —, —, `aipowersalon-<PROCESS_ROLE>`, 1 |
| `METRICS_TOKEN` | bearer for `GET /metrics` (404 in production when unset) | unset |
| `MAINTENANCE_BREAK_GLASS`, `MAINTENANCE_BREAK_GLASS_MESSAGE` | environment maintenance switch | `off` |
| `TENANT_RATE_LIMIT` | `off` disables the per-tenant limiter | on |
| `API_REPLICAS`, `MULTI_INSTANCE` | declare a multi-instance deploy (then `REDIS_URL` is required) | unset |
| `PAYMENT_ATTEMPT_STRANDED_MINUTES` | age at which a `processing` card attempt is swept (min 5) | 15 |
| `PAYMENT_ATTEMPT_SWEEP` | `off` stops the stranded-attempt sweep (`payments.stranded_attempts`) | on |
| `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION` (falls back to `AWS_REGION`), `MEDIA_ENV`, `MEDIA_LIFECYCLE` | media storage (required with `MEDIA_STORE=s3` in production); lifecycle job switch | — |
| `JOBS_WORKER`, `JOBS_CONCURRENCY`, `JOBS_CONCURRENCY_<CLASS>`, `JOBS_PER_TENANT_CAP`, `JOBS_IDLE_POLL_MS` | job worker loops | on, 2, 2, 3, 2000 |
| `FEATURE_FLAG_*` | unchanged | — |

### 6.1b Added in BUILD_PLAN Phases 12–14
| Name | Purpose | Default |
|---|---|---|
| `MIGRATE_DATABASE_URL` | owner URL for the pre-deploy migration (§5.1) | `DATABASE_URL` |
| `FEATURE_ENTITLEMENT_ENFORCEMENT` | plan-feature guard; `enforce` answers 403 `FEATURE_NOT_IN_PLAN` (platform staff never gated) | not enforcing |
| `PRIVATE_FILES_ROOT`, `PRIVATE_S3_BUCKET`, `PRIVATE_S3_PREFIX` | private file store (exports, attachments); with `MEDIA_STORE=s3` objects go to `PRIVATE_S3_BUCKET` | `MEDIA_S3_BUCKET` under `private/` |
| `REDIS_COMMAND_TIMEOUT_MS` | a Redis request/response command gives up after this | 500 |
| `APPLE_TEAM_ID` | serves `/.well-known/apple-app-site-association` (404 without it) | unset |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`, `CLAMAV_REQUIRED` | upload malware scan through clamd (HOSTING D2); `CLAMAV_REQUIRED=1` refuses uploads while the scanner is down | off; 3310; 15 000; accepted as `unscanned` |
| `TELEMETRY_STORE`, `TELEMETRY_LOG_SAMPLE`, `TELEMETRY_TRACE_SAMPLE`, `TELEMETRY_STORE_MAX_ROWS_PER_MIN`, `TELEMETRY_STORE_RETENTION_DAYS` | Postgres-backed log / trace store (`off` disables) | on; 0.1; 0.1; 3 000; 14 |
| `SLO_VALIDATION_MIN_DAYS`, `SLO_VALIDATION_MIN_REQUESTS` | minimum traffic before an SLO counts as validated | 28 days |
| `BACKUP_REPORTS_REQUIRED` | `1` = backup reports are expected, so silence alerts from day one | unset |
| `RELEASE_NOTES_URL` | link on the deployments dashboard | unset |
| `ALERT_ACK_SECRET` | signs the one-time alert-acknowledge links | HKDF of `AUTH_SESSION_SECRET` |
| `SYNTHETIC_PAYMENT_SANDBOX_URL`, `_MERCHID`, `_USER`, `_PASSWORD`; `TWILIO_TEST_ACCOUNT_SID`, `TWILIO_TEST_AUTH_TOKEN` | provider-sandbox synthetic probes (HOSTING D4; a non-UAT host is refused) | probe skipped |

`SYNTHETIC_KIOSK_SLUG` (in the Oct 8 list) is no longer read: the synthetic test salon is designated in Super Admin →
On-call → Synthetic (HOSTING D3).

### 6.2 Every variable the server code reads
317 names read by non-test server code (apps/api/src, packages/*/src except the test harness, modules/*/src), plus the
encryption keys the key ring reads by computed name. "Secret": `yes` = listed in `SECRETS` of
`apps/api/src/common/secrets-inventory.ts`; `likely` = the name matches its `SECRET_NAME_PATTERN` but the inventory does
not list it (review — none on Oct 10 2026); blank = configuration.

| Name | Secret | Read in |
|---|---|---|
| `ADMIN_BASE_URL` |  | `packages/config` |
| `AI_BILLING_WEBHOOK_SCHEME` |  | `modules/ai`, `modules/super-admin` |
| `AI_BILLING_WEBHOOK_SECRET` | yes | `modules/ai`, `modules/super-admin` |
| `AI_BOOKING_LINK_SECRET` | yes | `apps/api/ai-booking` |
| `AI_CUSTOMER_PROFILE_SCAN_ENABLED` |  | `modules/ai` |
| `AI_CUSTOMER_PROFILE_SCAN_INTERVAL_MS` |  | `modules/ai` |
| `AI_CUSTOMER_PROFILE_SCAN_TENANTS_PER_TICK` |  | `modules/ai` |
| `AI_DEFAULT_MODEL` |  | `modules/ai` |
| `AI_DEFAULT_PROVIDER` |  | `modules/ai` |
| `AI_ENTITLEMENT_ENFORCEMENT` |  | `modules/ai` |
| `AI_MARKETING_SEND_SWEEP_ENABLED` |  | `modules/ai` |
| `AI_MARKETING_SEND_SWEEP_INTERVAL_MS` |  | `modules/ai` |
| `AI_MARKETING_SEND_SWEEP_MAX_PER_TENANT` |  | `modules/ai` |
| `AI_MARKETING_SEND_SWEEP_MAX_TOTAL` |  | `modules/ai` |
| `AI_MAX_TOKENS` |  | `modules/ai` |
| `AI_MONEY_PROTECTION_AI_SUMMARIES_ENABLED` |  | `modules/ai` |
| `AI_MONEY_PROTECTION_AUTO_DUP_PREVENTION_ENABLED` |  | `modules/ai` |
| `AI_MONEY_PROTECTION_BASELINES_ENABLED` |  | `modules/ai` |
| `AI_MONEY_PROTECTION_DETERMINISTIC_ENABLED` |  | `modules/ai` |
| `AI_MONEY_PROTECTION_ENABLED` |  | `modules/ai` |
| `AI_MONEY_PROTECTION_RECONCILIATION_ENABLED` |  | `modules/ai` |
| `AI_PROVIDER_KEK` | yes | `apps/api/common` |
| `AI_QUEUE_OPS_JOBS` |  | `modules/ai` |
| `AI_RECEPTIONIST_VOICE_WEBHOOK_URL` |  | `modules/ai` |
| `AI_SCHEDULING_JOBS` |  | `modules/ai` |
| `AI_TIMEOUT_MS` |  | `modules/ai` |
| `AI_TRIAL_SWEEP_CRON_ENABLED` |  | `modules/ai` |
| `ALERT_ACK_SECRET` | yes | `apps/api/observability` |
| `ANTHROPIC_API_KEY` | yes | `modules/ai` |
| `API_LEGACY_SUNSET` |  | `apps/api/common` |
| `API_REPLICAS` |  | `apps/api/common` |
| `APNS_ENV` |  | `modules/communications` |
| `APNS_KEY_ID` | yes | `modules/communications` |
| `APNS_KEY_P8` | yes | `modules/communications` |
| `APNS_KEY_P8_B64` | yes | `modules/communications` |
| `APNS_TEAM_ID` |  | `modules/communications` |
| `APNS_TOPIC` |  | `modules/communications` |
| `APNS_TOPIC_CUSTOMER` |  | `modules/communications` |
| `APNS_TOPIC_MANAGER` |  | `modules/communications` |
| `APNS_TOPIC_OWNER` |  | `modules/communications` |
| `APNS_TOPIC_POS` |  | `modules/communications` |
| `APNS_TOPIC_TECH` |  | `modules/communications` |
| `APPLE_TEAM_ID` |  | `apps/api/mobile-links` |
| `APPROVALS_JOBS` |  | `modules/workforce` |
| `APP_BASE_URL` |  | `modules/communications`, `packages/config` |
| `APP_DATA_ENCRYPTION_KEY` | yes | `modules/super-admin` |
| `APP_VERSION` |  | `modules/tenants`, `packages/observability` |
| `APS_API_BASE` |  | `apps/api/observability`, `modules/ai`, `modules/communications` |
| `AUTHZ_DORMANT_ALERTS` |  | `modules/workforce` |
| `AUTHZ_OVERRIDE_SWEEP` |  | `modules/workforce` |
| `AUTH_ACCESS_TTL` |  | `modules/identity` |
| `AUTH_SESSION_SECRET` | yes | `apps/api/common`, `apps/api/mobile-config`, `apps/api/observability` +6 |
| `AUTH_SESSION_TTL` |  | `modules/booking`, `modules/identity`, `modules/tenants` +2 |
| `AUTH_SESSION_TTL_REMEMBER` |  | `packages/auth` |
| `AUTH_SESSION_TTL_SUPER_ADMIN` |  | `packages/auth` |
| `AUTOMATION_SCHEDULER_CRON_ENABLED` |  | `modules/platform` |
| `AWS_REGION` |  | `modules/safety`, `packages/media` |
| `BACKUP_MAX_AGE_HOURS` |  | `apps/api/observability` |
| `BACKUP_REPORTS_REQUIRED` |  | `apps/api/observability` |
| `BACKUP_REPORT_TOKEN` | yes | `apps/api/observability` |
| `BILLING_CYCLE_WORKER_ENABLED` |  | `modules/super-admin` |
| `BILLING_EXPORT_WORKER_ENABLED` |  | `modules/super-admin` |
| `BOOKING_BUFFER_MINUTES` |  | `modules/booking` |
| `BOOKING_CLOSE` |  | `modules/booking` |
| `BOOKING_HOLD_SWEEP_CRON_ENABLED` |  | `modules/booking` |
| `BOOKING_OPEN` |  | `modules/booking` |
| `BOOKING_SLOT_MINUTES` |  | `modules/booking` |
| `BOOKING_VERIFICATION_RETENTION_CRON_ENABLED` |  | `modules/booking` |
| `BOOKING_VERIFICATION_RETENTION_DAYS` |  | `modules/booking` |
| `BRANDING_ALLOW_LOGO_REPLACE` |  | `modules/tenants` |
| `BRAND_EMAIL_LOGO_URL` |  | `modules/tenants` |
| `CACHE_PREFIX` |  | `modules/ai`, `modules/checkout`, `packages/cache` |
| `CACHE_REDIS_URL` | yes | `apps/api/common` |
| `CACHE_STORE` |  | `apps/api/common` |
| `CAPTCHA_PROVIDER` |  | `modules/booking` |
| `CAPTCHA_SECRET_KEY` | yes | `modules/booking` |
| `CAPTCHA_SITE_KEY` |  | `modules/booking` |
| `CARDPOINTE_BASE_URL` |  | `modules/payments` |
| `CARDPOINTE_CURRENCY` |  | `modules/payments` |
| `CARDPOINTE_MERCHID` |  | `modules/payments` |
| `CARDPOINTE_PASSWORD` | yes | `modules/payments` |
| `CARDPOINTE_SITE` |  | `modules/payments` |
| `CARDPOINTE_USERNAME` |  | `modules/payments` |
| `CLAMAV_HOST` |  | `packages/media` |
| `CLAMAV_PORT` |  | `packages/media` |
| `CLAMAV_REQUIRED` |  | `packages/media` |
| `CLAMAV_TIMEOUT_MS` |  | `packages/media` |
| `COMMERCEHUB_BASE_URL` |  | `modules/payments` |
| `COMMERCEHUB_TTP_API_KEY` | yes | `modules/checkout`, `modules/payments` |
| `COMMERCEHUB_TTP_API_SECRET` | yes | `modules/checkout`, `modules/payments` |
| `COMMERCEHUB_TTP_APPLE_MERCHANT_ID` |  | `modules/checkout` |
| `COMMERCEHUB_TTP_CURRENCY` |  | `modules/checkout`, `modules/payments` |
| `COMMERCEHUB_TTP_ENV` |  | `modules/checkout` |
| `COMMERCEHUB_TTP_MERCHANT_ID` |  | `modules/checkout`, `modules/payments` |
| `COMMERCEHUB_TTP_TERMINAL_PROFILE_ID` |  | `modules/checkout`, `modules/payments` |
| `COMMIT_SHA` |  | `packages/observability` |
| `COMMUNITY_JOBS` |  | `modules/safety` |
| `COMMUNITY_RISK_POLICY_REF` |  | `modules/safety` |
| `COMMUNITY_RISK_SALT` |  | `modules/safety` |
| `CUSTOMER_IMPORT_WORKER_ENABLED` |  | `modules/super-admin` |
| `CUSTOMER_PHONE_SYNC_CRON_ENABLED` |  | `modules/booking` |
| `CUSTOMER_SYNC_WORKER_ENABLED` |  | `modules/customers` |
| `DATABASE_REPLICA_URL` |  | `modules/super-admin`, `packages/database` |
| `DATABASE_SIZE_SNAPSHOT_JOB` |  | `modules/super-admin` |
| `DATABASE_SLOW_QUERY_FLUSH` |  | `modules/super-admin` |
| `DATABASE_URL` | yes | `apps/api/common`, `modules/identity`, `packages/database` |
| `DB_ACTOR_STAMP` |  | `packages/database` |
| `DB_SLOW_QUERY_MS` |  | `packages/observability` |
| `DB_TENANT_RLS` |  | `packages/database` |
| `DB_TENANT_RLS_SCOPE` |  | `packages/database` |
| `DB_TENANT_RLS_STRICT` |  | `packages/database` |
| `DEALS_LIFECYCLE_ENABLED` |  | `modules/deals` |
| `DEFAULT_NEARBY_RADIUS_MILES` |  | `modules/customers` |
| `ENABLE_GOOGLE_NEARBY_SALON_SEARCH` |  | `modules/customers` |
| `EVENT_PUBLISHER_ENABLED` |  | `packages/config` |
| `EVIDENCE_S3_BUCKET` |  | `modules/safety` |
| `EVIDENCE_S3_ENDPOINT` |  | `modules/safety` |
| `EVIDENCE_S3_FORCE_PATH_STYLE` |  | `modules/safety` |
| `EVIDENCE_S3_PREFIX` |  | `modules/safety` |
| `EVIDENCE_S3_REGION` |  | `modules/safety` |
| `EVIDENCE_SCAN_ENABLED` |  | `modules/safety` |
| `EVIDENCE_SCAN_TAG_KEY` | yes | `modules/safety` |
| `FACE_ID_ENABLED` |  | `modules/identity` |
| `FCM_SERVER_KEY` | yes | `modules/communications` |
| `FCM_SERVICE_ACCOUNT_B64` |  | `modules/communications` |
| `FCM_SERVICE_ACCOUNT_JSON` |  | `modules/communications` |
| `FEATURE_ENTITLEMENT_ENFORCEMENT` |  | `packages/permissions` |
| `FISERV_MERCHANT_ID` |  | `modules/tenants` |
| `FISERV_RESIDUAL_AUTH` |  | `modules/payments` |
| `FISERV_RESIDUAL_URL` |  | `modules/payments` |
| `FISERV_SECRET` | yes | `modules/tenants` |
| `FOLLOWUP_PURGE_AFTER_DAYS` |  | `modules/communications` |
| `FOLLOWUP_SCHEDULER_DISABLED` |  | `modules/communications` |
| `FOLLOWUP_SCHEDULER_INTERVAL_MS` |  | `modules/communications` |
| `FUNDING_VAULT_KEK` | yes | `apps/api/common` |
| `GEMINI_API_KEY` | yes | `modules/ai` |
| `GIT_SHA` |  | `packages/observability` |
| `GOOGLE_MAPS_DEFAULT_COUNTRY` |  | `modules/tenants` |
| `GOOGLE_MAPS_SERVER_API_KEY` | yes | `modules/tenants` |
| `GOOGLE_PLACES_API_KEY` | yes | `modules/customers` |
| `GO_CHECKIN_TOKEN_TTL_DAYS` |  | `modules/queue` |
| `HARDWARE_PAYMENT_CRON_ENABLED` |  | `modules/payments` |
| `HARDWARE_PAYMENT_CRON_SECRET` | yes | `modules/payments` |
| `HOSTNAME` |  | `apps/api/observability`, `packages/config` |
| `INVITE_NOTIFIER_URL` |  | `modules/communications`, `modules/identity`, `modules/super-admin` |
| `JOBS_CONCURRENCY` |  | `apps/api/jobs` |
| `JOBS_IDLE_POLL_MS` |  | `apps/api/jobs` |
| `JOBS_PER_TENANT_CAP` |  | `apps/api/common`, `apps/api/jobs` |
| `JOBS_SECRET` | yes | `modules/communications` |
| `JOBS_WORKER` |  | `apps/api/jobs` |
| `LOGIN_THROTTLE_PREFIX` |  | `modules/identity` |
| `LOGIN_THROTTLE_REDIS_URL` | yes | `modules/identity` |
| `LOGIN_THROTTLE_STORE` |  | `modules/identity` |
| `LOG_LEVEL` |  | `packages/observability` |
| `LOYALTY_RECONCILE_CRON_ENABLED` |  | `modules/customers` |
| `LOYALTY_TIERS_JSON` |  | `apps/api/customer` |
| `MAINTENANCE_BREAK_GLASS` |  | `apps/api/common` |
| `MAINTENANCE_BREAK_GLASS_MESSAGE` |  | `apps/api/common` |
| `MAX_BODY_SIZE` |  | `apps/api/main.ts` |
| `MAX_NEARBY_RADIUS_MILES` |  | `modules/customers` |
| `MEDIA_CDN_BASE_URL` |  | `packages/media` |
| `MEDIA_ENV` |  | `packages/media` |
| `MEDIA_LIFECYCLE` |  | `apps/api/media` |
| `MEDIA_LIVE_IMAGE_BASE` |  | `packages/media` |
| `MEDIA_ROOT` |  | `apps/api/common`, `packages/media` |
| `MEDIA_S3_BUCKET` |  | `packages/media` |
| `MEDIA_S3_ENDPOINT` |  | `packages/media` |
| `MEDIA_S3_FOLDER_DOCS` |  | `packages/media` |
| `MEDIA_S3_FOLDER_IMAGES` |  | `packages/media` |
| `MEDIA_S3_FOLDER_OTHER` |  | `packages/media` |
| `MEDIA_S3_FORCE_PATH_STYLE` |  | `packages/media` |
| `MEDIA_S3_PREFIX` |  | `packages/media` |
| `MEDIA_S3_REGION` |  | `packages/media` |
| `MEDIA_STORE` |  | `apps/api/common`, `packages/media` |
| `MEMBERSHIP_AUTOBILL_ENABLED` |  | `modules/memberships` |
| `MEMBERSHIP_BILLING_SECRET` | yes | `modules/memberships` |
| `MEMBERSHIP_RENEWALS_CRON_ENABLED` |  | `modules/memberships` (set `1` in production: hourly renewal reminders + due renewals; charging also needs `MEMBERSHIP_AUTOBILL_ENABLED`) |
| `METRICS_TOKEN` | yes | `apps/api/health` |
| `MFA_ENC_KEY` | yes | `modules/super-admin` |
| `MFA_REQUIRE_TOTP` |  | `packages/auth` |
| `MIGRATIONS_DIR` |  | `apps/api/observability` |
| `MOBILE_PAY_MIN_APP_VERSION` |  | `modules/checkout` — DEPRECATED (Phase 13): set the manager-pay minimum in Super Admin → System Operations → Mobile app versions; this is read only while no policy row exists |
| `MULTI_INSTANCE` |  | `apps/api/common` |
| `NATIVE_APP_ORIGINS` |  | `modules/identity` |
| `NODE_ENV` |  | `apps/api/common`, `apps/api/health`, `apps/api/jobs` +19 |
| `OCR_COST_MICRO_USD_PER_PAGE` |  | `modules/safety` |
| `OCR_TEXTRACT_ENABLED` |  | `modules/safety` |
| `OCR_TEXTRACT_REGION` |  | `modules/safety` |
| `ONCALL_EMAIL` |  | `apps/api/observability` |
| `ONCALL_PHONE` |  | `apps/api/observability` |
| `OPENAI_API_KEY` | yes | `modules/ai` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` |  | `packages/observability` |
| `OTEL_EXPORTER_OTLP_HEADERS` | yes | `packages/observability` |
| `OTEL_SERVICE_NAME` |  | `packages/observability` |
| `OTEL_TRACES_SAMPLER_ARG` |  | `packages/observability` |
| `OVERVIEW_SNAPSHOT_CRON_ENABLED` |  | `modules/super-admin` |
| `PAYMENTS_ALLOW_ENV_FALLBACK` |  | `modules/checkout`, `modules/payments` |
| `PAYMENTS_SANDBOX` |  | `modules/checkout`, `modules/payments`, `modules/super-admin` |
| `PAYMENTS_WEBHOOK_RAW_BODY` |  | `modules/payments` |
| `PAYMENT_ATTEMPT_STRANDED_MINUTES` |  | `modules/checkout` |
| `PAYMENT_ATTEMPT_SWEEP` |  | `modules/checkout` |
| `PAYMENT_ENC_KEY` | yes | `apps/api/common (key-ring / computed name)` |
| `PG_APPLICATION_NAME` |  | `packages/database` |
| `PG_CONNECT_TIMEOUT_MS` |  | `packages/database` |
| `PG_IDLE_IN_TRANSACTION_TIMEOUT_MS` |  | `packages/database` |
| `PG_IDLE_TIMEOUT_MS` |  | `packages/database` |
| `PG_POOL_MAX` |  | `packages/database` |
| `PG_READ_POOL_MAX` |  | `packages/database` |
| `PG_STATEMENT_TIMEOUT_MS` |  | `packages/database` |
| `PG_WORKER_APPLICATION_NAME` |  | `packages/database` |
| `PG_WORKER_DATABASE_URL` | yes | `packages/database` |
| `PG_WORKER_IDLE_IN_TRANSACTION_TIMEOUT_MS` |  | `packages/database` |
| `PG_WORKER_POOL_MAX` |  | `packages/database` |
| `PG_WORKER_STATEMENT_TIMEOUT_MS` |  | `packages/database` |
| `PLAN_PRICES_JSON` |  | `modules/super-admin` |
| `PLATFORM_HOME_COUNTRY_CODE` |  | `modules/booking` |
| `PLATFORM_TIMEZONE` |  | `modules/customers` |
| `PORT` |  | `apps/api/main.ts` |
| `PRIVATE_FILES_ROOT` |  | `packages/media` |
| `PRIVATE_S3_BUCKET` |  | `packages/media` |
| `PRIVATE_S3_PREFIX` |  | `packages/media` |
| `PROCESS_ROLE` |  | `apps/api/common`, `apps/api/main.ts`, `apps/api/worker.ts` +3 |
| `PROVIDER_VAULT_KEK` | yes | `apps/api/common`, `modules/communications` |
| `PUBLIC_API_BASE_URL` |  | `apps/api/observability`, `modules/ai`, `modules/communications` |
| `PUBLIC_APP_URL` |  | `packages/config` |
| `PUBLIC_BOOKING_BASE_URL` |  | `apps/api/ai-booking` |
| `PUBLIC_CUSTOMER_BASE_URL` |  | `apps/api/customer`, `modules/ai` |
| `QA_RESERVATION_BUFFER_MIN` |  | `modules/ai` |
| `RAILWAY_DEPLOYMENT_ID` |  | `packages/observability` |
| `RAILWAY_ENVIRONMENT_NAME` |  | `packages/observability` |
| `RAILWAY_GIT_COMMIT_SHA` |  | `packages/observability` |
| `RAILWAY_PUBLIC_DOMAIN` |  | `apps/api/observability` |
| `RAILWAY_REPLICA_ID` |  | `apps/api/observability`, `packages/config` |
| `RATE_LIMIT_MAX_PER_TENANT` |  | `apps/api/common` |
| `RATE_LIMIT_REDIS_URL` | yes | `apps/api/common` |
| `RATE_LIMIT_STORE` |  | `apps/api/common` |
| `RATE_LIMIT_WINDOW_MS` |  | `apps/api/common` |
| `REALTIME_BUS` |  | `apps/api/observability`, `apps/api/realtime` |
| `REALTIME_CHANNEL` |  | `apps/api/realtime` |
| `REALTIME_REDIS_URL` | yes | `apps/api/realtime`, `apps/api/super-admin-system-status` |
| `RECEIPTS_EMAIL_ENABLED` |  | `modules/checkout` |
| `RECEIPTS_SMS_ENABLED` |  | `modules/checkout` |
| `RECON_SWEEP_ENABLED` |  | `modules/payments` |
| `RECON_SWEEP_INTERVAL_MS` |  | `modules/payments` |
| `REDIS_COMMAND_TIMEOUT_MS` |  | `packages/cache` |
| `REDIS_URL` | yes | `apps/api/common`, `apps/api/observability`, `apps/api/realtime` +4 |
| `REFUND_CASH_MANAGER_THRESHOLD_CENTS` |  | `modules/checkout`, `modules/workforce` |
| `REFUND_MANAGER_THRESHOLD_CENTS` |  | `modules/checkout`, `modules/workforce` |
| `RELEASE_NOTES_URL` |  | `apps/api/observability` |
| `REMINDERS_DEFAULT_TZ` |  | `modules/communications` |
| `REPORTS_NOTIFIER_URL` |  | `modules/super-admin` |
| `REPO_DRIVER` |  | `apps/api/common`, `modules/identity`, `packages/database` |
| `RETELL_API_BASE_URL` |  | `modules/ai` |
| `RETELL_API_KEY` | yes | `apps/api/common`, `modules/ai` |
| `RETELL_DEFAULT_VOICE_ID` |  | `modules/ai` |
| `RETELL_WEBHOOK_SIGNING_KEY` | yes | `apps/api/common`, `modules/ai` |
| `RETENTION_EXECUTOR` |  | `modules/super-admin` |
| `RETENTION_POLICY_FILE` |  | `apps/api/media`, `modules/super-admin` |
| `SCHEDULED_REPORTS_CRON_SECRET` | yes | `modules/super-admin` |
| `SECURITY_AUDIT_WORKER_ENABLED` |  | `modules/super-admin` |
| `SENDGRID_API_KEY` | yes | `modules/communications`, `packages/notifications` |
| `SENDGRID_FROM` |  | `packages/notifications` |
| `SERVICE_NAME` |  | `packages/observability` |
| `SERVICE_TOKEN_SECRET` | yes | `apps/api/main.ts`, `packages/auth` |
| `SLA_BREACH_NOTIFY` |  | `modules/support` |
| `SLA_BREACH_SWEEP_CRON` |  | `modules/support` |
| `SLO_VALIDATION_MIN_DAYS` |  | `apps/api/observability` |
| `SLO_VALIDATION_MIN_REQUESTS` |  | `apps/api/observability` |
| `SMS_RECON_WORKER_ENABLED` |  | `modules/communications` |
| `SUMMARIES_DAILY_CRON_ENABLED` |  | `modules/super-admin` |
| `SUPPORT_ATTACHMENTS_ROOT` |  | `packages/media` |
| `SYNTHETIC_BASE_URL` |  | `apps/api/observability` |
| `SYNTHETIC_PAYMENT_SANDBOX_MERCHID` |  | `apps/api/observability` |
| `SYNTHETIC_PAYMENT_SANDBOX_PASSWORD` | yes | `apps/api/observability` |
| `SYNTHETIC_PAYMENT_SANDBOX_URL` |  | `apps/api/observability` |
| `SYNTHETIC_PAYMENT_SANDBOX_USER` |  | `apps/api/observability` |
| `TECH_ACCEPTANCE_SCHEDULER_DISABLED` |  | `modules/queue` |
| `TECH_ACCEPTANCE_SCHEDULER_INTERVAL_MS` |  | `modules/queue` |
| `TECH_ACCEPTANCE_TIMEOUT_SECONDS` |  | `modules/queue` |
| `TELEMETRY_LOG_SAMPLE` |  | `packages/observability` |
| `TELEMETRY_STORE` |  | `packages/observability` |
| `TELEMETRY_STORE_MAX_ROWS_PER_MIN` |  | `packages/observability` |
| `TELEMETRY_STORE_RETENTION_DAYS` |  | `packages/observability` |
| `TELEMETRY_TRACE_SAMPLE` |  | `packages/observability` |
| `TENANT_RATE_LIMIT` |  | `apps/api/common` |
| `TENANT_RATE_LIMIT_GUARD_DISABLED` |  | `apps/api/common` |
| `TENANT_WARNING_DISPATCH_CRON_ENABLED` |  | `modules/super-admin` |
| `TENANT_WARNING_DISPATCH_CRON_SECRET` | yes | `modules/super-admin` |
| `TICKET_DELETION_ENC_KEY` | yes | `apps/api/common (key-ring / computed name)` |
| `TRUST_PROXY_HOPS` |  | `packages/config` |
| `TWILIO_A2P_POLICY_SID` | yes | `modules/communications` |
| `TWILIO_ACCOUNT_SID` | yes | `apps/api/observability`, `modules/ai`, `modules/communications` +1 |
| `TWILIO_AGENT_MEDIA_CHANNEL` |  | `modules/ai` |
| `TWILIO_AUTH_TOKEN` | yes | `modules/ai`, `modules/communications`, `modules/super-admin` |
| `TWILIO_FROM` |  | `modules/communications` |
| `TWILIO_INTELLIGENCE_BASE_URL` |  | `modules/ai` |
| `TWILIO_ISV_EMAIL` |  | `modules/communications` |
| `TWILIO_PRIMARY_PROFILE_SID` | yes | `modules/communications` |
| `TWILIO_SECONDARY_PROFILE_POLICY_SID` | yes | `modules/communications` |
| `TWILIO_STATUS_CALLBACK_URL` |  | `modules/communications`, `packages/notifications` |
| `TWILIO_TEST_ACCOUNT_SID` | yes | `apps/api/observability` |
| `TWILIO_TEST_AUTH_TOKEN` | yes | `apps/api/observability` |
| `TWILIO_VERIFY_BASE_URL` |  | `packages/notifications` |
| `TZ` |  | `apps/api/common` |
| `VITE_LIVE_IMAGE_BASE` |  | `packages/media` |
| `VOICE_GATEWAY_READ_LIMIT_PER_MIN` |  | `modules/ai` |
| `VOICE_GATEWAY_WRITE_LIMIT_PER_MIN` |  | `modules/ai` |
| `VOICE_RETAIN_RAW_TRANSCRIPT` |  | `modules/ai` |
| `VOICE_RETENTION_SWEEP_CRON_ENABLED` |  | `modules/ai` |
| `VOICE_TRANSCRIPTION_PROVIDER` |  | `modules/ai` |
| `VOICE_TRANSCRIPT_RETENTION_DAYS` |  | `modules/ai` |
| `VOICE_VERIFICATION_MODE` |  | `modules/ai` |
| `VOICE_WRITE_TOOLS_ENABLED` |  | `modules/ai` |
| `WEBAUTHN_ORIGIN` |  | `modules/identity` |
| `WEBAUTHN_RP_ID` |  | `modules/identity` |
| `WEBHOOK_SIGNING_KEK` | yes | `apps/api/common` |
| `WEB_CORS_ORIGINS` |  | `apps/api/common`, `modules/identity`, `modules/super-admin` +1 |
| `WORKER_JOB_CLASSES` |  | `packages/config` |

### 6.3 How §6.2 is produced
Regenerated on Oct 10 2026 (BUILD_PLAN Phase 15; first generated Oct 8, Phase 11) by scanning every non-test `.ts`/`.mjs`/`.js` file under
`apps/api/src`, `packages/*/src` and `modules/*/src` for `process.env.NAME`, `process.env['NAME']` and `env.NAME` (the
injected-environment form). Names only — never values. Dynamic names are not captured: `JOBS_CONCURRENCY_<CLASS>`
(`apps/api/src/jobs/job-worker.ts`), `FEATURE_FLAG_*`, the `<KEY>_PREVIOUS` rotation twin of each encryption key
(`apps/api/src/common/key-ring.ts`; the keys themselves are taken from the secrets inventory). Variables read only by scripts (`BACKUP_REPORT_URL`, `DRILL_*`, `MIGRATE_ON_START`,
`MIGRATE_*` — `MIGRATE_DATABASE_URL` is in §5.1 —, `PROVISION_DATABASE_URL`, `APS_*_PASSWORD`, `PREFLIGHT_*`) and the frontends' `VITE_*` build variables are documented where they are used. Railway sets
`RAILWAY_*` itself.

## 7. Frontends
`VITE_API_BASE=https://<api-domain> npm run build:frontends`, one static service (or CDN bucket) per app from
`dist-frontends/<app>`; add every app origin to `WEB_CORS_ORIGINS`. Same-origin serving (no CORS) is also supported
(`DEPLOY_RAILWAY.md` Step 5).

---

## Legacy appendix (not maintained — kept so old notes still make sense)
- **AWS App Runner + RDS + S3/CloudFront** (`DEPLOY.md`): the pilot path before Railway. Health check `/health`.
- **EC2 + nginx + certbot** (`DEPLOY_RUNBOOK.md`; `deploy/terraform/main.tf` provisions the EC2/RDS/S3 for it):
  nginx proxied 443 → 127.0.0.1:3000, certbot issued the certificate. `deploy/terraform` is marked LEGACY
  (`deploy/terraform/README.md`) and is not applied.
- **Container-start migrations**: until Phase 11 both `railway.json` `startCommand` and the image `CMD` ran
  `migrate.mjs` on every start; now the pre-deploy step does (`MIGRATE_ON_START=1` keeps the old behaviour).
- **Per-feature worker flags** from the previous version of this file still exist and still gate their schedulers:
  `SECURITY_AUDIT_WORKER_ENABLED`, `CUSTOMER_SYNC_WORKER_ENABLED`, `CUSTOMER_IMPORT_WORKER_ENABLED`,
  `SMS_RECON_WORKER_ENABLED`, `BILLING_CYCLE_WORKER_ENABLED`, `BILLING_EXPORT_WORKER_ENABLED` — they are now ALSO subject
  to `PROCESS_ROLE` / `WORKER_JOB_CLASSES` and the single-owner lease.
- The previous version's "no hosting environment exists yet" list is replaced by `docs/HOSTING_ACTIONS_FOR_KEVIN.md`.
