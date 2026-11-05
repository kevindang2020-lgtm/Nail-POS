# INFRASTRUCTURE_AUDIT.md — the infrastructure as it is in this tree

Constitution 4 §1–6, §201 line 1 "Current infrastructure inspected" (BUILD_PLAN Phase 11). A fresh inspection on
October 8, 2026 of the working tree (branch `work/dual-screen-display`), after BUILD_PLAN Phases 1–2, 10 and 11. It
supersedes the infrastructure picture in `docs/audit-2026-10-06/constitution-04-infrastructure.md` (which it re-checks
line by line in §8). Every row names the file it was read from; **HOSTING** marks what this repository cannot show
(the setting lives in a console — `docs/HOSTING_ACTIONS_FOR_KEVIN.md`). Diagrams: `docs/ARCHITECTURE_DIAGRAMS.md`.

## 1. Hosting

| Item | Finding | Evidence |
|---|---|---|
| Host of record | **Railway**: Dockerfile build, one API service; a worker service is configured but not deployed | `railway.json`, `railway.worker.json`, `DEPLOY_RAILWAY.md` |
| Other host descriptions | AWS Terraform (EC2 + RDS + S3/CloudFront) — **legacy, not applied**; App Runner (`DEPLOY.md`) and EC2 + nginx + certbot (`DEPLOY_RUNBOOK.md`) — legacy | `deploy/terraform/*`, `DEPLOYMENT.md` appendix |
| Release artifact | one container image, two entry points: `node dist/main.js` (API), `node dist/worker.js` (worker) | `Dockerfile` (`CMD`), `apps/api/src/worker.ts` |
| Image hardening | multi-stage; runtime `node:22-slim`, `NODE_ENV=production`, dev dependencies pruned, `USER node`, app code root-owned and read-only to the process, only `media/` and `private-attachments/` writable; `HEALTHCHECK` → `/health/live` (skipped for `PROCESS_ROLE=worker`) | `Dockerfile` |
| Build context hygiene | `.env*`, keys (`*.pem`, `*.key`, `*.p12`, …), `.npmrc`, fixtures, coverage, scratch and Terraform state excluded | `.dockerignore` |
| Migrations | once per release as Railway's pre-deploy command (`db-preflight.mjs && migrate.mjs`); container start no longer migrates unless `MIGRATE_ON_START=1`; `migrate.mjs` holds a session advisory lock and applies each file in its own transaction | `railway.json` `preDeployCommand`, `Dockerfile` `CMD`, `apps/api/scripts/migrate.mjs` |
| Replicas | `numReplicas: 1` for both services; production-config refuses `API_REPLICAS > 1` / `MULTI_INSTANCE=1` without `REDIS_URL` | `railway.json`, `apps/api/src/common/production-config.ts` |
| Health gate | Railway deploy health check `GET /health/ready` (database probe, 2 s timeout; 503 while shutting down), 120 s | `railway.json`, `apps/api/src/health/health.controller.ts` |
| TLS / domains / WAF | Railway terminates TLS (**HOSTING**); the API sends HSTS; no WAF in front (**HOSTING**: Cloudflare) | `apps/api/src/common/security-headers.middleware.ts` |
| Environments | production only; staging does not exist (**HOSTING**); development is local (`docker-compose.yml`, `.env.development.example`) | repository |
| Frontends | static Vite builds of `apps/*-web`, `booking-public`, `customer-display`; single-file HTML kiosk apps; served by Railway static services or a CDN (**HOSTING**) | `DEPLOY_RAILWAY.md` Step 5 |

## 2. Processes

