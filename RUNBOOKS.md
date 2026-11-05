# RUNBOOKS.md — AI PowerSalon operations runbooks

Constitution 11 §178–179. Every health alert links to one of these (the component registry in
`apps/api/src/observability/health-core.ts`; a test fails if a link points at a heading that does not exist).
Realtime has its own detailed runbook in `REALTIME_RUNBOOKS.md`.

Each runbook: **Symptoms · How to confirm · Immediate mitigation · Safe actions · Unsafe actions · Escalation ·
Recovery verification.** "The alert" means the Super Admin alert raised by the health aggregator; "status" means
`status_components` (the public status page) and the aggregator's reason code on it.

> These were written from the code, not from an incident. The first real incident of each kind should be followed by
> an edit here — §174 asks why monitoring did or did not detect it, and this file is where the answer lands.

---

## api-outage

**Symptoms.** Screens across every app fail to load; the error screen shows "Reference: req_…"; `api` is DEGRADED
(`server_error_rate` ≥ 5% or `latency_p95` ≥ 2 s) or OUTAGE (≥ 25% server errors) over the last 5 minutes.

**How to confirm.** Is it every route or a few? `aipowersalon_api_requests_total{status_class="5"}` by `route`. Look up
two references from affected users in the logs (`requestId`) — the exception name and fingerprint are on the line.
If `database` is also failing, this alert is suppressed and the database runbook applies instead.

**Immediate mitigation.** A deployment in the last hour? Roll the API back to the previous release. One route only?
Its module's kill switch or the maintenance middleware for that surface.

**Safe.** Roll back a stateless API release. Restart API instances. Scale out API instances.

**Unsafe.** Rolling back a release that ran a migration without checking the migration is backward-compatible.
Disabling the exception filter or request middleware "to reduce noise".

**Escalation.** Platform owner. P1 if checkout or booking is affected platform-wide.

**Recovery verification.** `api` back to HEALTHY for three consecutive evaluations (the aggregator requires it).
The references users reported now return 2xx on retry.

## database-outage

**Symptoms.** `database` OUTAGE (`probe_failed`) or DEGRADED (`pool_saturated`, `query_errors`). API, booking,
checkout, workers and events alerts are suppressed and listed under "Also affecting" on this one.

**How to confirm.** Probe: can a fresh connection run `select 1`? Pool: `aipowersalon_db_pool_connections{state}` —
`waiting` > 0 with utilisation near 1 is starvation, not an outage. Slow queries: the slow-query log (by fingerprint)
shows which shape is holding connections.

**Immediate mitigation.** Provider outage → wait/fail over per the provider. Starvation → find the fingerprint
holding connections; if it is a report or export, stop that job. Long transactions → identify and cancel the query.

**Safe.** Cancel a specific long-running *read* query. Raise the pool size within the database's connection limit.
Pause report/export/import schedulers.

**Unsafe.** Killing write transactions mid-checkout. Restoring from backup without an incident commander.
Truncating any table to free space.

**Escalation.** Platform owner immediately — P1.

**Recovery verification.** `database` HEALTHY three times running; suppressed dependents recover on their own. Check
the outbox (`events`) drains — writes that failed during the outage may need their events replayed.

## redis-outage

**Symptoms.** `redis` DEGRADED (`down:<role>` names which clients) or OUTAGE (all clients down).

**How to confirm.** Which roles are down: `aipowersalon_redis_connection_up{role}`. `realtime` down means live
updates fall back to single-instance delivery; `cache` down means slower reads; `throttle`/`ratelimit` down means
those protections fail open (by design).

**Immediate mitigation.** Provider issue → provider. Memory → `aipowersalon_redis_memory_utilisation_ratio` and
evictions; a runaway key category is a cache leak.

**Safe.** Restart the Redis client side (API instances). Flush a *cache* namespace. Scale Redis memory.

**Unsafe.** `FLUSHALL` on an instance that also holds rate-limit or session state.

**Escalation.** Platform owner. P2 (important, not critical — the platform degrades, it does not stop).

**Recovery verification.** Every role `up=1`; realtime backbone publish failures stop rising.

## queue-backlog

**Symptoms.** `events` DEGRADED (`publish_lag`, oldest pending ≥ 2 min; or `dead_letters`) or OUTAGE
(`publish_backlog`, ≥ 15 min).

