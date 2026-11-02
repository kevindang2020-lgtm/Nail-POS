# OBSERVABILITY_AUDIT.md — Constitution 11, Phase 1 (Discovery)

**Date:** September 21, 2026 · **Tree:** July snapshot `f420cfe` + 120 commits (HEAD `86171f7`)
**Rule applied:** inspect first; reuse and harden what exists; no `*_v2`. Every claim below was verified by
reading the code, not from memory — two things memory said existed (an Infrastructure Constitution report and
`packages/mobile-core`) are **not in this tree**, and the plan does not depend on them.

---

## 1. Existing observability — what is actually there

| Concern | Found | Where | State |
|---|---|---|---|
| Structured logs | pino JSON logger, production only, `LOG_LEVEL`, 6 redacted paths | `src/observability/pino-logger.ts` (45 lines) | Works. No request/tenant context; redaction untested; wraps Nest's string API only |
| `console.*` in production code | 16 calls in 8 files | `push-providers`, `main.ts`, `media-storage`, … | Small; replace with the logger |
| Request ID | **none** — no `x-request-id`, no middleware. Every `requestId` in code is a domain noun (help/transfer requests) | — | Gap |
| Correlation ID | on **domain events only** (`correlationId`, `causationId`), per Constitution 8 | `src/events/event-contract.ts` | Starts at the event, never at the HTTP request → chain is broken at its origin |
| Async context | **none** (`AsyncLocalStorage` unused) | — | Gap |
| Tracing / OpenTelemetry | **none** (no dependency, no trace id) | — | Gap |
| HTTP request telemetry | `HealthMetricsInterceptor`: one PostgreSQL row per request (method, route **pattern**, status, latency), sampled, fire-and-forget | `src/common/health-metrics.interceptor.ts` → `platform_request_metrics` | Works, but is the "telemetry firehose in OLTP" §246/§395 prohibit |
| Liveness | `GET /health` — `{status:'ok', uptime}` | `src/health/health.controller.ts` | Liveness only; no readiness, no dependency health |
| Global exception filter | **none** (Nest default) | — | Stack traces are not leaked (Nest default is safe), but errors carry no request reference and are not logged with context or fingerprinted |
| Error taxonomy | **none**; per-module error classes with ad-hoc `code` strings | — | Gap |
| Event metrics | outbox by status, oldest-pending age, consumer lag, dead letters by consumer, correlation/event search | `src/events/event-ops.*` | **Complete for §49** |
| Realtime metrics | connections, reconnects/min, auth failures/min, p95 lag, publish failures, slow clients → `OPERATIONAL/IDLE/DEGRADED/INCIDENT` | `src/realtime/realtime-health.ts`, gateway counters | **Complete for §50–51** |
| Provider health | circuit breakers with `ProviderHealth{status, latencyMsP50, lastSuccessAt, lastFailureAt, consecutiveFailures, openUntil}` — **AI providers only** | `src/ai/ai-provider-health.ts` | Almost exactly §298; Twilio, CardPointe, Fiserv, push, email have none |
| Alerts | `alerts` table: severity low/medium/high/critical, status unread/read/resolved/dismissed, **UNIQUE `dedupe_key`**, notes | `src/super-admin-alerts/*` | §104 dedup exists. No acknowledged state (§265), no owner/runbook (§177) |
| Incidents | `status_incidents` (investigating/identified/monitoring/resolved; impact none→critical), `status_incident_impact`, `status_post_incident_reports`, tenant notify, publish update, maintenance windows | `src/super-admin-system-status/*`, migration 147 | Solid lifecycle. Missing §168: severity, affected_components, tenants_count, detected_at, commander, root_cause, resolution; §169 `MITIGATING` |
| Component registry | `status_components` (key, name, status, sort) | migration 147; `help/status.service.ts` (tenant-facing) | Statuses are **typed by a human**; "last checked" = last manual save → fake green (§332) |
| Security events | `security_incidents`, `security_incident_events`, audit engine scheduler | `src/super-admin-security/*` | Good base for §118–123 |
| Audit | `audit_logs`, `audit_events`, legal holds, evidence packs, tamper controls | migrations 112+, `src/super-admin-audit-logs/*` | Complete audit domain (§4). No request/correlation columns (§371) |
| Tenant health | `tenant-health-score`: **account/churn** score (billing, logins, onboarding) | `src/super-admin-tenant-health/` | Different concern from §156 operational health; link, don't duplicate |
| Background work | **no queue system** (no BullMQ). Outbox consumers + AI job scheduler + **21 in-process `setInterval` schedulers**, no shared wrapper, 3 swallow all errors | across modules | §45–48/§192 map onto these, not onto an invented queue |
| Redis | `cache-redis.ts` behind `CachePort`; login throttle; realtime backbone | `src/cache`, `src/common/redis.ts` | No hit/miss/latency metrics (§44/§196) |
| Backups | one KPI (`backupSuccessRatePct`) in the security overview | `src/super-admin-security/security-core.ts` | No last-backup age, PITR, restore-test visibility (§114–116) |
| Deployments | `deployments` module = **tenant hardware/POS deployments**, not platform releases | `src/deployments/*` | Different concept. No release marker/version endpoint (§68–69) |
| Frontend | **0 error boundaries** across 7 web apps; no crash reporting; no request-id display | — | Gap (§199–200) |
| Mobile | no telemetry surface; `packages/mobile-core` does not exist in this tree | — | Gap (§125–127) |

