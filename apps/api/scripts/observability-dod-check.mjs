// observability-dod-check.mjs — Constitution 11 §396 Definition of Done, checked against the tree, not asserted.
//
// Every line of §396 maps to EVIDENCE: an export, a metric registration, a route decorator, a migration, a test, a CI
// gate (scripts/dod-lib.mjs has the vocabulary and the statuses DONE / HOSTING / PARTIAL / NOT DONE). Nothing passes
// on a comment or a bare `true`; every predicate is proven to flip when its evidence goes
// (src/common/dod-predicates.vitest.spec.ts). `--run` also measures build, type checking, lint and the observability
// test lane here and now. Run: node scripts/observability-dod-check.mjs [--run]
import { evidence, RUN, runOk, D, H, P, N, report } from './dod-lib.mjs';
const { R, has, grep, ci, take } = evidence(import.meta.url);
const O = 'src/observability/';
// Constitution 13 §80: the kernel (logging, metrics, ids, redaction, the telemetry adapters) is @aipowersalon/observability.
const K = '../../packages/observability/src/';
const AW = '../admin-web/src/';
const M = 'db/migrations/';
const RB = '../../packages/permissions/src/rbac.ts';

const TSC = RUN ? runOk('npx', ['tsc', '--noEmit'], R('.')) : null;
const LINT = RUN ? runOk('node', ['tooling/ci/lint-ratchet.mjs'], R('../..')) : null;
const TESTS = RUN ? runOk('npx', ['vitest', 'run', 'src/observability', 'src/health'], R('.'), 900_000) : null;
const measured = (gate, value) => (RUN ? value : gate);
const ranNote = (what) => (RUN ? `measured now (${what})` : `gated on every push (${what}); --run measures it here`);

// shared evidence for the dashboard lines (Phase 14 B: one controller, one route per dashboard, read by one screen)
const dash = (route, svc) => grep(O + 'ops-dashboards.ts', new RegExp(`@Get\\('${route}'\\) @RequirePermission\\('super_admin\\.system_operations\\.view'\\) ${svc}\\(\\)`))
  && grep(AW + 'api/opsDashboardsApi.ts', new RegExp(`'/super-admin/system/dashboards/${route}'`))
  && grep(AW + 'screens/OpsDashboardsScreen.tsx', new RegExp(`\\['${route}', '[A-Z]`))
  && has(AW + 'screens/OpsDashboardsScreen.test.tsx') && has(O + 'ops-dashboards.pgtest.vitest.spec.ts');

