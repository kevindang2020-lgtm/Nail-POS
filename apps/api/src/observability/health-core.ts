// health-core.ts — Constitution 11 §84–91, §296–302, §332–333, §341–343: component health, PURE.
//
// No I/O, no clock of its own. The aggregator gathers signals and calls these; every rule the spec states lives here
// where a test can pin it:
//   §88  five statuses — HEALTHY / DEGRADED / OUTAGE / UNKNOWN / MAINTENANCE
//   §90  criticality — CRITICAL / IMPORTANT / OPTIONAL
//   §91  graceful degradation — "Core POS: HEALTHY, AI Forecasting: DEGRADED", never "entire platform DOWN"
//   §301 no flapping — a status changes only after it has been observed for N consecutive evaluations
//   §302 hysteresis — recovering takes MORE evidence than degrading (fail fast, recover carefully)
//   §332 no fake green — a component with no data is UNKNOWN; a stale snapshot reads as UNKNOWN
//   §333 every snapshot carries observed_at / expires_at

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'OUTAGE' | 'UNKNOWN' | 'MAINTENANCE';
export type Criticality = 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL';

export interface Evaluation { status: HealthStatus; reason: string; summary: Record<string, number | string | null> }

/** §341–342 the component registry: the things System Operations shows, and how much each matters. */
export interface ComponentDef {
  key: string; name: string; criticality: Criticality; owner: string; runbook: string; statusPageVisible: boolean;
  /**
   * false = a SEVERITY signal, not an availability one. It alerts at its criticality but never moves the platform's
   * overall status: salons can still work while a data-integrity anomaly is investigated, and the status page must
   * not say "outage" when checkout works. Default true.
   */
  availability?: boolean;
}
export const COMPONENTS: readonly ComponentDef[] = [
  { key: 'api', name: 'API', criticality: 'CRITICAL', owner: 'platform', runbook: 'RUNBOOKS.md#api-outage', statusPageVisible: true },
  { key: 'database', name: 'Database', criticality: 'CRITICAL', owner: 'platform', runbook: 'RUNBOOKS.md#database-outage', statusPageVisible: false },
  { key: 'redis', name: 'Cache & Realtime Backbone', criticality: 'IMPORTANT', owner: 'platform', runbook: 'RUNBOOKS.md#redis-outage', statusPageVisible: false },
  { key: 'realtime', name: 'Live Updates', criticality: 'IMPORTANT', owner: 'realtime', runbook: 'REALTIME_RUNBOOKS.md', statusPageVisible: true },
  { key: 'workers', name: 'Background Jobs', criticality: 'IMPORTANT', owner: 'platform', runbook: 'RUNBOOKS.md#worker-crash-loop', statusPageVisible: false },
  { key: 'events', name: 'Event Delivery', criticality: 'IMPORTANT', owner: 'platform', runbook: 'RUNBOOKS.md#queue-backlog', statusPageVisible: false },
  { key: 'payments', name: 'Payments', criticality: 'CRITICAL', owner: 'payments', runbook: 'RUNBOOKS.md#payment-processor-outage', statusPageVisible: true },
  { key: 'communications', name: 'SMS & Email', criticality: 'IMPORTANT', owner: 'communications', runbook: 'RUNBOOKS.md#twilio-outage', statusPageVisible: true },
  { key: 'ai', name: 'AI Features', criticality: 'OPTIONAL', owner: 'ai', runbook: 'RUNBOOKS.md#ai-provider-outage', statusPageVisible: true },
  { key: 'booking', name: 'Online Booking', criticality: 'CRITICAL', owner: 'booking', runbook: 'RUNBOOKS.md#api-outage', statusPageVisible: true },
  { key: 'checkout', name: 'Checkout', criticality: 'CRITICAL', owner: 'payments', runbook: 'RUNBOOKS.md#payment-processor-outage', statusPageVisible: true },
  { key: 'synthetic', name: 'Synthetic Checks', criticality: 'IMPORTANT', owner: 'platform', runbook: 'RUNBOOKS.md#synthetic-probe-failure', statusPageVisible: false },
  { key: 'backups', name: 'Backups & Restore', criticality: 'IMPORTANT', owner: 'platform', runbook: 'RUNBOOKS.md#backup-failure', statusPageVisible: false },
  { key: 'data_integrity', name: 'Data Integrity', criticality: 'CRITICAL', owner: 'platform', runbook: 'RUNBOOKS.md#cross-tenant-security-incident', statusPageVisible: false, availability: false },
];

