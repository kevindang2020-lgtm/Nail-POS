# Constitution 4 — Infrastructure (202 §) vs the tree (Oct 6 2026, 7301539f)

Verdict: **PARTIAL, about 60% on §201** (19 done + 4 claimed-not-rerun + 40 partial + 9 missing of 72); the
Constitution-4-specific engineering core is about 25%. None of the September arc's own artifacts are in this tree (no jobs
table, `JobWorker`, `redisSafe`, `circuit-breaker.ts`, `secrets-loader`, `traceparent`, `ci.yml`, `topology.tf`,
`DISASTER_RECOVERY.md`, `INFRASTRUCTURE_*.md`). Later constitutions built roughly 40% of it under other names. Still missing:
the generic job queue, provider timeouts and breakers on the money and SMS paths, tracing, `/metrics`, DR drills.

Keep the current names when porting: `WORKER_JOB_CLASSES` (not Sep's `WORKER_CLASSES`), `/health/live` + `/health/ready`
(not `/livez` + `/readyz`). Railway is the host of record (C12 D4/D5); the AWS Terraform is legacy and conflicts with it.

## Status by area
| Requirement | Status | Evidence |
|---|---|---|
| §19–22 workload classes | EQUIVALENT (C13) | `packages/config/src/process-role.ts` (`PROCESS_ROLE`, `WORKER_JOB_CLASSES`: critical/standard/ai/report/import/reconciliation), `apps/api/src/worker.ts`, `railway.worker.json` (not deployed); gate interval schedulers, not queue pools |
| §23 async reports | PARTIAL | billing exports async (`billing.kysely.repository.ts:439`); 42 export GETs synchronous |
| §24 imports | PARTIAL | `customer_import_jobs/_rows` (233), `product_import_jobs` (236) |
| §25/§167 single-owner scheduling | PARTIAL | `runAsSingleOwner` (`packages/database/src/scheduler-lock.ts`) used by 2 of 31 role-gated schedulers; per-row idempotency confirmed only for billing-cycle, follow-ups, billing-export, outbox |
| §27/§107 tenant-partitioned scheduling | MISSING | every tick loops all tenants |
| §28–34 durable queue (priority, retry, DLQ) | MISSING (generic) | events have it (C8: `outbox_events`, `processed_events`, `event_dead_letters` 433); ~12 per-feature job tables (`integration_sync_jobs` 229 w/ retry+dead, `billing_export_jobs`, `ocr_jobs`, …); `ai_jobs` (437) has P0–P4 but nothing consumes it |
| §35/§113 backpressure / fairness | PARTIAL | outbox fair scheduling, AI budgets; no per-tenant job cap |
| §36 per-provider/tenant throttling | PARTIAL | integration sync only (`provider-reliability.service.ts`, 231) |
| §37–40 events | DONE (C8) | — |
| §117 circuit breakers | PARTIAL | calls blocked only for AI (`ai-provider-health.ts`) and integration sync; Twilio/SendGrid/CardPointe/Clover breakers only record state (`provider-telemetry.ts:92-112`) |
| §118 timeouts | PARTIAL | AI has them; APNs 10 s; **Twilio, SendGrid, CardPointe, Clover have none** (bug E3) |
| §47/§112 Redis degrades safely | EQUIVALENT | `redis-down.vitest.spec.ts`: cache + limiters fail open; booking/money never touch Redis |
| §46/§49/§161 Redis usage/keys | DONE | `makeIoredis` (`packages/cache/src/redis.ts`), tenant-scoped keys; ~11 clients per process |
| §48/§164 Redis HA / eviction | MISSING | hosting |
| §116 payment provider failure | PARTIAL | attempts persist `processing` (017); no stranded-attempt sweep |
| §119 financial retry safety | DONE (C5) | 7f3201f3, 8f42189e |
| §77 kill switches | DONE (C7) | `kill-switches.ts`: AI, SMS, booking verification, deals, CardPointe, Clover; step-up + reason + audit |
| §139 maintenance | PARTIAL | global read-only/full mode that fails open (`super-admin-maintenance/*`); per-module via kill switches only; no env break-glass when the DB is down |
| §76 feature flags | PARTIAL | boolean flags (`platform-flags.ts`) + registry; no percentage / selected-tenant rollout |
| §64/§69 centralized secrets | EQUIVALENT (C12 D4) | Railway variables; `secrets-inventory.ts` + CI test |
| §65/§67/§68 tenant secrets, rotation, key separation | DONE | `key-ring.ts`, `provider-crypto.ts`, `secret-rotation.ts` |
| §66 least-privilege secrets per workload | MISSING | worker shares the web service's variables |
| §84/§177/§178 correlation / async context | DONE (C11) | `packages/observability/src/request-context.ts` (AsyncLocalStorage) |
| §85/§86 structured logs + redaction | DONE | pino (C11/C12) |
| §87 metrics | PARTIAL | in-process registry persisted per minute, shown in System Ops; `exposition()` never served — no `/metrics` route |
| §89 tracing | PARTIAL | traceId minted ("No OpenTelemetry is wired", `request-context.ts:11`); no `traceparent`, spans, exporter |
| §90/§91 alerts | PARTIAL | `alert-rules.ts`, `alert-notifier.ts` email to Super Admins, SMS to `ONCALL_PHONE`; in-process — silent if the API is down |
| §92/§93/§180/§182 System Ops | DONE (C11/C7) | `observability/system-operations.ts`, 14 components (`health-core.ts`); no storage view, no deployment history; dead-letter retry API (`events/event-ops.controller.ts`) has no admin-web screen |
| §130 version / §131 schema version | DONE / MISSING | `build-info.ts`, `/health`; schema version not exposed |
| §137/§138 incidents/status | EQUIVALENT | `status_incidents` (147/445), `security_incidents` (265) |
| §133 startup validation | PARTIAL | `production-config.ts` checks DB/session/keys; `REDIS_URL` not required for multi-instance |
| §14–16 stateless / multi-instance / autoscaling | PARTIAL | stateless once Redis is set; `railway.json` `numReplicas: 1`; no autoscaling |
| §17 graceful shutdown | PARTIAL + bug E2 | `main.ts:98` `enableShutdownHooks`; DB pool never closed |
| §18 health checks | DONE | `/health/live`, `/health/ready` (DB only) |
| §51–55 pooling / replica | PARTIAL + bug E1 | `PG_POOL_MAX`, `DATABASE_READ` (`kysely.provider.ts`); no connection/idle/statement timeouts; no pool error listener |
| §56–62 object storage | PARTIAL | evidence bucket private, GuardDuty-tagged, signed-URL TTL ≤ 1 h (`evidence-blob-store.ts:47`); other uploads multipart; media keys carry no tenant/env prefix |
| §169/§170 lifecycle | MISSING | — |
| §78–80 IaC / IAM | PARTIAL / stale | `deploy/terraform/main.tf`: one EC2+EIP, single-AZ RDS, S3/CloudFront, GuardDuty; no ALB/ASG/WAF/Redis/alarms/secrets |
| §7–11 network / TLS / WAF | PARTIAL | HSTS (`security-headers.middleware.ts:57`), `network-posture.ts`; no WAF |
| §12 layered rate limits | PARTIAL+ | IP (public site, crash intake, booking verification), login, MFA, voice key, credential-stuffing, AI budgets; tenant limiter off by default (`RATE_LIMIT_STORE=redis` + flag) |
| §72 CI | DONE | `.github/workflows/security.yml`: gates incl. lint ratchet, API boot build, api/modules/apps tests, race tests on PG16, frontend builds, nightly `npm audit` |
| §71/§73 CD + immutable artifacts | MISSING | no image build/publish; migrations run at container start |
| §74/§75 rolling, expand/contract | PARTIAL | `migrate.mjs` takes no lock; expand/contract undocumented |
| §141/§142 container security | PARTIAL | no image scan; Dockerfile has no `USER` (root); `.dockerignore` does not exclude `.env*` |
| §95–98 backups / restore | PARTIAL | `backup-reports.ts`, `scripts/report-backup.mjs`, `restore-verify.ts`; no report posted, no drill (`SECURITY_DR.md:28`) |
| §99–101/§147 DR | PARTIAL | `SECURITY_DR.md`, `RUNBOOKS.md` (15); no `DISASTER_RECOVERY.md` |
| §148–151 failure / load tests | PARTIAL | Redis-down spec, events failure-modes pgtest, `scripts/api-load-test.mjs` (1 core); no instance/worker/DB-loss drills |
| §191/§192 diagrams / dependency inventory | MISSING | — |
| §120–123 notifications / AI gateway | PARTIAL / DONE | SMS straight to the `SmsSender` port, no send facade; AI gateway C10 |
| §173–175 webhooks | PARTIAL | `/webhooks/{payments,bank,twilio}` signed; no per-provider counters |

## §201 Definition of Done (72)
DONE (19): API stateless (with Redis); health checks; realtime scalable / authorization / reconnect (C9); outbox; event
dedup; Redis degrades; upload validation; secrets centralized; tenant secrets isolated; rotation documented; CI; kill
switches; structured logging; correlation IDs; System Ops; provider health monitoring; runbooks.
CLAIMED, not re-run (4): build, typecheck, lint, tests.
PARTIAL (40): inspected; diagram; dev/prod isolated; TLS; load balancer; multiple instances; graceful shutdown; critical/
standard/AI/report worker pools; scheduler safe; no duplicate cron; queue durable/priorities/retries/dead letters/idempotency/
tenant context; Postgres hardened; pooling; Redis keys; storage private; signed URLs; malware scan; IaC; rolling deploy;
flags; metrics; tracing; alerts; cost monitoring; quotas; noisy-neighbor; DR documented; load/failure testing; no plaintext
secrets; SPOFs documented.
MISSING (9): staging isolated; WAF; automatic backups (hosting, unverified); PITR; restore tested; Redis HA; storage
lifecycle; CD; DR test.

## Bugs
- **E1 (high).** `packages/database/src/kysely.provider.ts:26` `new Pool(...)` with no `'error'` listener and no process-level
  handler → with pg-pool 3.14 an idle-client error (DB restart / failover) crashes every instance. (The Sep arc fixed exactly this.)
- **E2.** `realtime-stream.ts:74` drains SSE in `onApplicationShutdown`; in Nest 10.4.22 that runs after `httpServer.close()`
  resolves, which waits on open SSE connections → on SIGTERM the drain never runs and the process hangs until killed.
- **E3.** `payment-gateway.resolver.ts:67-69`, `processor.factory.ts:28` raw `fetch` for CardPointe/Clover; `packages/notifications`
  same for Twilio/SendGrid — no timeout → a hung provider holds checkout or SMS up to ~300 s (undici default).
- **E4.** `railway.json` + Dockerfile CMD run `migrate.mjs` on every start without a lock → replicas starting together race.
- **E5.** Schedulers run twice under `PROCESS_ROLE=all` with N replicas; the worker-split runbook says "2 are safe" (true only for the outbox).
- **E6 (Terraform, if applied).** pos/admin buckets have no OAC bucket policy (403s); RDS `skip_final_snapshot = true`, no
  deletion protection, `multi_az = false`; EC2 public with 80/443/SSH open; no media bucket.
- **E7.** `packages/media/src/media-storage.ts`: writes default us-east-1 (84, 112), URLs default us-east-2; hard-coded live
  bucket fallback `power-salon-bucket` (209/218) breaks environment isolation.
- **E8.** Container runs as root.

Parallel: three circuit breakers (AI, integrations DB-backed, telemetry); ~12 per-feature job tables + unused `ai_jobs` +
outbox; three Redis sliding-window limiters (`tenant-rate-limit.ts`, `packages/security/keyed-rate-limit`,
`identity/login-throttle-redis`); hosting described four ways (Railway configs, AWS Terraform w/ nginx/certbot, `DEPLOY.md`
App Runner, stale `DEPLOYMENT.md`); migrations invoked twice (startCommand + CMD).

## Build order
Code: (1) pool: `pool.on('error')`, connection/idle/statement timeouts, close on shutdown; (2) shutdown: realtime drain in
`beforeApplicationShutdown`, readiness 503 on SIGTERM, Redis closed after the HTTP drain; (3) `migrate.mjs` advisory lock,
pre-deploy migration step, expand/contract doc; (4) single-owner on the 29 unwrapped schedulers (prerequisite for >1 replica),
fix the runbook line; (5) timeouts + breakers at `instrumentedFetch` (`provider-telemetry.ts:134`), make telemetry state block,
merge the three breakers; (6) generic Postgres jobs queue (P0–P3, SKIP LOCKED, per-tenant cap, backoff+jitter, DLQ, lease
reaping, keyed on `WORKER_JOB_CLASSES`) and move the 42 sync exports, an SMS/email send facade (unblocks C8's 3
`communication.*` events), imports and `ai_jobs` onto it; (7) dead-letter + job-retry screens in admin-web; (8) `traceparent`,
spans, OTLP exporter in `request-context`; token-protected `/metrics` serving `exposition()`; (9) require Redis when
multi-instance; stranded payment-attempt sweep; schema version in System Ops; env break-glass maintenance; tenant limiter on;
(10) container `USER node`, `.env*` in `.dockerignore`, image scan + docker build in CI; (11) `DISASTER_RECOVERY.md`, dependency
inventory, diagrams, `INFRASTRUCTURE_AUDIT.md`, fix stale `DEPLOYMENT.md`; (12) drill scripts (restore via `restore-verify`,
worker loss, Redis loss).
Kevin (hosting): host of record (Railway vs AWS Terraform); Postgres backups + PITR + first restore drill; Redis HA +
eviction + `REDIS_URL`; WAF/CDN (e.g. Cloudflare); staging environment; replicas ≥ 2 + worker service (after code item 4); CD
gating + pre-deploy migration step; external uptime monitor + `ONCALL_EMAIL`/`ONCALL_PHONE`; encryption keys copy outside
Railway; `MEDIA_STORE=s3` + lifecycle; load test on the real infrastructure.