**How to confirm.** Super Admin → Events: outbox by status, oldest pending age, dead letters by consumer, consumer
lag. A growing oldest-pending age with a flat count means the publisher is stuck, not overloaded (§46).

**Immediate mitigation.** Publisher stuck → restart the API instance running it. One consumer failing → its dead
letters show the error; fix, then retry from the Events screen.

**Safe.** Retry dead letters from the Events screen. Restart publishers/consumers.

**Unsafe.** Deleting outbox rows. Marking dead letters resolved without replaying them. Replaying a
non-idempotent consumer without checking its idempotency key.

**Escalation.** Platform owner. P2.

**Recovery verification.** Oldest pending age back under a minute; dead letters retried or explicitly discarded
with a reason.

## worker-crash-loop

**Symptoms.** `workers` DEGRADED with `stalled:<job types>` (a scheduler has not started in 3× its learned
interval) or `failing:<job types>` (its last run failed after its last success).

**How to confirm.** The job registry names the job type. Logs: `job.failed` lines for that `jobType` carry the error
and the tenant/correlation context. A *stalled* job produces no error at all — that is exactly why this check exists.

**Immediate mitigation.** Stalled → restart the instance (in-process schedulers restart with it). Failing → read the
error; a data problem in one tenant should not stop the sweep for all.

**Safe.** Restart API instances. Run the sweep manually once the cause is fixed.

**Unsafe.** Running a billing, payroll or reconciliation sweep twice without checking its idempotency.

**Escalation.** The job's owning module. P2 for billing/payroll/reconciliation jobs; otherwise P3.

**Recovery verification.** The job's last start is recent and its last run succeeded.

## realtime-outage

See `REALTIME_RUNBOOKS.md`. Summary: `realtime` reflects Constitution 9's own verdict (reconnect storm, auth spike,
delivery lag, backbone publish failures). Screens still work without realtime — they are slower to update, not wrong.

## twilio-outage

**Symptoms.** `communications` DEGRADED (`outage:twilio` while email/push still work) or OUTAGE. Phone verification
and booking SLIs show `system_failure` with a dependency category.

**How to confirm.** `aipowersalon_provider_calls_total{provider="twilio"}` by `category`: `provider_error`/`timeout`
is Twilio's side; `client_error` (401/403) is OUR credentials or configuration — that does not open the circuit and
is a tenant-configuration problem, not an outage (§299). Check Twilio's status page as corroboration only (§245).

**Immediate mitigation.** Provider outage: nothing to fix on our side; the circuit breaker stops hammering them.
Consider the booking-verification emergency disable if bookings are blocked for a long outage.

**Safe.** Wait. Use the verification override for affected salons per its policy.

**Unsafe.** Rotating credentials during a Twilio outage (it will not help and adds a second change). Disabling
verification platform-wide without an incident commander.

**Escalation.** Communications owner. P2.

**Recovery verification.** The circuit closes (one success) and error rate falls; verification SLI recovers.

## email-outage

As `twilio-outage`, for `provider="email"` (SendGrid). Email is not on the booking critical path.

## payment-processor-outage

**Symptoms.** `payments` DEGRADED (one processor out, others serving) or OUTAGE (all). `checkout` may alert
separately if checkout itself fails for another reason; if payments is the cause it is listed under "Also
affecting".

**How to confirm.** `aipowersalon_provider_calls_total{provider=~"cardpointe|fiserv|clover"}` by `category`. A rise
in DECLINES is not an outage — declines are 2xx and never counted as provider failures (§58).

**Immediate mitigation.** Salons can take cash and record card payments manually; tell affected tenants through
the status page and tenant notification. Do not retry charges automatically.

**Safe.** Status page update. Tenant notification. Wait for the processor.

**Unsafe.** Re-running captures or refunds in bulk. Switching a merchant's processor during the outage.

**Escalation.** Payments owner and platform owner — P1 if all processors are out.

**Recovery verification.** Circuit closed, error rate normal; reconcile any card payments taken manually.

## ai-provider-outage

**Symptoms.** `ai` DEGRADED/OUTAGE. It is OPTIONAL: the platform stays HEALTHY and this alert is P3/P4.

**How to confirm.** The AI control plane (Constitution 10) shows breaker state per provider and the router's
fallback. Most AI tasks already fall back or degrade.

**Immediate mitigation.** None required for salon operations. Check the AI budget scheduler is not the cause.

**Safe.** Wait. Switch the task's routing to another provider in the AI control plane.

