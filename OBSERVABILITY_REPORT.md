# OBSERVABILITY_REPORT.md — Constitution 11 final report (§397)

**Tree:** July snapshot `f420cfe` + Constitution 11 work, 21 commits from `86171f7` to HEAD · **Date:** September 21, 2026
**Status of everything here:** built and verified on a snapshot. **Nothing is on `Power-Salon-main`, nothing is deployed,
the live site has never been inspected.** Every number below is from the snapshot tree.

**Final verification (whole tree, this date):** API **7,440 passed + 4 skipped, 0 failures** (8 shards) · pos-web 765 ·
admin-web 813 · customer-web 267 · owner-web 262 · tech-web 117 · manager-pay-web 66 · customer-display 43 · ui 65 ·
realtime-client 12 — all green. 17/17 gates. `tsc` clean in the API and all seven apps. Lint not run (no script).

The Definition of Done (§396) is checked by `apps/api/scripts/observability-dod-check.mjs` against the tree, not asserted:
**49 DONE · 17 PARTIAL · 10 NOT DONE of 76** (after the Railway turn-on, paging, and the cross-tenant signals, below). §57 lists every partial and missing item. Nothing below claims more.

---

## 1. Existing observability discovery
See `OBSERVABILITY_AUDIT.md` (Phase 1). In one paragraph: a 45-line pino logger (production only, six redacted paths, no
context, no test); correlation ids on domain events only; a per-request row written into PostgreSQL; complete event and
realtime metrics from Constitutions 8–9; AI-only provider breakers; an `alerts` table with a unique dedupe key; a
status-page incident lifecycle; a component registry whose statuses were typed by a human. No request id, no async
context, no tracing, no exception filter, no error boundary in any of seven web apps, no crash reporting, and no queue
system — background work is the outbox, the AI scheduler and 21 hand-rolled `setInterval` sweeps.

## 2. Problems found
1. No request id anywhere; 2. correlation started at the event, not the request; 3. redaction untested and narrow;
4. telemetry firehose in the OLTP database; 5. no metrics for DB, Redis, providers, workers; 6. health typed by hand
(fake green possible); 7. no readiness check; 8. no business SLIs; 9. no error taxonomy; 10. no frontend error
handling; 11. 21 schedulers with no shared telemetry, three swallowing every error; 12. incident model missing
severity, commander, timeline, root cause, and a MITIGATING state whose absence made the funnel double-count.

## 3. Final architecture
```
Apps (7 web apps: error boundary + fetch observer → POST /client-telemetry/errors)
  ↓
API request → RequestContextMiddleware (req_/corr/trace ids, AsyncLocalStorage)
  ├─ logger (structured JSON, context merged, redacted, never throws/blocks)
  ├─ metrics registry (counters/gauges/histograms; cardinality guard; Prometheus exposition)
  ├─ HTTP metrics → per-minute aggregates (platform_request_metrics_minute, 35-day retention)
  ├─ DB / Redis / provider / realtime / job telemetry at their single construction points
  └─ business SLIs at the HTTP boundary (21 routes → 10 workflows)
  ↓
Health aggregator (every 30 s): components → hysteresis → rollup → status_components + history
  ├─ alerts (existing table): raise / escalate / resolve, grouped by root cause, linked to runbooks
  ├─ SLOs (every 5 min): budgets + multi-window burn → alerts
  └─ synthetic probes, backup reports, outbox health on the same cadence
  ↓
Incidents (status_incidents, hardened): promote from alert → commander → timeline → resolution → postmortem
  ↓
Super Admin → System Operations (reads persisted state; UNKNOWN when stale; PROPOSED badges on SLOs)
```
No monitoring vendor is attached. The registry speaks Prometheus text and ids are W3C-shaped, so an OpenTelemetry or
Prometheus collector can be pointed at the API later without touching modules (§188, decision D7).