## 2. Problems found (§397 §2)

1. **No request identity.** Nothing ties a log line, an error shown to a user, and a support ticket together.
2. **Correlation begins too late.** The outbox mints `correlationId` per event; an HTTP request that causes three events produces three unrelated chains.
3. **Telemetry in OLTP.** `platform_request_metrics` grows by one row per request. At 10,000 tenants this table is the largest thing in the database and is competing with checkout for I/O.
4. **Fake green is structurally possible.** `status_components.status` is a text field with no `observed_at`/`expires_at`; a human sets it and it stays.
5. **Redaction is a hope, not a test.** Six pino paths, no test sends a secret through the logger.
6. **Errors are anonymous.** No filter → no request reference in any error response, no fingerprinting, no context on the logged exception.
7. **Provider health is AI-only.** Twilio, payments, email and push — the providers a salon notices first — have no health adapter.
8. **21 schedulers, 21 conventions.** No job start/complete/fail telemetry (§192); three swallow every error.
9. **No frontend error handling at all.** A rendering crash in the POS is a white screen with no reference.
10. **No readiness.** Load balancers can route to an instance whose database connection is gone.

## 3. Section → code map (every spec area, one decision each)

| Sections | Decision |
|---|---|
| §6–15 context | **Build** `request-context` on `AsyncLocalStorage`; jobs/events initialise context from their metadata (§376) |
| §7 request id | **Build** middleware; return via `x-request-id` header and in error bodies (see D2) |
| §8–9, §12 correlation | **Extend** Constitution 8's field upward: the outbox defaults `correlationId` from the ambient request context |
| §10–11, §131–139 tracing | **Defer OpenTelemetry vendor wiring**; build the propagation contract (request/correlation/trace-shaped ids) so OTel can be attached without touching modules |
| §16–21 logging | **Harden** the pino logger: context merge, `withContext()` |
| §22–28 redaction | **Build** one redaction module used by logger AND exception filter; **tests send every prohibited field through it** |
| §29–30 exceptions | **Build** global filter: context-logged, fingerprinted, no stack to client |
| §36–39 API metrics | **Replace** per-request rows with in-memory aggregation flushed per minute per route pattern; keep the interceptor's contract |
| §40–44 DB/Redis | **Build** read-only collectors over `pg_stat_*` and the existing `CachePort` |
| §45–48 queues/workers | **Map** onto outbox + AI jobs + schedulers; **build** the §192 job wrapper and adopt it |
| §49 events, §50–51 realtime | **Reuse** unchanged |
| §52–60 providers | **Generalize** the AI breaker's `ProviderHealth` into a shared adapter; attach to each provider client |
| §70–83 business SLIs | **Build** from existing fact tables (bookings, tickets, verification, checkout) — no new event firehose |
| §84–91 health | **Extend** `/health` with `/health/ready` and platform-only `/health/dependencies` |
| §97–113 alerts | **Reuse** `alerts` table; add `acknowledged`, owner, runbook, source; evaluate rules from the health aggregator |
| §140–167 control plane | **Build** on the existing System Status module and `super-admin-health` |
| §168–179 incidents/runbooks | **Harden** `status_incidents` (severity, commander, root cause, `MITIGATING`, timeline); runbooks as markdown in repo |
| §180–184 permissions | **Use** `super_admin.*` convention (spec's `platform.*` names don't exist here) |
| §189 shared package | See D1 |
| §290–294 APIs | **Under `super-admin/system/*`** — the repo's prefix convention wins over the spec's literal `/api/v1/platform/…` |
| §296–302, §340–347 aggregator + tables | **Build** health snapshots (component/tenant/branch/provider) with `observed_at`/`expires_at`; stale ⇒ `UNKNOWN` |
| §270–272 status page | **Harden**: feed `status_components` from the aggregator; manual overrides stay possible but are labelled |