**Unsafe.** Raising AI budgets to "get it working" during an outage.

**Escalation.** AI owner. P3.

**Recovery verification.** Breakers closed; AI job completion rate recovers.

## storage-outage

**Symptoms.** Uploads (receipts, profile photos, OCR) fail; S3 adapter errors in logs.

**How to confirm.** Logs for the media storage adapter; provider status.

**Immediate mitigation.** Uploads are not on the checkout path; tell users to retry later.

**Safe.** Wait; retry failed OCR jobs afterwards. **Unsafe.** Changing buckets or credentials mid-incident.

**Escalation.** Platform owner. P3.

**Recovery verification.** A test upload succeeds; queued OCR jobs complete.

## backup-failure

**Symptoms.** `backups` OUTAGE (`backup_failed`: the latest report was a failure; or `no_successful_backup`) or
DEGRADED (`stale`: no successful backup reported in 26 h — the reports STOPPING is itself the signal;
`restore_drill_failed`; `restore_drill_overdue`: no drill in 90 days). `never_reported` means the backup job has
never posted a report: not an alert, but a gap until the job exists.

**How to confirm.** System Operations → Backups & Restore shows the last report, its age, PITR as reported, and the
last drill. Then the database provider's own backup console — the platform only knows what the job reports.

**Immediate mitigation.** Trigger a manual snapshot in the provider now. If the report is merely missing, check the
job and BACKUP_REPORT_TOKEN (a mismatched token is refused with 401 and nothing is recorded).

**Safe.** Manual snapshot; verify it completes; re-post its report. **Unsafe.** Deleting old snapshots to "make
room" before a new one has succeeded. Setting a token so a script can post "success" without a real backup.

**Escalation.** Platform owner. P2 — do not wait for a disaster to find out (§115).

**Recovery verification.** A successful backup report newer than the failure; `backups` HEALTHY after three
evaluations; a restore drill within 90 days with integrity and smoke test passing.

## deployment-failure

**Symptoms.** Error rate or latency jumps right after a release; a migration failed.

**How to confirm.** Compare the time of the first errors with the release time. Failed migration: the deploy log.

**Immediate mitigation.** Roll back the application release. A failed migration blocks the rollout by design.

**Safe.** Roll back a release whose migrations are additive. **Unsafe.** Rolling back a migration automatically
(§232), or re-running a half-applied migration without reading it.

**Escalation.** Whoever released. P1/P2 by impact.

**Recovery verification.** Error rate back to the pre-release baseline.

## cross-tenant-security-incident

**Symptoms.** A security signal that one tenant's actor reached another tenant's resource, or an internal record
whose tenant does not match its resource (§120–121).

**How to confirm.** Security incidents screen (`security_incidents`) — kept separate from operations on purpose (§119).

**Immediate mitigation.** Revoke the actor's sessions. Preserve evidence (audit logs, request ids). Do not "fix" the
data before it is understood.

**Safe.** Session revocation, account suspension, evidence preservation. **Unsafe.** Deleting or editing the
records involved; discussing tenant identities outside the incident.

**Escalation.** Platform owner immediately — P1 regardless of volume.

**Recovery verification.** Root cause identified; the path is closed and covered by a test; affected tenants
informed per policy.

## synthetic-probe-failure

**Symptoms.** `synthetic` DEGRADED or OUTAGE with `failing:<probe>(<detail>)`. The probe has failed at least twice in
a row, and the aggregator's hysteresis has seen it again — one flaky request never gets here.

**How to confirm.** Which probe, and what it saw: `api_ready(http_503)` means an instance reported not-ready through
the public edge; `api_ready(timeout)` or `(network_error)` points at DNS, TLS or the load balancer — things the API's
own metrics cannot see; `kiosk_config(http_404)` means the synthetic tenant's kiosk slug was removed or renamed;
`db_write(write_failed)` means the write path is failing even if `select 1` still works. If `api` or `database` is
already alerting, this alert is suppressed as a symptom.

**Immediate mitigation.** Edge failures: check the load balancer's target health and the certificate. A missing
synthetic kiosk: recreate it in the synthetic tenant — never point the probe at a real salon's kiosk.

**Safe.** Re-point SYNTHETIC_BASE_URL at the public edge. Recreate the synthetic tenant's kiosk device.