## 4. Observability package
Audit decision D1: the core lives in the existing `apps/api/src/observability/` (the API imports no shared package and
runs `tsc` + `node dist/main.js`, so a path-aliased package would not resolve at runtime); the web apps' half lives in
`packages/ui` (all seven apps already consume it).
`apps/api/src/observability/`: request-context, redaction, logger, request-telemetry (middleware + exception filter),
metrics, http-metrics, job-telemetry (+ coverage guard), db-telemetry, redis-telemetry, realtime-telemetry,
provider-telemetry, sli, health-core, health-aggregator, alert-rules, slo-core, slo-reader, telemetry-retention,
client-errors.controller, system-operations, synthetic-probes, backup-reports, build-info, observability.module,
and 25 test files. `packages/ui/src/error-reporting.tsx` (+ tests, + app-wiring guard).
`apps/api/src/super-admin-system-status/incident-workflow.ts`. `RUNBOOKS.md`. Migrations 443–447.

## 5. Request context
`request_id` — `req_` + time-sortable ULID-style, minted per request, returned in `x-request-id` on every response
(CORS exposes it), shown to users as "Reference: req_…". `correlation_id` — the workflow chain; starts at the request,
inherited by events raised inside it, carried in job metadata, present on provider calls; a client may continue a chain
with `x-correlation-id`. `trace_id` — W3C-shaped, minted per request, ready for an exporter. `tenant_id`, `branch_id`,
`actor_id/type`, `operation`, `service` — enriched by the tenant middleware. Jobs and consumers build their own context
from their metadata (§376). Untrusted headers are sanitised; trusted metadata is not (a first draft got that wrong).

## 6. Logging
```json
{"timestamp":"…","level":"info","service":"api","environment":"production","deploymentVersion":"4.2.8",
 "requestId":"req_…","correlationId":"…","traceId":"…","tenantId":"…","branchId":"…","operation":"api.POST /pos/checkout/…",
 "msg":"request.completed","method":"POST","route":"/pos/checkout/tickets/:ticketId/pay/card","status":200,"durationMs":84,"dbQueries":6}
```
One logger (`log`, with `withContext`); every line merges the ambient ids and passes through redaction; never throws,
never blocks. 4xx are WARN, 5xx ERROR (§201). `console.*` in production code: 16 sites remained at discovery, none added.

## 7. Redaction
By key (normalised, so `X-Api-Key` and `twilioAuthToken` match): password, passwd, pin, otp/otp_code, mfa_code/secret,
totp, recovery_code, access/refresh/id token, api_key, auth_token, authorization, cookie, client_secret, private_key,
encryption_key, jwt, signature, secret, card_number/pan/cvv/cvc/security_code/track_data, account_number,
routing_number, ssn, tax_id. By value: JWTs, bearer tokens, Luhn-valid card numbers → `****last4`. PII masked, not
removed: phone → `***0142`, email → `a***@domain`. AI content omitted: prompt, system_prompt, completion,
response_text, transcript, messages. 81 tests iterate every key; a first draft would have redacted `error_code` and
`status_code` — narrowed.

## 8. Metrics (major)
`aipowersalon_api_requests_total{method,route,status_class}`, `…_api_request_duration_seconds`, `…_api_in_flight`,
`…_api_429_total`; `…_db_queries_total{operation,table}`, `…_db_query_duration_seconds`, `…_db_query_errors_total`,
`…_db_slow_queries_total`, `…_db_pool_connections{state}`, `…_db_pool_utilisation_ratio`, `…_db_queries_per_request`;
`…_redis_commands_total{role,command}`, `…_redis_command_duration_seconds`, `…_redis_connection_up{role}`,
`…_redis_memory_used_bytes`, `…_redis_keyspace_hit_ratio`; `…_job_started/completed/failed_total{job_type,job_class}`,
`…_job_duration_seconds`, `…_job_queue_wait_seconds`, `…_jobs_in_flight`; `…_provider_calls_total{provider,operation,category}`,
`…_provider_call_duration_seconds`, `…_provider_circuit_open`; `…_realtime_*` (connections, reconnects, auth failures,
events/min, delivery latency by quantile, backbone failures), `…_nodejs_event_loop_lag_seconds`; `…_sli_events_total{workflow,outcome,category}`;
`…_client_errors_total{app,kind}`; `…_synthetic_probe_runs_total{probe,outcome}`; `…_build_info{version,commit}`.
Names follow `aipowersalon_<subsystem>_<what>_<unit>`; seconds, bytes, ratios 0–1 (§361–363); histogram buckets per
workload (§364).