## 4. Decisions

- **D1 — Where the package lives.** §189 asks for `/packages/observability`. The API imports no shared package today and runs as `tsc` → `node dist/main.js`, so a path alias would not resolve at runtime. The core therefore goes in the **existing** `src/observability/` (reuse-and-harden), and a small pure package serves the web apps (error boundary, request reference); a gate keeps the shared constants identical, as the realtime contract gate already does.
- **D2 — Request id on the wire.** The spec's `{data, requestId}` envelope would change every response body in a 600-route API. The id is returned as the `x-request-id` response header on every response and **inside every error body**, which is where a user or support agent needs it. Documented deviation.
- **D3 — No queue system will be invented.** Queue/worker metrics describe the outbox, the AI scheduler and the in-process sweeps that actually run.
- **D4 — Telemetry stays out of OLTP.** Per-request rows are replaced by per-minute route aggregates; PostgreSQL keeps summaries, incidents, alerts and health snapshots only (§246).
- **D5 — OpenTelemetry is prepared, not wired.** Context and ids are W3C-compatible in shape so an exporter can be attached later without touching modules; wiring a vendor needs credentials and an endpoint this snapshot does not have.

## 5. Build order (adapted §394)

Phases 2–4 first (context, package, API instrumentation) because everything else reads their output. Then DB/Redis/jobs/providers (5–10), business SLIs (11), the health aggregator and snapshots (13), alerts/incidents/runbooks (14, 17), Super Admin screens (16), frontend/mobile (12), synthetic and backup visibility (18–19), and the privacy/correlation/failure tests (20) — which are written **with** each phase, not at the end.

<!-- DOD-TABLE:BEGIN (generated) -->
## 6. Definition of Done (§396) — final status, BUILD_PLAN Phase 14 (Oct 9 2026)

Generated, not written by hand: `cd apps/api && node scripts/observability-dod-check.mjs --markdown` (regenerate after any change; the plain run
prints the same lines). Every line is a predicate over evidence in the tree — an export, a route, a migration, a test or a CI
gate — and `src/common/dod-predicates.vitest.spec.ts` proves each one flips to NOT DONE when its evidence is removed.
**HOSTING** = the code is built and tested; the remaining step is Kevin's, named by its row in `docs/HOSTING_ACTIONS_FOR_KEVIN.md`.

**§396: 70 DONE · 6 HOSTING (Kevin) · 0 PARTIAL · 0 NOT DONE of 76**