**Unsafe.** Aiming SYNTHETIC_KIOSK_SLUG at a real tenant to "make the probe pass" (§93). Disabling the probes during an
incident — they are one of the independent signals that confirm recovery.

**Escalation.** Platform owner. P2 when api_ready fails through the edge; otherwise P3.

**Recovery verification.** Every configured probe passing again; `synthetic` HEALTHY after three evaluations.

## worker-split

Moving background jobs onto their own Railway service (Constitution 13 §60–61, decided Oct 3 2026). Today one service
runs the API with `PROCESS_ROLE=all`: HTTP plus every scheduler and the outbox publisher. The split runs the jobs in a
second service built from the same repository and image (config path `railway.worker.json`: `node dist/worker.js`, no
migrations, no HTTP health check).

**Symptoms** (that the split is needed, or that a split went wrong). Web replicas scaled for traffic multiply scheduler
runs; or, after a split, the Background Jobs panel shows schedulers no longer ticking, domain events pile up in the outbox,
and the API boot log shows `[events] this process (PROCESS_ROLE=api) does not run the outbox publisher`.

**How to confirm.** Super Admin → System Health → Background Jobs: last-tick times per scheduler and which instance ran
them. The worker's log prints `[worker] started — PROCESS_ROLE=worker, job classes: …` and the outbox publisher line.

**Immediate mitigation.** Set `PROCESS_ROLE=all` on the web service again and redeploy — jobs resume on the web replicas.

**Safe actions.** Rollout order, worker FIRST: (1) create the worker service from the same repository with config path
`railway.worker.json`; (2) give it the same `DATABASE_URL`, `REDIS_URL`, `AUTH_SESSION_SECRET`, `SERVICE_TOKEN_SECRET` and
provider keys (shared variables) plus `PROCESS_ROLE=worker`; (3) deploy it and confirm the started line and the outbox
publisher line; (4) only then set `PROCESS_ROLE=api` on the web service and redeploy. Keep the worker at 1 replica unless
the panel shows a backlog. More than one worker replica is safe — and so is `PROCESS_ROLE=all` on several web replicas
(bug E5, corrected Oct 8 2026): every scheduler tick is single-owner across processes (`runTick` takes the
`scheduler_runs` lease, migration 518; a guard test fails on a `setInterval` that skips it), the job queue and the outbox
both claim with `FOR UPDATE SKIP LOCKED`, and a dead worker's jobs come back when its lease lapses
(`apps/api/scripts/drills/drill-worker-loss.mjs`: worker SIGKILLed mid-run, 12/12 jobs completed once). The only
processes that must not multiply are the three process-LOCAL schedulers (`PROCESS_LOCAL_SCHEDULERS` in
`tooling/architecture-tests/graph.mjs`), and they are per-process by design.

**Unsafe actions.** Setting `PROCESS_ROLE=api` on the web service BEFORE the worker is running (jobs stop for the gap);
running a worker without the same secrets (service tokens and sessions fail); giving the worker its own migration step
(the web service runs migrations).

**Escalation.** Platform owner. P2 — bookings and checkout keep working; reminders, events and rollups lag.

**Recovery verification.** Every scheduler ticks from the worker instance within one interval, the outbox drains, and
the web service's log shows no scheduler lines.

## break-glass-maintenance

The environment switch that closes the platform WITHOUT the database (BUILD_PLAN Phase 11, Constitution 4 §139;
`apps/api/src/common/maintenance-break-glass.ts`). Use it when the Super Admin maintenance screen cannot help: Postgres
down, a migration half-applied, a bug writing bad rows. Values: `MAINTENANCE_BREAK_GLASS=off` (default) · `read_only`
(every non-GET/HEAD answers 503 `MAINTENANCE_READ_ONLY` — except `/health/*`, sign-out and CORS preflight; provider
webhooks get the 503 too and retry later) · `full` (everything except `/health/*` and `/metrics` answers 503
`MAINTENANCE_FULL`). `MAINTENANCE_BREAK_GLASS_MESSAGE` is the text people see (no secrets — it goes to every client).

**Symptoms** (that it is needed). Data is being written wrongly and the cause is not yet fixed; the database is down or
being restored; a release must be stopped before more writes land. (That it is ON: every write answers 503
`MAINTENANCE_READ_ONLY`, or everything answers `MAINTENANCE_FULL`, and the boot log names the mode.)