const unknown = (reason: string, summary: Evaluation['summary'] = {}): Evaluation => ({ status: 'UNKNOWN', reason, summary });

// ── Evaluators. Each takes plain numbers and returns a status with a machine-readable reason. ──────────────────

/** API: server-error rate and tail latency over the recent window. */
export function evaluateApi(s: { requests: number; serverErrors: number; p95Seconds: number | null }): Evaluation {
  const summary = { requests: s.requests, serverErrors: s.serverErrors, p95Seconds: s.p95Seconds };
  if (s.requests === 0) return unknown('no_traffic', summary);
  const rate = s.serverErrors / s.requests;
  if (rate >= 0.25) return { status: 'OUTAGE', reason: 'server_error_rate', summary };
  if (rate >= 0.05) return { status: 'DEGRADED', reason: 'server_error_rate', summary };
  if (s.p95Seconds !== null && s.p95Seconds >= 2) return { status: 'DEGRADED', reason: 'latency_p95', summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

/** Database: a readiness probe is decisive; pool saturation and query errors degrade. */
export function evaluateDatabase(s: { probeOk: boolean | null; poolUtilisation: number | null; waiting: number; queryErrorRate: number | null }): Evaluation {
  const summary = { probeOk: s.probeOk === null ? null : s.probeOk ? 1 : 0, poolUtilisation: s.poolUtilisation, waiting: s.waiting, queryErrorRate: s.queryErrorRate };
  if (s.probeOk === null) return unknown('not_configured', summary);
  if (!s.probeOk) return { status: 'OUTAGE', reason: 'probe_failed', summary };
  if (s.poolUtilisation !== null && s.poolUtilisation >= 0.9 && s.waiting > 0) return { status: 'DEGRADED', reason: 'pool_saturated', summary };
  if (s.queryErrorRate !== null && s.queryErrorRate >= 0.05) return { status: 'DEGRADED', reason: 'query_errors', summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

/** Redis: per-role connection state. No clients at all means Redis is not in use — UNKNOWN, not HEALTHY. */
export function evaluateRedis(roles: Array<{ role: string; up: boolean }>): Evaluation {
  const summary = { clients: roles.length, down: roles.filter((r) => !r.up).length };
  if (roles.length === 0) return unknown('not_configured', summary);
  const down = roles.filter((r) => !r.up);
  if (down.length === roles.length) return { status: 'OUTAGE', reason: 'all_clients_down', summary };
  if (down.length > 0) return { status: 'DEGRADED', reason: `down:${down.map((d) => d.role).sort().join(',')}`, summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

/** Realtime: reuses Constitution 9's own verdict rather than re-deriving thresholds (no second opinion). */
export function evaluateRealtime(c9: { status: 'OPERATIONAL' | 'IDLE' | 'DEGRADED' | 'INCIDENT'; signals: string[] }): Evaluation {
  const summary = { signals: c9.signals.join(',') || null };
  switch (c9.status) {
    case 'OPERATIONAL': case 'IDLE': return { status: 'HEALTHY', reason: 'ok', summary };
    case 'DEGRADED': return { status: 'DEGRADED', reason: c9.signals[0] ?? 'degraded', summary };
    case 'INCIDENT': return { status: 'OUTAGE', reason: c9.signals[0] ?? 'incident', summary };
  }
}

/**
 * Workers (§111, §210): a scheduler whose last run is older than 3× its interval has silently stopped ticking —
 * the failure no error log ever shows. A job whose last run failed degrades too.
 */
/** mandate §212: POST_RESTORE_HOLD (packages/config post-restore-hold.ts) — inlined so this file stays pure / import-free. */
const postRestoreHoldActive = (env: NodeJS.ProcessEnv): boolean => { const v = String(env.POST_RESTORE_HOLD ?? '').trim().toLowerCase(); return v === '1' || v === 'true' || v === 'yes' || v === 'on'; };
export function evaluateWorkers(jobs: Array<{ jobType: string; lastStartedAt: number | null; lastFailedAt: number | null; lastCompletedAt: number | null; intervalMs: number | null }>, now: number, env: NodeJS.ProcessEnv = process.env): Evaluation {
  const summary: Evaluation['summary'] = { jobs: jobs.length };
  // mandate §212: a deliberate pause is reported as such (DEGRADED, reason post_restore_hold), never as "stalled" — and never forgotten
  if (postRestoreHoldActive(env)) return { status: 'DEGRADED', reason: 'post_restore_hold', summary: { ...summary, postRestoreHold: 1 } };
  if (jobs.length === 0) return unknown('no_jobs_reported', summary);
  const stalled = jobs.filter((j) => j.intervalMs && j.lastStartedAt !== null && now - j.lastStartedAt > 3 * j.intervalMs).map((j) => j.jobType);
  const failing = jobs.filter((j) => j.lastFailedAt !== null && (j.lastCompletedAt === null || j.lastFailedAt > j.lastCompletedAt)).map((j) => j.jobType);
  summary.stalled = stalled.length; summary.failing = failing.length;
  if (stalled.length > 0) return { status: 'DEGRADED', reason: `stalled:${stalled.sort().slice(0, 5).join(',')}`, summary };
  if (failing.length > 0) return { status: 'DEGRADED', reason: `failing:${failing.sort().slice(0, 5).join(',')}`, summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

/** Events (§49, §111): oldest pending age is the signal; a queue COUNT alone is misleading (§46). */
export function evaluateEvents(s: { oldestPendingAgeSec: number | null; openDeadLetters: number; criticalConsumerLagSec: number | null } | null): Evaluation {
  if (!s) return unknown('not_measured');
  const summary = { oldestPendingAgeSec: s.oldestPendingAgeSec, openDeadLetters: s.openDeadLetters, criticalConsumerLagSec: s.criticalConsumerLagSec };
  if ((s.oldestPendingAgeSec ?? 0) >= 900 || (s.criticalConsumerLagSec ?? 0) >= 900) return { status: 'OUTAGE', reason: 'publish_backlog', summary };
  if ((s.oldestPendingAgeSec ?? 0) >= 120 || (s.criticalConsumerLagSec ?? 0) >= 120) return { status: 'DEGRADED', reason: 'publish_lag', summary };
  if (s.openDeadLetters > 0) return { status: 'DEGRADED', reason: 'dead_letters', summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

/**
 * A group of providers (payments = cardpointe/fiserv/clover; communications = twilio/email/fcm/apns; ai = the AI
 * breakers). The group is as healthy as its providers — but one provider out of several is DEGRADED, not OUTAGE,
 * because the others still serve (§91). Providers never called are UNKNOWN and do not count either way.
 */
export function evaluateProviderGroup(providers: Array<{ provider: string; status: HealthStatus }>): Evaluation {
  const known = providers.filter((p) => p.status !== 'UNKNOWN');
  const summary = { providers: providers.length, known: known.length, outage: known.filter((p) => p.status === 'OUTAGE').length };
  if (known.length === 0) return unknown('no_provider_traffic', summary);
  const out = known.filter((p) => p.status === 'OUTAGE').map((p) => p.provider).sort();
  const deg = known.filter((p) => p.status === 'DEGRADED').map((p) => p.provider).sort();
  if (out.length === known.length) return { status: 'OUTAGE', reason: `outage:${out.join(',')}`, summary };
  if (out.length > 0) return { status: 'DEGRADED', reason: `outage:${out.join(',')}`, summary };
  if (deg.length > 0) return { status: 'DEGRADED', reason: `degraded:${deg.join(',')}`, summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

/** A business workflow from its SLI (§70–72). Minimum traffic before judging, so one failure in two is not an outage. */
export function evaluateWorkflow(s: { total: number; systemFailures: number } | null, minTraffic = 10): Evaluation {
  if (!s || s.total === 0) return unknown('no_traffic', { total: s?.total ?? 0 });
  const summary = { total: s.total, systemFailures: s.systemFailures, reliability: (s.total - s.systemFailures) / s.total };
  if (s.total < minTraffic) return { status: s.systemFailures > 0 ? 'DEGRADED' : 'HEALTHY', reason: s.systemFailures > 0 ? 'low_traffic_failures' : 'ok', summary };
  const reliability = summary.reliability as number;
  if (reliability < 0.9) return { status: 'OUTAGE', reason: 'workflow_failing', summary };
  if (reliability < 0.99) return { status: 'DEGRADED', reason: 'workflow_errors', summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

/**
 * §92, §281, §328: synthetic probes. Skipped probes are not configured and count for nothing; with none configured
 * the component is UNKNOWN (not an alert — see alert-rules). One failing of several is DEGRADED; all failing is
 * OUTAGE. "Repeatedly" (§281) is the aggregator's hysteresis, plus: a probe failing only once so far is not counted.
 */
export function evaluateSynthetic(results: Array<{ probe: string; outcome: 'pass' | 'fail' | 'skipped'; consecutiveFailures: number; detail: string }>): Evaluation {
  const configured = results.filter((r) => r.outcome !== 'skipped');
  const summary = { configured: configured.length, failing: configured.filter((r) => r.consecutiveFailures >= 2).length };
  if (configured.length === 0) return unknown('not_configured', summary);
  const failing = configured.filter((r) => r.consecutiveFailures >= 2);
  if (failing.length === configured.length) return { status: 'OUTAGE', reason: `failing:${failing.map((f) => `${f.probe}(${f.detail})`).join(',')}`, summary };
  if (failing.length > 0) return { status: 'DEGRADED', reason: `failing:${failing.map((f) => `${f.probe}(${f.detail})`).join(',')}`, summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

// ── §301–302 hysteresis. ─────────────────────────────────────────────────────────────────────────────────────────

export interface HysteresisState { current: HealthStatus; candidate: HealthStatus | null; streak: number }
export const HYSTERESIS = { toWorse: 2, toBetter: 3 } as const;
const SEVERITY: Record<HealthStatus, number> = { HEALTHY: 0, MAINTENANCE: 1, UNKNOWN: 2, DEGRADED: 3, OUTAGE: 4 };

/**
 * One evaluation step. A new status must be observed `toWorse` times in a row to take effect when it is worse, and
 * `toBetter` times when it is better — so one transient failure never flips HEALTHY→OUTAGE→HEALTHY (§301), and a
 * recovering component has to prove it (§302). The very first observation is accepted as-is: there is no prior
 * state to protect.
 */
export function applyHysteresis(prev: HysteresisState | null, observed: HealthStatus): HysteresisState {
  if (!prev) return { current: observed, candidate: null, streak: 0 };
  if (observed === prev.current) return { current: prev.current, candidate: null, streak: 0 };
  const streak = prev.candidate === observed ? prev.streak + 1 : 1;
  const needed = SEVERITY[observed] > SEVERITY[prev.current] ? HYSTERESIS.toWorse : HYSTERESIS.toBetter;
  return streak >= needed ? { current: observed, candidate: null, streak: 0 } : { current: prev.current, candidate: observed, streak };
}

// ── §332–333 staleness. ──────────────────────────────────────────────────────────────────────────────────────────

/** A snapshot read after it expires is UNKNOWN — the aggregator stopped, and silence must not read as green. */
export function effectiveStatus(snapshot: { status: HealthStatus; expiresAt: number } | null, now: number): HealthStatus {
  if (!snapshot) return 'UNKNOWN';
  return now > snapshot.expiresAt ? 'UNKNOWN' : snapshot.status;
}

// ── §89 / §91 system rollup. ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Overall platform status. Worst-of over CRITICAL components; an IMPORTANT component can pull the platform down to
 * DEGRADED but never to OUTAGE; an OPTIONAL component never changes the overall status at all. So an AI outage leaves
 * the platform HEALTHY with AI shown DEGRADED/OUTAGE on its own card (§91) — and a CRITICAL component we cannot see is
 * UNKNOWN overall, never HEALTHY (§332).
 */
export function rollup(components: Array<{ key: string; status: HealthStatus; criticality: Criticality; availability?: boolean }>): HealthStatus {
  let worst: HealthStatus = 'HEALTHY';
  const bump = (s: HealthStatus) => { if (SEVERITY[s] > SEVERITY[worst]) worst = s; };
  for (const c of components) {
    if (c.availability === false) continue;   // a severity signal, not availability (see ComponentDef)
    if (c.criticality === 'OPTIONAL') continue;
    if (c.criticality === 'IMPORTANT') { if (c.status === 'OUTAGE' || c.status === 'DEGRADED') bump('DEGRADED'); continue; }
    if (c.status === 'MAINTENANCE') continue;   // planned; shown on its own card, not a platform failure
    bump(c.status);
  }
  return worst;
}

/** Mapping to the public status page's vocabulary (status_components), which predates this model. */
export function toStatusPage(s: HealthStatus, criticality: Criticality): string {
  switch (s) {
    case 'HEALTHY': return 'operational';
    case 'DEGRADED': return 'degraded';
    case 'OUTAGE': return criticality === 'CRITICAL' ? 'major_outage' : 'partial_outage';
    case 'MAINTENANCE': return 'maintenance';
    case 'UNKNOWN': return 'unknown';
  }
}