## 9. Cardinality strategy
The registry REFUSES `tenant_id`, `customer_id`, `request_id`, `appointment_id`, `phone`, `url` as label names at
registration — the mistake fails the first test that imports the metric, not a monitoring bill. Label values are
capped: past 200 distinct values a label collapses to `other`. Routes are templates (`/customers/:id`), provider
operations strip SIDs/uuids/integers, Redis commands are labelled by command name never by key, jobs by type never
by tenant. Tenant-level diagnostics belong in logs (every line carries the tenant) — not in metrics (§39, §339).

## 10. Distributed tracing
Ids and propagation only (D7): `trace_id` per request, `traceparent`-compatible; correlation carried through HTTP →
event → consumer → job → provider (one end-to-end test reads the same id off every hop). No span exporter and no
span tree: adding a dependency with no destination is cost without visibility. When a collector exists, the ids do
not change. Not claimed as "distributed tracing implemented" in the DoD (PARTIAL).

## 11. API monitoring
Every route: requests, duration histogram, in-flight, 429s, status class — per route template, per method. Per-minute
aggregates persisted for 35 days (additive upsert, so several instances share one table). System Operations shows
top failing and slowest routes over the last hour. SLIs in §26.

## 12. Database monitoring
At the `pg` client Kysely hands out (one choke point): every query counted/timed/fingerprinted; slow-query log by
fingerprint (parameters never present — compiled SQL carries placeholders; IN-list length and batched INSERT rows
collapse to one shape); pool total/idle/active/waiting and utilisation; N+1 detector per request. Health: a real
`select 1` probe with a 2 s timeout, pool saturation only when callers are WAITING, query error rate. Alert:
`database` OUTAGE is P1 and suppresses API/booking/checkout/workers/events alerts as symptoms. Honest limit: the
pgtest harness drives Kysely through its own driver, so the pool wrapper is proven against a pg-shaped fake.

## 13. Redis monitoring
At `makeIoredis` (the single constructor): every command by role (realtime/cache/throttle/ratelimit/ai) and command
name; connection state and reconnects from the client's own events; INFO (memory, evictions, blocked clients, hit
ratio — null when idle, never 100%) on demand, throttled to one per client per 15 s, never from a reconnecting client.

## 14. Queue monitoring
There is no queue product (D2). The outbox (Constitution 8) provides pending/claimed/published/failed, oldest-pending
age, dead letters by consumer, consumer lag — read by the aggregator every 30 s (Phase 8). Health is judged by
oldest-pending age, not count (§46).

## 15. Worker monitoring
All 21 in-process schedulers plus the metrics flusher, retention and probes run through `runJob`: started/completed/
failed with duration and attempt, in job context; metrics by job CLASS; queue-wait vs processing; a last-run registry.
The registry LEARNS each scheduler's cadence from the gap between starts, so a scheduler that silently stops ticking
is caught (3× its interval) without any of the 21 declaring an interval. A coverage guard fails if a scheduler calls
its tick bare.

## 16. Events
As §14; plus every event raised inside a request inherits its request/correlation ids (closing audit problem 2 —
three events from one request were three unrelated chains).

## 17. Realtime
Constitution 9's counters bridged into the registry (same numbers, one more reader) and its own verdict used for
the `realtime` component; event-loop lag measured. Realtime is IMPORTANT: it can pull the platform to DEGRADED, never
OUTAGE.

## 18. Twilio
Three clients (SMS, Numbers, TrustHub) instrumented at their injected fetch: calls by operation (SIDs stripped),
latency, category. 5xx/timeout/network open the circuit (5 consecutive → 30 s); 401/403 do NOT — our credentials are
not Twilio's outage (§299). `communications` health from the provider group; `twilio-outage` runbook.

## 19. Email
SendGrid at its injected fetch, same categories; part of `communications`.

## 20. Push
FCM at its injected fetch; APNs speaks raw HTTP/2 and reports its three outcomes directly. Part of `communications`.