**How to confirm.** `curl -s -X POST https://<api>/auth/login` → 503 with code `MAINTENANCE_READ_ONLY` / `MAINTENANCE_FULL`;
`GET /health/live` still 200. System Operations shows the mode when the API can reach the database.

**Immediate mitigation.** Railway → API service (and the worker service, if split) → Variables →
`MAINTENANCE_BREAK_GLASS=read_only` (or `full`) → the service restarts with it. To lift it: `off` (or delete the
variable) → restart.

**Safe actions.** `read_only` while investigating a data problem (reads keep working, nothing new is written);
`full` during a database restore (`DISASTER_RECOVERY.md` §3.1). Post a status incident so salons know.

**Unsafe actions.** Leaving `full` on after the incident (the platform is closed to everyone — there is deliberately no
Super Admin bypass, the role lives in the database). A typo: an unknown value is IGNORED (the platform stays open) and
logged — re-read the boot log after setting it. Using it for planned maintenance (use the Super Admin maintenance screen).

**Escalation.** Platform owner. Setting it is itself a P1 decision — write it in the incident record.

**Recovery verification.** After `off`: a write succeeds (e.g. a test ticket note), `GET /health/ready` 200, provider
webhooks that got 503 have been redelivered (CardPointe / Twilio retry on 5xx — check their consoles if in doubt).

## stranded-payment-attempts

Card attempts stuck in `processing` (BUILD_PLAN Phase 11, Constitution 4 §116; `modules/checkout/src/checkout/payment-attempt-sweep.ts`,
job `payments.stranded_attempts`, every 5 minutes, class `critical`). An attempt older than
`PAYMENT_ATTEMPT_STRANDED_MINUTES` (default 15, never below 5) is resolved from the PROCESSOR'S answer only (inquire by
order id through the tenant's existing adapter). The sweep never charges, voids or refunds.

**Symptoms.** Owner app → Alerts: `PAYMENT_NEEDS_REVIEW` (category `payment_review`); Super Admin → Alerts: "Payment needs
review" (type `payment`, one per attempt); a ticket that shows half-paid; a cashier told "already being processed".

**How to confirm.** The alert's metadata names the attempt (`kind`, `id`, `ticketId`, `amountCents`, `resolution`,
`processorReference` when the processor returned one). `resolution` says why: `provider_approved_unrecorded` (the card
WAS charged and nothing here recorded it), `provider_ambiguous`, `provider_no_inquiry` (the adapter has no status lookup),
`processor_not_connected`, `provider_unreachable` (no answer for 4× the threshold).