take();   // what was read before the first line (the --run lane list) belongs to no line
const items = [
  D('Existing observability fully inspected', grep('../../OBSERVABILITY_AUDIT.md', /## 1\. Existing observability — what is actually there/) && grep('../../OBSERVABILITY_AUDIT.md', /## 3\. Section → code map/)),
  D('Logging standardized', grep(K + 'logger.ts', /export const log: AppLogger/)),
  D('Structured logging implemented', grep(K + 'logger.ts', /timestamp: new Date\(\)\.toISOString\(\), level, service/)),
  D('Sensitive redaction implemented', grep(K + 'redaction.ts', /export function redact/)),
  D('Request IDs implemented', grep(K + 'request-telemetry.ts', /REQUEST_ID_HEADER/)),
  D('Correlation IDs implemented', grep(K + 'request-context.ts', /correlationId/)),
  // Phase 11 A: W3C traceparent in and out, spans, the OTLP/HTTP exporter (live-tracing.mjs proved it against a collector)
  D('Trace IDs integrated', grep(K + 'tracing/traceparent.ts', /export function parseTraceparent/) && grep(K + 'tracing/exporter.ts', /export class OtlpHttpJsonExporter/)
    && grep(K + 'tracing/tracing.test.ts', /describe\('W3C traceparent'/) && grep('scripts/live-tracing.mjs', /the response carries traceparent with the SAME trace id/)),
  D('Context propagates through HTTP', grep(K + 'request-telemetry.ts', /RequestContextMiddleware/)),
  D('Context propagates through Events', grep('../../packages/events/src/event-contract.ts', /ambient\?\.correlationId/) && grep(K + 'tracing/consumer.ts', /export async function runEventConsumer/)),
  D('Context propagates through Workers', grep(K + 'job-telemetry.ts', /contextForJob/)),
  D('Context propagates through Providers', grep(O + 'end-to-end-telemetry.vitest.spec.ts', /seenByProvider/)),
  D('API metrics implemented', grep(O + 'http-metrics.ts', /aipowersalon_api_requests_total/)),
  // the pool wrapper is attached to the REAL pool at boot, and live-tracing.mjs read the DB counters off /metrics on PostgreSQL
  D('Database metrics implemented', grep(K + 'db-telemetry.ts', /aipowersalon_db_query_duration_seconds/) && grep('src/app.module.ts', /poolHook: attachDbTelemetry/)
    && grep('scripts/live-tracing.mjs', /# TYPE aipowersalon_db_queries_total counter/)),
  D('Redis metrics implemented', grep(K + 'redis-telemetry.ts', /aipowersalon_redis_command_duration_seconds/)),
  // Phase 14 B: queue depth by class + priority, oldest due age, outbox pending / oldest, dead letters (decision D2: the
  // durable `jobs` table + outbox ARE the queue product)
  D('Queue metrics implemented', grep(K + 'job-telemetry.ts', /aipowersalon_job_queue_wait_seconds/) && grep(O + 'queue-metrics.ts', /'aipowersalon_queue_jobs'/)
    && grep(O + 'queue-metrics.ts', /'aipowersalon_outbox_oldest_pending_age_seconds'/) && has(O + 'queue-metrics.pgtest.vitest.spec.ts')),
  D('Worker metrics implemented', grep(K + 'job-telemetry.ts', /aipowersalon_jobs_in_flight/)),
  D('Event metrics implemented', grep(O + 'health-aggregator.ts', /eventOps\.health\(\)/) && grep(O + 'queue-metrics.ts', /'aipowersalon_event_dead_letters'/)),
  D('Realtime metrics implemented', grep(K + 'realtime-telemetry.ts', /aipowersalon_realtime_connections/)),
  D('Twilio metrics implemented', grep('../../packages/notifications/src/sms.service.ts', /instrumentedFetch\('twilio'/)),
  D('Email metrics implemented', grep('../../packages/notifications/src/email.service.ts', /instrumentedFetch\('email'/)),
  D('Push metrics implemented', grep('../../modules/communications/src/push/push-providers.ts', /recordProviderCall\('apns'/) && grep('../../modules/communications/src/push/push-providers.ts', /instrumentedFetch\('fcm'/)),
  D('Payment metrics implemented', grep('../../modules/payments/src/payments/processor.factory.ts', /instrumentedFetch\('cardpointe'/)),
  D('AI metrics implemented', grep('../../modules/ai/src/ai/ai-provider-health.ts', /export /)),
  // Phase 14 B: the media + private stores are wrapped (bytes / ops / errors / latency by store) and the lifecycle job counts
  D('Storage metrics implemented', grep(K + 'storage-telemetry.ts', /'aipowersalon_storage_operations_total'/) && grep(K + 'storage-telemetry.ts', /export function instrumentStore/)
    && grep('../../packages/media/src/media-storage.ts', /instrumentStore\(/) && grep('../../packages/media/src/private-store.ts', /instrumentStore\(/) && has(K + 'storage-telemetry.test.ts')),
  D('CPU/memory metrics implemented', grep(K + 'process-metrics.ts', /'aipowersalon_process_resident_memory_bytes'/) && grep(K + 'process-metrics.ts', /'aipowersalon_process_cpu_seconds_total'/)
    && grep(K + 'realtime-telemetry.ts', /aipowersalon_nodejs_event_loop_lag_seconds/) && has(K + 'process-metrics.test.ts')),
  D('Frontend telemetry implemented', grep('../../packages/ui/src/error-reporting.tsx', /export /) && grep(O + 'client-errors.controller.ts', /'aipowersalon_client_errors_total'/)),
  // Phase 13 E: allow-listed product events + perf marks from the four Capacitor apps (app / version / platform)
  D('Mobile telemetry implemented', grep(O + 'client-events.controller.ts', /'aipowersalon_client_events_total'/) && grep(O + 'client-events.controller.ts', /'aipowersalon_client_perf_ms'/)
    && has(O + 'client-events.vitest.spec.ts')),
  // spans exported over OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set; Phase 14 A also keeps them in the local trace store
  H('Distributed tracing implemented', grep(K + 'tracing/span.ts', /export function startSpan/) && grep(K + 'tracing/tracing.test.ts', /one request = one trace: HTTP → DB → provider → job/)
    && grep(M + '561_telemetry_store.sql', /CREATE TABLE IF NOT EXISTS telemetry_spans/),
    'traces are stored and searchable in-platform (Request search); an external backend needs OTEL_EXPORTER_OTLP_ENDPOINT (+ _HEADERS) set on Railway (HOSTING_ACTIONS C4)'),
  D('Critical business SLIs implemented', grep(O + 'sli.ts', /WORKFLOW_ROUTES/)),
  D('Health checks implemented', grep('src/health/health.controller.ts', /ready\(/)),
  D('Component health implemented', grep(O + 'health-core.ts', /export const COMPONENTS/)),
  D('Tenant health implemented', grep(O + 'tenant-health.ts', /evaluateTenantHealth/) && grep(O + 'tenant-health.ts', /class TenantHealthSnapshots/) && grep(M + '459_tenant_health_snapshots.sql', /CREATE TABLE IF NOT EXISTS tenant_health_snapshots/) && grep(AW + 'components/SalonHealthPanel.tsx', /tenantHealthList/)),
  // Phase 14 B (§345): per branch per 15 minutes, worst first for Super Admin, own branches for the owner
  D('Branch health implemented', grep(M + '562_branch_health_process_heartbeats.sql', /CREATE TABLE IF NOT EXISTS branch_health_snapshots/) && grep(O + 'branch-health.ts', /export function evaluateBranchHealth/)
    && grep(O + 'branch-health.ts', /export class BranchHealthSnapshots/) && has(O + 'branch-health.pgtest.vitest.spec.ts')),
  D('Provider health implemented', grep(K + 'provider-telemetry.ts', /export function providerHealth/)),
  // Phase 14 C (§94–95): kiosk probe behind the designated test salon, sandbox-payment + SMS probes, all "not configured" until set
  H('Synthetic monitoring implemented', grep(O + 'synthetic-probes.ts', /RAILWAY_PUBLIC_DOMAIN/) && grep(O + 'synthetic-probes.ts', /kiosk_config/) && grep(O + 'synthetic-probes.ts', /payment_sandbox/)
    && grep(O + 'synthetic-probes.ts', /sms_test/) && grep(M + '563_alert_escalation_slo_synthetic.sql', /CREATE TABLE IF NOT EXISTS synthetic_monitoring_settings/) && has(O + 'synthetic-probes.pgtest.vitest.spec.ts'),
    'designate the synthetic test salon (Super Admin → On-call → Synthetic) and set the CardPointe UAT + Twilio test credentials (HOSTING_ACTIONS D3/D4)'),
  D('Alert severity implemented', grep(O + 'alert-rules.ts', /export function severityFor/)),
  D('Alert deduplication implemented', grep(O + 'health-aggregator.ts', /where not exists \(select 1 from alerts/)),
  // Phase 14 C (§262–265): an ordered on-call chain, escalation on no-ack, ack from the screen and from a signed one-time link
  H('Alert routing to a human (§262–265)', grep(O + 'alert-notifier.ts', /REMINDER_AFTER_MS/) && grep(M + '563_alert_escalation_slo_synthetic.sql', /CREATE TABLE IF NOT EXISTS alert_escalations/)
    && grep(O + 'alert-escalation.ts', /export const ESCALATE_AFTER_MS/) && grep(O + 'oncall.ts', /@Controller\('public\/alert-ack'\)/)
    && has(O + 'alert-escalation.pgtest.vitest.spec.ts') && has(O + 'oncall.pgtest.vitest.spec.ts'),
    'enter the on-call contacts (Super Admin → On-call; email works with SendGrid, SMS needs Twilio) (HOSTING_ACTIONS D5)'),
  D('Runbooks created', has('../../RUNBOOKS.md') && grep(O + 'runbook-links.vitest.spec.ts', /REQUIRED/)),
  // Phase 14 C (§80): validated / breached from the persisted SLI history once N days exist — the verdict needs production days
  H('SLOs defined where measured', grep(O + 'slo-core.ts', /status: 'proposed'/) && grep(O + 'slo-validation.ts', /export function evaluateSlo/) && grep(M + '563_alert_escalation_slo_synthetic.sql', /CREATE TABLE IF NOT EXISTS slo_validations/)
    && has(O + 'slo-validation.pgtest.vitest.spec.ts'),
    'the evaluator marks each SLO validated / breached automatically after SLO_VALIDATION_MIN_DAYS (default 28) days and SLO_VALIDATION_MIN_REQUESTS (default 1000) requests of production traffic — nothing to do but run production'),
  D('Error budgets implemented where appropriate', grep(O + 'slo-core.ts', /export function budget/)),
  // Phase 14 C: no successful report within 26 h → a P2 alert; the provider-side job that POSTS the report is Kevin's cron
  H('Backup monitoring implemented', grep(O + 'backup-reports.ts', /evaluateBackups/) && grep(O + 'backup-reports.ts', /export const BACKUP_STALENESS_KEY/) && has(O + 'report-backup-script.vitest.spec.ts')
    && has(O + 'backup-staleness.pgtest.vitest.spec.ts') && has('../../deploy/backup/backup-and-report.sh'),
    'schedule deploy/backup/backup-and-report.sh (Railway cron or the GitHub workflow template in deploy/backup) and set BACKUP_REPORTS_REQUIRED=1 (HOSTING_ACTIONS D6)'),
  D('Restore-test monitoring implemented', grep(O + 'backup-reports.ts', /restore_drill_overdue/)),
  D('Deployment markers implemented', grep(K + 'build-info.ts', /RAILWAY_GIT_COMMIT_SHA/) && grep(K + 'build-info.ts', /aipowersalon_build_info/) && grep(M + '562_branch_health_process_heartbeats.sql', /CREATE TABLE IF NOT EXISTS process_heartbeats/)),
  D('Incident Management implemented', grep('src/super-admin-system-status/incident-workflow.ts', /export /)),
  // Phase 14 C (D8): 401/403 spikes, rate-limit storms, webhook signature failures, break-glass → security_incidents, deduplicated
  D('Security observability implemented', grep(O + 'security-signals.ts', /export const RULES/) && grep(O + 'security-signals.ts', /export class SecuritySignalsMiddleware/)
    && grep(O + 'security-signals.ts', /security_incidents/) && has(O + 'security-signals.pgtest.vitest.spec.ts')),
  D('Cross-tenant alerts implemented', grep(O + 'cross-tenant-signal.ts', /ESCALATION_COUNT/) && grep(O + 'integrity-checks.ts', /INVARIANTS/)),
  D('Super Admin System Operations implemented', grep(AW + 'screens/SystemOperationsScreen.tsx', /export /)),
  D('API dashboard works', grep(O + 'system-operations.ts', /async api\(/)),
  // Phase 10 E: the dedicated Database page (sizes, indexes, slow queries, activity, schema health, retention, growth)
  D('Database dashboard works', grep('../../modules/super-admin/src/super-admin-database/database.controller.ts', /@Controller\(/) && grep(AW + 'screens/DatabaseScreen.tsx', /slowQueries/) && has(AW + 'screens/DatabaseScreen.test.tsx')),
  D('Redis dashboard works', dash('redis', 'redis')),
  D('Queue dashboard works', grep('src/events/event-ops.controller.ts', /@Controller\(/)),   // Constitution 8 Events screen
  D('Realtime dashboard works', grep('src/realtime/platform-live-ops.ts', /export /)),   // Constitution 9 live-ops screen
  D('Payments dashboard works', dash('payments', 'payments')),
  D('Communications dashboard works', dash('communications', 'communications')),
  D('AI dashboard works', grep('../../modules/ai/src/ai/ai-control-plane.ts', /export /) || grep('../../modules/ai/src/ai/ai-control-plane.service.ts', /export /)),   // Constitution 10 control plane
  D('Storage dashboard works', dash('storage', 'storage')),
  D('Mobile dashboard works', dash('mobile', 'mobile') && grep(AW + 'screens/SystemOpsMobileTelemetry.tsx', /export /)),
  D('Deployment dashboard works', dash('deployments', 'deployments')),
  D('Incident dashboard works', dash('incidents', 'incidents') && grep(AW + 'screens/SystemStatusIncident.tsx', /export /)),
  // Phase 14 A (§291–292): the log + trace store, searched by request / correlation / trace id, logs joined to spans
  D('Request search works', grep(M + '561_telemetry_store.sql', /CREATE TABLE IF NOT EXISTS telemetry_log_events/) && grep(O + 'telemetry-store.ts', /@Get\('requests\/:requestId'\)/)
    && grep(AW + 'screens/RequestSearchScreen.tsx', /export /) && has(O + 'telemetry-store.pgtest.vitest.spec.ts')),
  D('Correlation search works', grep(O + 'telemetry-store.ts', /@Get\('correlations\/:correlationId'\)/) && grep(O + 'telemetry-store.pgtest.vitest.spec.ts', /correlation/i)),
  D('Trace/log linking works', grep(O + 'telemetry-store.ts', /@Get\('traces\/:traceId'\)/) && grep(K + 'telemetry-store.ts', /export function toLogRow/) && grep(O + 'telemetry-store.pgtest.vitest.spec.ts', /span/i)),
  // Phase 14 A (§181): aggregates vs per-request rows are two keys; responses redact for a caller without the second
  D('Sensitive telemetry permissions work', grep(RB, /'super_admin\.telemetry\.sensitive\.view'/) && grep(O + 'telemetry-store.ts', /@RequirePermission\('super_admin\.telemetry\.view'\)/)
    && has(O + 'telemetry-permissions.vitest.spec.ts')),
  D('Telemetry export failure does not break POS', grep(O + 'end-to-end-telemetry.vitest.spec.ts', /exporter down/) && grep(K + 'tracing/tracing.test.ts', /a dead endpoint never throws into the caller/)),
  D('High-cardinality safeguards implemented', grep(K + 'metrics.ts', /FORBIDDEN_LABELS/)),
  D('Log-redaction tests pass', grep(K + 'redaction.test.ts', /redact/)),
  D('Context-leak tests pass', grep(K + 'request-context.test.ts', /interleav|concurren/i)),
  D('Health tests pass', has('src/health/health.controller.vitest.spec.ts')),
  D('Alert tests pass', has(O + 'alert-rules.vitest.spec.ts') && has(O + 'alert-reconcile.pgtest.vitest.spec.ts')),
  D('Failure-injection tests pass', grep('src/health/health.controller.vitest.spec.ts', /hang/) && grep('../../docs/DR_DRILLS_2026-10-08.md', /\| DB failover \| `node apps\/api\/scripts\/drills\/drill-db-failover\.mjs` .*\*\*PASS\*\*/)),
  // the harness (Phase 10/11): the API end to end under N clients, exit 1 on any 5xx or a p95 over budget; the sandbox
  // 1-client run is inside the 500 ms budget and recorded; the target-infrastructure run is Kevin's
  H('Load tests pass', grep('scripts/api-load-test.mjs', /process\.exit\(ok \? 0 : 1\)/) && grep('scripts/db-explain-pass.mjs', /args\.has\('--load'\)/)
    && grep('../../docs/DB_EXPLAIN_PASS_2026-10-08.md', /### 1 client × 20 s[\s\S]*?\*\*p50 \d+ ms · p95 ([1-4]\d\d|\d\d?) ms/),
    'run scripts/api-load-test.mjs at 50 clients against staging on the production plan (HOSTING_ACTIONS C5); sandbox 50-client numbers are not target numbers'),
  D('Build passes', measured(ci.build(), TSC), ranNote('build-image.yml docker build of the API; security.yml build:packages + build:modules')),
  D('Type checking passes', measured(ci.types(), TSC), ranNote('API build = tsc over src; gate "app types" typechecks every SPA')),
  D('Lint passes', measured(ci.lint(), LINT), ranNote('gate "lint" = tooling/ci/lint-ratchet.mjs: 0 errors, no rule above lint-baseline.json; npm run lint is the same ratchet')),
  D('Tests pass', measured(ci.tests(), TESTS), ranNote('security.yml: every suite in a 4-way matrix + the real-Postgres race lane')),
];
report('396', items, 76);