## 21. Payments
CardPointe (3 sites), Clover, Fiserv at their injected fetch. A card DECLINE is a 2xx and is never a provider
failure — twenty declines leave CardPointe HEALTHY (§58). `payments` is CRITICAL; one processor out of several is
DEGRADED, all out is OUTAGE/P1. Checkout SLI and latency SLO in §26–27.

## 22. AI
Constitution 10's breakers, cost/usage logs and control plane are read by the aggregator as the `ai` component —
OPTIONAL: an AI outage never moves the platform status and alerts at P3/P4.

## 23. Storage
**NOT DONE.** No storage-adapter instrumentation and no storage dashboard. See §57.

## 24. Mobile
The same `AppErrorBoundary` + fetch observer ship in every app, including the Capacitor-wrapped ones; crash reports
carry app, kind, route path, version and the failed request id. No native crash SDK; no per-version dashboard.

## 25. POS frontend
Error boundary (recovery screen, "Reference: req_…", never a stack), global error/rejection handlers, a fetch observer
(no call site edited), deduplicated/capped/path-only reporter that never throws. A wiring guard fails if any app
lacks the boundary. Server intake: public by necessity, allow-listed, capped, scrubbed, rate-limited, always 204.

## 26. Business SLIs
21 routes → workflows: login, customer_search, booking_availability, phone_verification(_send), booking_completion,
check_in, queue_assignment, service_completion, checkout_payment, refund. Outcome: success / business_failure (4xx —
the system said no; never pages) / rate_limited / system_failure (5xx; dependency failures named, not "internal").
Reliability = 1 − system_failures/total; provider outages COUNT (§83). No traffic → null, never 100%. A guard fails if
a table route is served by no controller.

## 27. SLOs — targets vs validated
**All five are PROPOSED. None is a validated production result (§80).** API availability 99.5% · booking completion
99% · phone verification 98% (Twilio outages count) · checkout payment 99.5% (declines excluded as 4xx) · checkout
latency 95% ≤ 2.5 s. 30-day windows from the per-minute table (one query each). A test fails if any is marked
validated; the screen badges each one; burn alerts say PROPOSED. Revisit after 30 days of production data.

## 28. Error budgets
Budget = what the target allows over traffic seen; remaining goes negative on overspend (not clamped); null with no
traffic. Multi-window burn: PAGE at 14.4× over 1 h and the last 5 min; TICKET at 6× over 6 h and 30 min; minimum 50
requests. Computed every 5 minutes; suppressed while the SLO's component is already alerting.

## 29. Health aggregation
Components (13): api, database, redis, realtime, workers, events, payments, communications, ai, booking, checkout,
synthetic, backups — each with criticality, owner, runbook. Every 30 s: window deltas over the last 5 minutes →
evaluator → hysteresis (2 worse / 3 better) → rollup (worst-of CRITICAL; IMPORTANT caps at DEGRADED; OPTIONAL
ignored; UNKNOWN critical → UNKNOWN overall) → `status_components` (source=computed, reason, expires_at) → history on
CHANGE only. Human MAINTENANCE never overridden. Expired → UNKNOWN at read time. **Tenant and branch health: NOT
DONE** (§57).

## 30. Alerts
Severity by impact: OUTAGE×CRITICAL P1, OUTAGE×IMPORTANT / DEGRADED×CRITICAL P2, OUTAGE×OPTIONAL / DEGRADED×IMPORTANT
P3, DEGRADED×OPTIONAL P4; blind-UNKNOWN on a critical component P2; idle-UNKNOWN nothing. Grouped by dependency
(database → api/booking/checkout/workers/events; redis → realtime; api/database → synthetic), transitively. Reconciled
statelessly each tick into the existing `alerts` table: raise / escalate (re-surfaces as unread) / never downgrade /
resolve; per-EPISODE dedupe keys; platform-scoped (`tenant_id IS NULL`). SLO burn alerts under `slo:<id>`.