| Process | What it runs | Evidence |
|---|---|---|
| API, `PROCESS_ROLE=all` (today) | HTTP + every background scheduler + the job worker loops + the outbox publisher | `packages/config/src/process-role.ts`, `apps/api/src/main.ts` |
| API, `PROCESS_ROLE=api` (after the split) | HTTP only; no job, no scheduler, no outbox publisher | same; drill-worker-loss asserts the API ran no job |
| Worker, `PROCESS_ROLE=worker` | the job classes in `WORKER_JOB_CLASSES` (`critical, standard, ai, report, import, reconciliation`; unset = all) — schedulers + `JobClassLoop` per class + the lease reaper (critical) | `apps/api/src/worker.ts`, `apps/api/src/jobs/job-worker.ts` |
| Scheduler ownership | every interval tick goes through `runTick` and takes the `scheduler_runs` lease (migration 518) — single-owner across any number of processes; three process-local schedulers are exempt by design | `packages/observability/src/scheduler-coordination.ts`, `packages/database/src/scheduler-runs.ts`, `tooling/architecture-tests/graph.mjs` (`PROCESS_LOCAL_SCHEDULERS`), `apps/api/src/observability/job-telemetry-coverage.vitest.spec.ts` |
| Graceful shutdown | `enableShutdownHooks`; readiness turns 503 on SIGTERM; job loops stop claiming and wait up to 20 s for jobs in flight; realtime drains before the server closes; the image `exec`s node so SIGTERM arrives | `apps/api/src/main.ts`, `health.controller.ts` (`beforeApplicationShutdown`), `job-worker.ts`, `Dockerfile` |
| Break-glass maintenance | `MAINTENANCE_BREAK_GLASS` (`off` / `read_only` / `full`) read per request from the environment, before every Nest middleware, without the database | `apps/api/src/common/maintenance-break-glass.ts`, `main.ts` (`app.use(breakGlassMiddleware())`) |

## 3. Data stores

| Store | Role | Configuration in code | HOSTING |
|---|---|---|---|
| PostgreSQL 16 | system of record | per-role pools: primary `PG_POOL_MAX` (10), worker pool `PG_WORKER_POOL_MAX` (5), optional read replica `DATABASE_REPLICA_URL` (the `DATABASE_READ` handle); connect timeout 10 s; statement / idle-in-transaction timeouts per role (api 30/30 s, all 120/60 s, worker 600/120 s); pool `error` listener keeps the process up (bug E1 fixed) | backups, PITR, HA, private networking |
| Migration ledger | `schema_migrations` with checksums; schema version on `/health` and System Operations | `apps/api/scripts/migrate.mjs`, `apps/api/src/observability/system-operations.ts` | — |
| Redis (optional) | cache, rate limits, login throttle, realtime bus, presence — never a system of record | one constructor `makeIoredis` (connect 5 s, 2 retries per command); tenant-scoped keys; switches `CACHE_STORE`, `RATE_LIMIT_STORE`, `LOGIN_THROTTLE_STORE`, `REALTIME_BUS` | the instance, HA, eviction |
| Object storage | media (`MEDIA_STORE=s3`), safety evidence (private, scan tags) | `packages/media/src/media-storage.ts` (region `MEDIA_S3_REGION ?? AWS_REGION`, keys `<env>/<tenantId>/…`, no hard-coded bucket), `media.lifecycle` job, `deploy/storage-lifecycle.json`; evidence: `modules/safety/src/tenant-safety-community/evidence-blob-store.ts` | buckets, Block Public Access, versioning, GuardDuty, lifecycle rules |
| Container disk | media when `MEDIA_STORE` is unset — **lost at every deploy** | `Dockerfile` (`media/` owned by `node`) | set `MEDIA_STORE=s3` |

## 4. Network and edge

- CORS from `WEB_CORS_ORIGINS` (`main.ts` `enableCors`); public-by-design routes are an explicit allowlist (`app.module.ts`,
  `check:public`): `/health/*`, `/metrics` (bearer `METRICS_TOKEN`; 404 in production without one), public booking and
  customer-display endpoints, signed provider webhooks.
- Guards in order: tenant rate limit → realm → permission (default deny) → platform domain → step-up → suspended → MFA
  enrollment → storage quota (`app.module.ts` `APP_GUARD` list).
- Rate limits: tenant limiter (on by default; `TENANT_RATE_LIMIT=off` disables; Redis store when configured, else
  in-memory), IP-keyed limiters for public endpoints, login throttle, credential-stuffing detector
  (`modules/identity/src/auth/login-risk.ts`).
- Egress: every payment / messaging / push provider call goes through `instrumentedFetch` (timeout, circuit breaker,
  `traceparent`); five lower-stakes integrations still use a bare `fetch` (`docs/DEPENDENCY_INVENTORY.md`, "Gap").
- Network posture warnings at boot (`apps/api/src/common/network-posture.ts`): plain-text Redis URLs, disk media.
- Not in the tree: a WAF, a CDN configuration, private networking settings (**HOSTING**).

## 5. CI/CD