**Immediate mitigation.** None automatic by design. For `provider_approved_unrecorded`: the money is at the processor —
record it on the ticket (the cashier's Verify on the ticket runs the same reconciliation) or refund it in the processor's
console if the customer paid again another way. For the others: look the order id (= the ticket id) up in the
processor's portal and act on what it shows.

**Safe actions.** Verify from the ticket; refund or void in the processor's console with the processor reference; mark
the alert handled after the ticket matches the processor.

**Unsafe actions.** Re-running the charge (the attempt keeps its idempotency key, but a NEW attempt would charge again);
editing `payment_attempts` / `payments` rows by hand; lowering `PAYMENT_ATTEMPT_STRANDED_MINUTES` below 5 (it is clamped
— a lower threshold would race charges still legitimately in flight).

**Escalation.** Platform owner + the salon owner. P1 when `provider_approved_unrecorded` (a customer's card was charged).

**Recovery verification.** No attempt in `processing` older than the threshold; every `needs_review` attempt has a
matching processor record and a handled alert.

## metrics-scrape

`GET /metrics` — the Prometheus text exposition of the process's metrics registry (BUILD_PLAN Phase 11;
`apps/api/src/health/metrics.controller.ts`). `METRICS_TOKEN` set → `Authorization: Bearer <token>` required (constant-time
compare), else 401. No token in production → 404 (the route is off). No token elsewhere → open. Every replica serves its
OWN registry: scrape each replica (Railway private networking) or rely on System Operations for the fleet view.

**Symptoms.** The scraper reports the target down; 401 (token mismatch) or 404 (no token set in production).

**How to confirm.** `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $METRICS_TOKEN" https://<api>/metrics`
→ 200 and a body starting with `# HELP`. A 404 with the token set means the request did not reach this route (proxy path).

**Immediate mitigation.** 401 → set the scraper's bearer to the current `METRICS_TOKEN`. 404 → set `METRICS_TOKEN` on the
API service and restart.

**Safe actions.** Rotate `METRICS_TOKEN` (new value on the API and the scraper together). Scrape every 30–60 s.

**Unsafe actions.** Leaving production without a token "to make it work" by unsetting `NODE_ENV` (that also turns off
every production safety check); putting the token in a URL query string or a dashboard screenshot.

**Escalation.** Platform owner. P3 — metrics are observability, the platform is unaffected.

**Recovery verification.** The scraper shows the target up; `aipowersalon_api_requests_total` increases between scrapes.

## tracing

Distributed tracing (BUILD_PLAN Phase 11; `packages/observability/src/tracing/`). Off unless `OTEL_EXPORTER_OTLP_ENDPOINT`
is set; then spans (HTTP server, DB query shapes, provider calls, jobs) are batched to `<endpoint>/v1/traces` as OTLP/HTTP
JSON with `OTEL_EXPORTER_OTLP_HEADERS` (e.g. the backend's API key), service name `OTEL_SERVICE_NAME` (default
`aipowersalon-<PROCESS_ROLE>`), root sampling `OTEL_TRACES_SAMPLER_ARG` (0–1, default 1). Every API response carries a
`traceparent` header; an incoming `traceparent` is continued.

**Symptoms.** No traces in the backend; `aipowersalon_trace_spans_dropped_total{reason}` rising (`queue_full` = the
collector is slower than traffic; `export_failed` = unreachable or refusing).

**How to confirm.** `curl -sI https://<api>/health` shows a `traceparent` header (tracing context works); `/metrics` shows
`aipowersalon_trace_spans_exported_total` increasing (export works).

**Immediate mitigation.** `export_failed` → check the endpoint URL (no `/v1/traces` suffix — the exporter adds it) and the
headers variable; `queue_full` → lower `OTEL_TRACES_SAMPLER_ARG` (e.g. 0.1). Tracing never fails a request: to stop it,
unset `OTEL_EXPORTER_OTLP_ENDPOINT` and restart.

**Safe actions.** Change the sample ratio; point at another collector; unset the endpoint.

**Unsafe actions.** Adding request bodies, phone numbers, names or emails as span attributes (the code records route
templates, statement shapes and tenant ids only — keep it that way); putting the backend's API key anywhere but
`OTEL_EXPORTER_OTLP_HEADERS`.

**Escalation.** Platform owner. P3.

**Recovery verification.** `spans_exported_total` rising, `spans_dropped_total` flat; a request's trace in the backend
shows the server span with its DB and provider child spans under one trace id.


## noisy-neighbour

One salon is taking more than its share of the platform (BUILD_PLAN Phase 11, Constitution 4 §113/§160;
`apps/api/src/observability/capacity-ops.ts`, job `tenant.load.watch`). The alert fires while a single salon holds more than
50% of the last minutes' database time or request count; System Operations → Load lists the top 10 salons by database time
with their slow-query shapes.

**Symptoms.** The `noisy-neighbour` alert naming one salon; every other salon's p95 rising at the same time; one salon's
rows dominating Super Admin → Database → slow queries.

**How to confirm.** System Operations → Load: the named salon's share of requests and database time; its slow-query shapes
(statement fingerprints, never values). Compare with its usual day (the load series keeps 35 days). A runaway integration
or a bulk import shows as one shape repeated; a busy Saturday shows as the normal mix, only more of it.

**Immediate mitigation.** A runaway shape → tighten the salon's `api_requests_per_min` / `jobs_in_flight` quota (Super Admin
→ Plans → Quotas, or `PUT /super-admin/quotas/:tenantId`, step-up + reason); the tenant rate limiter answers 429 with
`Retry-After` to that salon only. A single pathological query → Super Admin → Database → cancel the backend (step-up). Real
business load → leave the quota, scale (replicas / a worker split) instead.

**Safe actions.** Lowering a quota (reversible, audited); cancelling one backend; reading the load series.

**Unsafe actions.** Disabling the tenant rate limiter platform-wide (`TENANT_RATE_LIMIT=off`) to relieve one salon — it
removes the only per-salon fairness control; suspending the salon (it is a customer with an open front desk).

**Escalation.** Platform owner. P2 while other salons are affected, P3 otherwise.

**Recovery verification.** The alert clears on the next `tenant.load.watch` tick; the salon's share is back under 50% and
other salons' p95 returns to baseline on System Operations.