## 31. Runbooks
`RUNBOOKS.md`: api-outage, database-outage, redis-outage, queue-backlog, worker-crash-loop, realtime-outage
(→ REALTIME_RUNBOOKS.md), twilio-outage, email-outage, payment-processor-outage, ai-provider-outage, storage-outage,
backup-failure, deployment-failure, cross-tenant-security-incident, synthetic-probe-failure. Each: symptoms, how to
confirm, immediate mitigation, safe, unsafe, escalation, recovery verification. Written from the code; the first real
incident of each kind should edit it. A guard resolves every alert link to a real heading.

## 32. Synthetic monitoring
`api_ready` (through `SYNTHETIC_BASE_URL` — the public edge), `kiosk_config` (only for `SYNTHETIC_KIOSK_SLUG`, a
dedicated synthetic tenant), `db_write` (token written to its own table and read back). Unconfigured = skipped.
No probe touches payments, verification or messaging. **Not built:** sandboxed payment probe, controlled-number SMS
probe (§94–95).

## 33. Backup monitoring
`POST /internal/backups/report` (shared secret; refuses everything when none is configured). Health from the reports:
failed latest → OUTAGE; no success in 26 h → stale; PITR as reported. **No job posts reports yet** — `backups` reads
UNKNOWN `never_reported` until one does.

## 34. Restore testing
Reported drills with integrity and smoke-test flags; a failed drill or none in 90 days → DEGRADED. **No drill has
been run in this environment.**

## 35. Deployment monitoring
`deploymentVersion` on every log line, `aipowersalon_build_info{version,commit}` in the registry, version/commit on
`/health`. **On Railway this is automatic:** commit, deployment id and environment come from Railway's own
`RAILWAY_GIT_COMMIT_SHA` / `RAILWAY_DEPLOYMENT_ID` / `RAILWAY_ENVIRONMENT_NAME`, and the version is package.json plus the
short commit (`1.0.0+62eb613`) so two releases never share a label. `railway.json` now gates each release on
`/health/ready`: a release that cannot reach the database never takes traffic. No health gate, canary
comparison or automatic rollback (§231–233): NOT DONE.

## 36. Incident management
`status_incidents` hardened in place: MITIGATING added (fixing the funnel double-count), detected_at, resolution,
promoted_from_alert_id; `status_incident_events` timeline. One rule set: forward only; SEV1/SEV2 need a commander to
leave Investigating and a written resolution to resolve. Alert → incident promotion (detected_at = alert time;
idempotent; platform alerts only). Postmortems owed listed. Timeline and commander are not yet surfaced in the UI.