| Item | Finding | Evidence |
|---|---|---|
| CI | `security.yml`: `fast` (build, security checks, architecture tests, every repository gate), `tests` (matrix), `race` (real PostgreSQL 16 service, all migrations, race specs), `full` (nightly) | `.github/workflows/security.yml` |
| Image build / scan / SBOM / CD | `build-image.yml`: docker build on every push, Trivy image scan (fail on fixable CRITICAL), IaC scan, SBOM artifact; publish to GHCR with the git-sha tag only on a manual dispatch through a protected environment | `.github/workflows/build-image.yml` (agent C, Phase 11) |
| Deploy | Railway deploys from GitHub (or the GHCR image); pre-deploy migration; health-gated rollout | `railway.json`, `DEPLOYMENT.md` |
| Rollback | redeploy the previous deployment; migrations are forward-only (expand/contract rule, `DEPLOYMENT.md` §5) | `DISASTER_RECOVERY.md` §3.6 |

## 6. Observability and operations

- Logs: pino, structured, redacted (`packages/observability`). Correlation: request id + W3C `traceparent` on every
  response, continued from an incoming one (`packages/observability/src/request-telemetry.ts`).
- Metrics: in-process registry, persisted per minute, shown in System Operations; Prometheus text on `GET /metrics`
  (`apps/api/src/health/metrics.controller.ts`).
- Tracing: spans for HTTP, DB (statement shape), provider calls, jobs and outbox consumers; OTLP/HTTP JSON exporter
  with a bounded queue (`packages/observability/src/tracing/`); off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- Health: 14 components aggregated every minute (`apps/api/src/observability/health-core.ts`), alerts by email/SMS
  (`alert-notifier.ts`), synthetic probes (`synthetic-probes.ts`), runbooks (`RUNBOOKS.md`, linked and tested).
- Jobs: Super Admin → Jobs (stats, list, retry, cancel, self-test); dead letters for events.
- Backups: report intake `POST /internal/backups/report`, `backups` component, `restore-verify`; the drills in
  `apps/api/scripts/drills/` (results: `docs/DR_DRILLS_2026-10-08.md`).

## 7. What is code and what is hosting

| Concern | Code (in this repository) | Hosting (console) |
|---|---|---|
| Statelessness / multi-instance | single-owner schedulers, SKIP LOCKED queue, Redis-backed shared state, boot refusal without Redis | replica count, `API_REPLICAS`, Redis |
| Backups / PITR / restore | `restore-verify`, `drill-restore.mjs`, backup report intake + health signal | schedules, PITR, off-site copy |
| DR | `DISASTER_RECOVERY.md`, drills, break-glass switch | second region / off-site copy, key escrow |
| Edge security | HSTS, CORS, rate limits, guards | TLS certs, WAF, DNS |
| Storage | private evidence, signed URLs, lifecycle job + rule file, tenant/env key prefixes | buckets, policies, GuardDuty, applying the rules |
| Delivery | Dockerfile, CI, image workflow, pre-deploy migration | GitHub environment protection, Railway source |
| Observability | metrics, tracing, alerts, System Operations | scraper, OTLP backend, external uptime monitor |

## 8. The Oct 6 audit's findings, re-checked

| Finding | Now | Evidence |
|---|---|---|
| E1 pool has no `error` listener | **fixed** (Phase 10) — process survives killed connections and a restart | `kysely.provider.ts` `keepPoolAlive`; drill-db-failover |
| E2 SSE drain never runs on SIGTERM | **fixed** (Phase 10) | `apps/api/src/realtime/realtime-stream.ts` |
| E3 providers without timeouts (money/SMS) | **fixed** for CardPointe, Clover, Fiserv, Twilio, SendGrid, FCM, APNs; **open** for Retell, Google, CAPTCHA, Twilio Voice Intelligence, review publisher | `provider-telemetry.ts` `PROVIDER_TIMEOUT_MS`; `docs/DEPENDENCY_INVENTORY.md` |
| E4 migrations on every start, no lock | **fixed** — advisory lock (Phase 10) + pre-deploy step (Phase 11) | `migrate.mjs`, `railway.json` |
| E5 schedulers twice under N replicas; runbook "2 are safe" | **fixed** (Phase 2 `runTick` lease) and the runbook line corrected | `RUNBOOKS.md` → `worker-split` |
| E6 Terraform (if applied) | marked LEGACY and hardened in case it is applied | `deploy/terraform/README.md`, `deploy/terraform/main.tf` |
| E7 media region/bucket divergence | **fixed** — one region source, no hard-coded bucket, env/tenant key prefix | `packages/media/src/media-storage.ts` |
| E8 container runs as root | **fixed** — `USER node` | `Dockerfile` |
| New (Oct 8): Redis outage → sign-in 500, cached reads > 10 s | **open** — handed to the lead | drill-redis-loss; `DISASTER_RECOVERY.md` §3.3 |