| # | §396 line | Status | Evidence / Kevin action |
|---|---|---|---|
| 1 | Existing observability fully inspected | **DONE** | `OBSERVABILITY_AUDIT.md` |
| 2 | Logging standardized | **DONE** | `packages/observability/src/logger.ts` |
| 3 | Structured logging implemented | **DONE** | `packages/observability/src/logger.ts` |
| 4 | Sensitive redaction implemented | **DONE** | `packages/observability/src/redaction.ts` |
| 5 | Request IDs implemented | **DONE** | `packages/observability/src/request-telemetry.ts` |
| 6 | Correlation IDs implemented | **DONE** | `packages/observability/src/request-context.ts` |
| 7 | Trace IDs integrated | **DONE** | `packages/observability/src/tracing/traceparent.ts`, `packages/observability/src/tracing/exporter.ts`, `packages/observability/src/tracing/tracing.test.ts`, `apps/api/scripts/live-tracing.mjs` |
| 8 | Context propagates through HTTP | **DONE** | `packages/observability/src/request-telemetry.ts` |
| 9 | Context propagates through Events | **DONE** | `packages/events/src/event-contract.ts`, `packages/observability/src/tracing/consumer.ts` |
| 10 | Context propagates through Workers | **DONE** | `packages/observability/src/job-telemetry.ts` |
| 11 | Context propagates through Providers | **DONE** | `apps/api/src/observability/end-to-end-telemetry.vitest.spec.ts` |
| 12 | API metrics implemented | **DONE** | `apps/api/src/observability/http-metrics.ts` |
| 13 | Database metrics implemented | **DONE** | `packages/observability/src/db-telemetry.ts`, `apps/api/src/app.module.ts`, `apps/api/scripts/live-tracing.mjs` |
| 14 | Redis metrics implemented | **DONE** | `packages/observability/src/redis-telemetry.ts` |
| 15 | Queue metrics implemented | **DONE** | `packages/observability/src/job-telemetry.ts`, `apps/api/src/observability/queue-metrics.ts`, `apps/api/src/observability/queue-metrics.pgtest.vitest.spec.ts` |
| 16 | Worker metrics implemented | **DONE** | `packages/observability/src/job-telemetry.ts` |
| 17 | Event metrics implemented | **DONE** | `apps/api/src/observability/health-aggregator.ts`, `apps/api/src/observability/queue-metrics.ts` |
| 18 | Realtime metrics implemented | **DONE** | `packages/observability/src/realtime-telemetry.ts` |
| 19 | Twilio metrics implemented | **DONE** | `packages/notifications/src/sms.service.ts` |
| 20 | Email metrics implemented | **DONE** | `packages/notifications/src/email.service.ts` |
| 21 | Push metrics implemented | **DONE** | `modules/communications/src/push/push-providers.ts` |
| 22 | Payment metrics implemented | **DONE** | `modules/payments/src/payments/processor.factory.ts` |
| 23 | AI metrics implemented | **DONE** | `modules/ai/src/ai/ai-provider-health.ts` |
| 24 | Storage metrics implemented | **DONE** | `packages/observability/src/storage-telemetry.ts`, `packages/media/src/media-storage.ts`, `packages/media/src/private-store.ts`, `packages/observability/src/storage-telemetry.test.ts` |
| 25 | CPU/memory metrics implemented | **DONE** | `packages/observability/src/process-metrics.ts`, `packages/observability/src/realtime-telemetry.ts`, `packages/observability/src/process-metrics.test.ts` |
| 26 | Frontend telemetry implemented | **DONE** | `packages/ui/src/error-reporting.tsx`, `apps/api/src/observability/client-errors.controller.ts` |
| 27 | Mobile telemetry implemented | **DONE** | `apps/api/src/observability/client-events.controller.ts`, `apps/api/src/observability/client-events.vitest.spec.ts` |
| 28 | Distributed tracing implemented | **HOSTING** | traces are stored and searchable in-platform (Request search); an external backend needs OTEL_EXPORTER_OTLP_ENDPOINT (+ _HEADERS) set on Railway (HOSTING_ACTIONS C4) — `packages/observability/src/tracing/span.ts`, `packages/observability/src/tracing/tracing.test.ts`, `apps/api/db/migrations/561_telemetry_store.sql` |
| 29 | Critical business SLIs implemented | **DONE** | `apps/api/src/observability/sli.ts` |
| 30 | Health checks implemented | **DONE** | `apps/api/src/health/health.controller.ts` |
| 31 | Component health implemented | **DONE** | `apps/api/src/observability/health-core.ts` |
| 32 | Tenant health implemented | **DONE** | `apps/api/src/observability/tenant-health.ts`, `apps/api/db/migrations/459_tenant_health_snapshots.sql`, `apps/admin-web/src/components/SalonHealthPanel.tsx` |
| 33 | Branch health implemented | **DONE** | `apps/api/db/migrations/562_branch_health_process_heartbeats.sql`, `apps/api/src/observability/branch-health.ts`, `apps/api/src/observability/branch-health.pgtest.vitest.spec.ts` |
| 34 | Provider health implemented | **DONE** | `packages/observability/src/provider-telemetry.ts` |
| 35 | Synthetic monitoring implemented | **HOSTING** | designate the synthetic test salon (Super Admin → On-call → Synthetic) and set the CardPointe UAT + Twilio test credentials (HOSTING_ACTIONS D3/D4) — `apps/api/src/observability/synthetic-probes.ts`, `apps/api/db/migrations/563_alert_escalation_slo_synthetic.sql`, `apps/api/src/observability/synthetic-probes.pgtest.vitest.spec.ts` |
| 36 | Alert severity implemented | **DONE** | `apps/api/src/observability/alert-rules.ts` |
| 37 | Alert deduplication implemented | **DONE** | `apps/api/src/observability/health-aggregator.ts` |
| 38 | Alert routing to a human (§262–265) | **HOSTING** | enter the on-call contacts (Super Admin → On-call; email works with SendGrid, SMS needs Twilio) (HOSTING_ACTIONS D5) — `apps/api/src/observability/alert-notifier.ts`, `apps/api/db/migrations/563_alert_escalation_slo_synthetic.sql`, `apps/api/src/observability/alert-escalation.ts`, `apps/api/src/observability/oncall.ts`, `apps/api/src/observability/alert-escalation.pgtest.vitest.spec.ts`, `apps/api/src/observability/oncall.pgtest.vitest.spec.ts` |
| 39 | Runbooks created | **DONE** | `RUNBOOKS.md`, `apps/api/src/observability/runbook-links.vitest.spec.ts` |
| 40 | SLOs defined where measured | **HOSTING** | the evaluator marks each SLO validated / breached automatically after SLO_VALIDATION_MIN_DAYS (default 28) days and SLO_VALIDATION_MIN_REQUESTS (default 1000) requests of production traffic — nothing to do but run production — `apps/api/src/observability/slo-core.ts`, `apps/api/src/observability/slo-validation.ts`, `apps/api/db/migrations/563_alert_escalation_slo_synthetic.sql`, `apps/api/src/observability/slo-validation.pgtest.vitest.spec.ts` |
| 41 | Error budgets implemented where appropriate | **DONE** | `apps/api/src/observability/slo-core.ts` |
| 42 | Backup monitoring implemented | **HOSTING** | schedule deploy/backup/backup-and-report.sh (Railway cron or the GitHub workflow template in deploy/backup) and set BACKUP_REPORTS_REQUIRED=1 (HOSTING_ACTIONS D6) — `apps/api/src/observability/backup-reports.ts`, `apps/api/src/observability/report-backup-script.vitest.spec.ts`, `apps/api/src/observability/backup-staleness.pgtest.vitest.spec.ts`, `deploy/backup/backup-and-report.sh` |
| 43 | Restore-test monitoring implemented | **DONE** | `apps/api/src/observability/backup-reports.ts` |
| 44 | Deployment markers implemented | **DONE** | `packages/observability/src/build-info.ts`, `apps/api/db/migrations/562_branch_health_process_heartbeats.sql` |
| 45 | Incident Management implemented | **DONE** | `apps/api/src/super-admin-system-status/incident-workflow.ts` |
| 46 | Security observability implemented | **DONE** | `apps/api/src/observability/security-signals.ts`, `apps/api/src/observability/security-signals.pgtest.vitest.spec.ts` |
| 47 | Cross-tenant alerts implemented | **DONE** | `apps/api/src/observability/cross-tenant-signal.ts`, `apps/api/src/observability/integrity-checks.ts` |
| 48 | Super Admin System Operations implemented | **DONE** | `apps/admin-web/src/screens/SystemOperationsScreen.tsx` |
| 49 | API dashboard works | **DONE** | `apps/api/src/observability/system-operations.ts` |
| 50 | Database dashboard works | **DONE** | `modules/super-admin/src/super-admin-database/database.controller.ts`, `apps/admin-web/src/screens/DatabaseScreen.tsx`, `apps/admin-web/src/screens/DatabaseScreen.test.tsx` |
| 51 | Redis dashboard works | **DONE** | `apps/api/src/observability/ops-dashboards.ts`, `apps/admin-web/src/api/opsDashboardsApi.ts`, `apps/admin-web/src/screens/OpsDashboardsScreen.tsx`, `apps/admin-web/src/screens/OpsDashboardsScreen.test.tsx`, `apps/api/src/observability/ops-dashboards.pgtest.vitest.spec.ts` |
| 52 | Queue dashboard works | **DONE** | `apps/api/src/events/event-ops.controller.ts` |
| 53 | Realtime dashboard works | **DONE** | `apps/api/src/realtime/platform-live-ops.ts` |
| 54 | Payments dashboard works | **DONE** | `apps/api/src/observability/ops-dashboards.ts`, `apps/admin-web/src/api/opsDashboardsApi.ts`, `apps/admin-web/src/screens/OpsDashboardsScreen.tsx`, `apps/admin-web/src/screens/OpsDashboardsScreen.test.tsx`, `apps/api/src/observability/ops-dashboards.pgtest.vitest.spec.ts` |
| 55 | Communications dashboard works | **DONE** | `apps/api/src/observability/ops-dashboards.ts`, `apps/admin-web/src/api/opsDashboardsApi.ts`, `apps/admin-web/src/screens/OpsDashboardsScreen.tsx`, `apps/admin-web/src/screens/OpsDashboardsScreen.test.tsx`, `apps/api/src/observability/ops-dashboards.pgtest.vitest.spec.ts` |
| 56 | AI dashboard works | **DONE** | `modules/ai/src/ai/ai-control-plane.ts` |
| 57 | Storage dashboard works | **DONE** | `apps/api/src/observability/ops-dashboards.ts`, `apps/admin-web/src/api/opsDashboardsApi.ts`, `apps/admin-web/src/screens/OpsDashboardsScreen.tsx`, `apps/admin-web/src/screens/OpsDashboardsScreen.test.tsx`, `apps/api/src/observability/ops-dashboards.pgtest.vitest.spec.ts` |
| 58 | Mobile dashboard works | **DONE** | `apps/api/src/observability/ops-dashboards.ts`, `apps/admin-web/src/api/opsDashboardsApi.ts`, `apps/admin-web/src/screens/OpsDashboardsScreen.tsx`, `apps/admin-web/src/screens/OpsDashboardsScreen.test.tsx`, `apps/api/src/observability/ops-dashboards.pgtest.vitest.spec.ts`, `apps/admin-web/src/screens/SystemOpsMobileTelemetry.tsx` |
| 59 | Deployment dashboard works | **DONE** | `apps/api/src/observability/ops-dashboards.ts`, `apps/admin-web/src/api/opsDashboardsApi.ts`, `apps/admin-web/src/screens/OpsDashboardsScreen.tsx`, `apps/admin-web/src/screens/OpsDashboardsScreen.test.tsx`, `apps/api/src/observability/ops-dashboards.pgtest.vitest.spec.ts` |
| 60 | Incident dashboard works | **DONE** | `apps/api/src/observability/ops-dashboards.ts`, `apps/admin-web/src/api/opsDashboardsApi.ts`, `apps/admin-web/src/screens/OpsDashboardsScreen.tsx`, `apps/admin-web/src/screens/OpsDashboardsScreen.test.tsx`, `apps/api/src/observability/ops-dashboards.pgtest.vitest.spec.ts`, `apps/admin-web/src/screens/SystemStatusIncident.tsx` |
| 61 | Request search works | **DONE** | `apps/api/db/migrations/561_telemetry_store.sql`, `apps/api/src/observability/telemetry-store.ts`, `apps/admin-web/src/screens/RequestSearchScreen.tsx`, `apps/api/src/observability/telemetry-store.pgtest.vitest.spec.ts` |
| 62 | Correlation search works | **DONE** | `apps/api/src/observability/telemetry-store.ts`, `apps/api/src/observability/telemetry-store.pgtest.vitest.spec.ts` |
| 63 | Trace/log linking works | **DONE** | `apps/api/src/observability/telemetry-store.ts`, `packages/observability/src/telemetry-store.ts`, `apps/api/src/observability/telemetry-store.pgtest.vitest.spec.ts` |
| 64 | Sensitive telemetry permissions work | **DONE** | `packages/permissions/src/rbac.ts`, `apps/api/src/observability/telemetry-store.ts`, `apps/api/src/observability/telemetry-permissions.vitest.spec.ts` |
| 65 | Telemetry export failure does not break POS | **DONE** | `apps/api/src/observability/end-to-end-telemetry.vitest.spec.ts`, `packages/observability/src/tracing/tracing.test.ts` |
| 66 | High-cardinality safeguards implemented | **DONE** | `packages/observability/src/metrics.ts` |
| 67 | Log-redaction tests pass | **DONE** | `packages/observability/src/redaction.test.ts` |
| 68 | Context-leak tests pass | **DONE** | `packages/observability/src/request-context.test.ts` |
| 69 | Health tests pass | **DONE** | `apps/api/src/health/health.controller.vitest.spec.ts` |
| 70 | Alert tests pass | **DONE** | `apps/api/src/observability/alert-rules.vitest.spec.ts`, `apps/api/src/observability/alert-reconcile.pgtest.vitest.spec.ts` |
| 71 | Failure-injection tests pass | **DONE** | `apps/api/src/health/health.controller.vitest.spec.ts`, `docs/DR_DRILLS_2026-10-08.md` |
| 72 | Load tests pass | **HOSTING** | run scripts/api-load-test.mjs at 50 clients against staging on the production plan (HOSTING_ACTIONS C5); sandbox 50-client numbers are not target numbers — `apps/api/scripts/api-load-test.mjs`, `apps/api/scripts/db-explain-pass.mjs`, `docs/DB_EXPLAIN_PASS_2026-10-08.md` |
| 73 | Build passes | **DONE** | gated on every push (build-image.yml docker build of the API; security.yml build:packages + build:modules); --run measures it here — `.github/workflows/build-image.yml`, `Dockerfile`, `.github/workflows/security.yml` |
| 74 | Type checking passes | **DONE** | gated on every push (API build = tsc over src; gate "app types" typechecks every SPA); --run measures it here — `apps/api/package.json`, `tooling/ci/run-gates.mjs` |
| 75 | Lint passes | **DONE** | gated on every push (gate "lint" = tooling/ci/lint-ratchet.mjs: 0 errors, no rule above lint-baseline.json; npm run lint is the same ratchet); --run measures it here — `tooling/ci/run-gates.mjs`, `apps/api/package.json`, `package.json`, `tooling/ci/lint-ratchet.mjs`, `tooling/ci/lint-baseline.json`, `.github/workflows/security.yml` |
| 76 | Tests pass | **DONE** | gated on every push (security.yml: every suite in a 4-way matrix + the real-Postgres race lane); --run measures it here — `.github/workflows/security.yml`, `tooling/ci/run-tests.mjs` |
<!-- DOD-TABLE:END -->