## 37. Security monitoring
The security domain (security_incidents, audit runs) stays separate (§119, D8); observability now EMITS into it.
§120: TenantContextMiddleware already stripped client-supplied tenant ids; it now also NOTICES a request that names a
tenant other than the caller's own (echoing your own tenant, or a different branch, is not a signal). Every attempt →
a WARN log and a counter; 5 by one account in 10 minutes → one `security_incidents` row (category
`cross_tenant_access`, source `observability`) and one platform alert that pages by email (P2 — the attempts were
blocked; §99's P1 is data actually crossing). Idempotent per account per hour across instances. The block itself is
unchanged and tested to still hold.
§121 / §205–209: `integrity-checks.ts` runs 18 curated tenant-consistency invariants (appointments, queue, tickets,
payments, refunds, payment intents, technicians, customers, gift cards, memberships) two minutes after boot and every
six hours — read-only, bounded, a statement timeout per check, NULL never a mismatch. Any violation is an OUTAGE of the
CRITICAL `data_integrity` component → a P1 page with the offending row ids in the log; it never repairs (§209). The
component is a SEVERITY signal, not availability: it never moves the platform status, because salons can still work
while it is investigated. The list is curated, not derived from the 86 declared foreign keys: some relationships may
cross salons by design, and a critical check must not page on legitimate data.

## 38. Super Admin
System Operations: overall status, component cards (status, reason, owner, runbook, 30-day history), open platform
alerts, API top failing/slowest routes, SLOs with budgets and PROPOSED badges, release marker; stale banner; never
fake green. Existing: System Status (incidents, maintenance, public updates), System Health (process/DB), Events,
Live Ops, AI control plane.

## 39. Tenant health
`GET /super-admin/tenants/:tenantId/health` (§293) — one salon, on demand, from facts the platform already keeps per
salon (never a tenant label on a metric, §339): payments (payment config status and merchant onboarding — card
attempt failures are shown but never judged, many are customer declines, §58), messaging (the salon's own Twilio
credentials, its A2P campaign, 24 h delivery), booking (verification codes, already aggregated per day), devices
(active devices not seen in 24 h — a salon closed overnight is not offline), jobs (failed AI jobs, failed imports).
§300 states per component, a reason support can read, and an overall that is the worst IN-USE component — no opaque
score (§157); features a salon does not use never move it. §299: a salon's own misconfiguration is MISCONFIGURED,
distinct from a provider outage. A fact query that fails makes its component UNKNOWN and named — never "not
configured" (SILENT-SQL-RISK). Not built: an all-salon snapshot table and list view (§344, §156). The existing churn
score is a different question and stays.

## 40. Request search / 41. Correlation search
NOT DONE. Every log line carries `requestId` and `correlationId`, so any log store that indexes stdout answers both
by a single filter — but this tree has no log store, and §182 forbids handing the browser vendor credentials.

## 42. Privacy — what is intentionally excluded from logs
Passwords, OTPs, MFA/recovery codes, tokens, API keys, provider secrets, card numbers/CVV/track data, SSNs, tax ids,
account numbers, full prompts/completions/transcripts, request bodies (never logged), Redis keys, SQL parameters,
query strings from browsers, error MESSAGES as metric labels (codes only). Phones and emails are masked, not logged.

## 43. Retention
`platform_request_metrics_minute` 35 days; `system_health_snapshots` 400 days (rows only on change); alerts and
incidents: existing policies; logs: whatever the platform's log service keeps (not in this tree).

## 44. Cost
No vendor, so no ingestion bill. Cost controls that exist: the cardinality guard, label-value caps, route templates,
per-minute aggregation instead of per-request rows, bounded in-memory buffers (4,000 route keys; 200 slow queries;
20 crash reports per page; rate-limited intake), one INFO per Redis client per 15 s.

## 45. Failure tests — results
Health: DB down → 503; DB hanging → 503 within the timeout; providers ignored. Telemetry: sink throws / slow / absent
→ request and job unaffected. Aggregator: probe failure → OUTAGE after hysteresis; stale snapshot → UNKNOWN. All pass.

## 46. Redaction tests — results
81 key-iteration tests + value masking + 7 end-to-end; the redaction module was mutation-tested (8 mutations caught).
Pass.

## 47. Context isolation tests — results
Two interleaved async flows each log their own tenant; two concurrent jobs each log their own tenant; a job does NOT
inherit an outer context (by design, §376). Pass.

## 48. Load tests
**Not run.** No load harness exists in this tree (§283). The registry, aggregation buffers and intake are bounded by
construction, but that is design, not measurement.

## 49–50. Files changed / created
136 files touched since `86171f7`: 69 created, 65 modified, 2 deleted (the old per-request interceptor and its test).
Patch 19 in `patches/` carries all of them; `git diff --name-status 86171f7..HEAD` lists each.

## 51. Infrastructure changes
None required to run. Optional later: point a Prometheus/OTel collector at the registry's exposition; a log service that
indexes stdout by `requestId`/`correlationId`.

## 52. Environment configuration (non-secret)
`LOG_LEVEL`, `DB_SLOW_QUERY_MS` (250), `BACKUP_MAX_AGE_HOURS` (26), `SYNTHETIC_BASE_URL`, `SYNTHETIC_KIOSK_SLUG`,
`APP_VERSION`, `GIT_SHA`, `REALTIME_BUS`, `NODE_ENV`, `VITE_API_BASE`, `VITE_APP_VERSION`.

## 53. Secrets required
`BACKUP_REPORT_TOKEN` (shared secret for backup reports; the route refuses everything until it is set). No monitoring
vendor keys.

## 54. Deployment order
1. Migrations 443–447 (all additive; 444 and 445 replace a CHECK by name and fail loudly on mismatch — test on a copy).
2. API (interceptor replacement, middleware, aggregator start automatically).
3. Set `APP_VERSION`/`GIT_SHA` in the pipeline; set `SYNTHETIC_*` to a synthetic tenant; set `BACKUP_REPORT_TOKEN`
   and wire the provider's backup job.
4. Web apps (error boundary is inert until the API exposes `x-request-id` — already in step 2).

## 55. Migration plan (from legacy)
`platform_request_metrics` (per-request rows) is no longer written; its reader now uses the per-minute table. Drop the
old table after its own retention window. `status_components` keeps its rows; the aggregator takes over their status
(manual maintenance excepted). No other legacy monitoring to migrate.

## 56. Rollback
Revert the API release: the interceptor and middleware are in `app.module.ts` and the aggregator in
`ObservabilityModule`; the migrations are additive and can stay. The status page would return to human-typed statuses.

## Addendum — turned on for the Railway deployment
Railway injects its commit, deployment and public domain into every deployment, so without any configuration: release
markers are live; the synthetic readiness probe runs against `https://$RAILWAY_PUBLIC_DOMAIN`; the database write probe,
aggregator, alerts, SLOs and retention start with the API; and Railway switches traffic only when `/health/ready`
passes. Still needs Kevin: backups (enable in Railway, set `BACKUP_REPORT_TOKEN`, run `scripts/report-backup.mjs`
from the backup job). Deliberately off: the kiosk probe, which needs a test-salon flag that analytics and billing
exclude before any test salon can exist. Steps are in `DEPLOY_RAILWAY.md`.

## Addendum — alerts now reach a human (§262–265, migration 448)
P1 → email + SMS, P2 → email, P3/P4 → the screen only. Email goes to every ACTIVE, tenant-less Super Admin account
(already in `users`) plus `ONCALL_EMAIL`, so it works with SendGrid alone; SMS goes to `ONCALL_PHONE` (E.164) — accounts
store no phone. Paged on raise and on escalation into a paged severity, never twice for one severity; one reminder
for a P1 still unacknowledged after 15 minutes; one "resolved" notice for a paged alert that clears. Exactly once
across restarts and instances (conditional-UPDATE claim); a failed send releases its claim and retries at most five
times. A configured sender with nobody to send to logs `page.no_recipients` rather than failing silently.

**The kiosk probe stays off, by decision:** a test salon would need excluding from 82 files that read tenants
(counts, revenue, billing, the customer app's nearby search). That blast radius outweighs the small extra signal
over the readiness and database-write probes.

## 57. Remaining risks — nothing hidden
- **Monitoring gaps:** storage metrics/dashboard; all-salon and branch health snapshots (single-salon health is on demand); mobile dashboard; deployment
  health gates/canary/rollback; request/correlation search and trace-log linking (need a log/trace store);
  per-component dashboards; the integrity invariant list is 18 relationships, not all 86 declared ones beyond cards; incident timeline/commander
  not yet in the UI; CPU/RSS/heap not in the registry.
- **Provider visibility limits:** backups read UNKNOWN until the provider's job posts reports; no restore drill has run;
  no sandbox-payment or SMS probe (superseded Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep): BUILD_PLAN Phase 14 added both — CardPointe UAT and Twilio test-credential synthetic probes, `SYNTHETIC_PAYMENT_SANDBOX_*` / `TWILIO_TEST_*`, HOSTING D4); the `pg` pool wrapper is proven against a fake, not a real Postgres client.
- **Alert gaps:** paging now exists (below), but there is no escalation chain beyond one reminder, no Slack, and no
  field-level telemetry permissions (§181); a single `super_admin.system_operations.view`.
- **Privacy risks:** free-text `detail` in backup reports and `body` in incident timelines are operator-written and not
  redacted; crash-report stacks are scrubbed by pattern, not proven exhaustive.
- **Capacity concerns:** no load test; buffers are bounded by design only; the SLO query scans up to 35 days of
  per-minute rows per SLO every 5 minutes (indexed, but unmeasured at scale).
- **Targets:** every SLO is PROPOSED; the hysteresis, thresholds and burn constants are reasoned defaults, not tuned.
- **Lint:** no lint script is wired to the gates; "Lint passes" is unverified.
