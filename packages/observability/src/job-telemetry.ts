// job-telemetry.ts — Constitution 11 §13, §45–48, §192, §314, §376: one wrapper for every background job.
//
// THE SITUATION IT FIXES. This codebase has no queue system; background work is 21 in-process schedulers, each a
// `setInterval` → tick → try/catch → string log, with no shared convention: no job id, no tenant context, no
// duration, no metrics, three of them swallowing every error. §192 asks that every job handler AUTOMATICALLY log
// started / completed / failed with duration and attempt, in job context. This is that, as one function a
// scheduler calls instead of calling its tick directly.
//
// WHAT ONE CALL GIVES A JOB:
//   • a telemetry context (§13/§376) — job id, job type, tenant/branch where relevant, and a CORRELATION that
//     continues the chain when the job was caused by a request or event (the metadata carries it);
//   • job.started / job.completed / job.failed log lines with duration and attempt (§192);
//   • metrics by job TYPE only (§48: critical / standard / AI / report / import / reconciliation are separate
//     types — never one "workers" number; §38: never by tenant);
//   • queue_wait vs processing time when the job knows when it was enqueued (§314) — a slow job may be backlog;
//   • an in-flight gauge and a "last run" registry so the health aggregator can spot a scheduler that has
//     silently stopped ticking (§111: oldest-job age is more meaningful than a count).
//
// WHAT IT DOES NOT DO: catch the error for you. A failed tick still throws to the scheduler, which keeps its own
// policy (skip this tick, keep the interval alive). Swallowing here would recreate the problem it exists to find.
import { performance } from 'node:perf_hooks';
import { runWithContext, contextForJob } from './request-context';
import { log } from './logger';
import { registry, BUCKETS } from './metrics';
import { startSpan } from './tracing/span';
import { parseTraceparent } from './tracing/traceparent';

export type JobClass = 'critical' | 'standard' | 'ai' | 'report' | 'import' | 'reconciliation';

export interface JobMeta {
  /** Stable name, e.g. 'overview.snapshot', 'ai.trial_sweep'. Becomes the metric label — never per-tenant. */
  jobType: string;
  jobClass: JobClass;
  jobId?: string | null;
  tenantId?: string | null;
  branchId?: string | null;
  /** Continue a request's or event's chain (§13). */
  correlationId?: string | null;
  sourceEventId?: string | null;
  attempt?: number;
  /** When the work was enqueued/scheduled; enables queue_wait_ms (§314). */
  enqueuedAt?: Date | number | null;
  /** W3C traceparent of the span that ENQUEUED the job (jobs.traceparent, migration 548): the job span continues that
   *  trace (child + link). Absent → the job joins the ambient span, or starts its own trace. */
  traceparent?: string | null;
}

export const jobsStarted = registry.counter('aipowersalon_job_started_total', 'Jobs started', ['job_type', 'job_class']);
export const jobsCompleted = registry.counter('aipowersalon_job_completed_total', 'Jobs completed', ['job_type', 'job_class']);
export const jobsFailed = registry.counter('aipowersalon_job_failed_total', 'Jobs failed', ['job_type', 'job_class']);
export const jobDuration = registry.histogram('aipowersalon_job_duration_seconds', 'Job processing time', ['job_type', 'job_class'], BUCKETS.job);
export const jobQueueWait = registry.histogram('aipowersalon_job_queue_wait_seconds', 'Time between enqueue and start', ['job_type', 'job_class'], BUCKETS.job);
export const jobsInFlight = registry.gauge('aipowersalon_jobs_in_flight', 'Jobs currently running', ['job_class']);

export interface JobRunRecord { jobType: string; jobClass: JobClass; lastStartedAt: number | null; lastCompletedAt: number | null; lastFailedAt: number | null; observedIntervalMs: number | null; lastDurationMs: number | null; lastError: string | null; consecutiveFailures: number; runs: number;
  /** A scheduled tick this process skipped because another process owns it (Phase 2): the scheduler is alive fleet-wide. */
  lastHeartbeatAt?: number | null;
  /** The interval the scheduler declared to runTick (preferred over the learned one). */
  declaredIntervalMs?: number | null }

/** §111/§210: the aggregator asks "when did this job last succeed" — a scheduler that stopped ticking shows here. */
const lastRuns = new Map<string, JobRunRecord>();
export function jobRunRegistry(): JobRunRecord[] { return [...lastRuns.values()]; }
export function resetJobRunRegistry(): void { lastRuns.clear(); }

export function noteTickHeartbeat(meta: Pick<JobMeta, 'jobType' | 'jobClass'>, everyMs: number, at = Date.now()): void {
  const r = rec(meta as JobMeta); r.lastHeartbeatAt = at; r.declaredIntervalMs = everyMs;
}
export function noteDeclaredInterval(meta: Pick<JobMeta, 'jobType' | 'jobClass'>, everyMs: number): void { rec(meta as JobMeta).declaredIntervalMs = everyMs; }

function rec(meta: JobMeta): JobRunRecord {
  let r = lastRuns.get(meta.jobType);
  if (!r) { r = { jobType: meta.jobType, jobClass: meta.jobClass, lastStartedAt: null, lastCompletedAt: null, lastFailedAt: null, observedIntervalMs: null, lastDurationMs: null, lastError: null, consecutiveFailures: 0, runs: 0 }; lastRuns.set(meta.jobType, r); }
  return r;
}

/**
 * Run `fn` as an instrumented job. Rethrows on failure after recording it — the caller's policy decides what a
 * failure means; the telemetry does not decide for it.
 */
export async function runJob<T>(meta: JobMeta, fn: () => Promise<T>): Promise<T> {
  // BUILD_PLAN Phase 11: the job is a span. Enqueued with a traceparent → a child of (and linked to) the enqueuing span,
  // in the SAME trace, so request → job reads as one trace even when the job runs minutes later in a worker process.
  const parent = parseTraceparent(meta.traceparent);
  const span = startSpan(`job ${meta.jobType}`, {
    kind: 'consumer', parent, links: parent ? [{ traceId: parent.traceId, spanId: parent.spanId }] : undefined,
    attributes: { 'aipowersalon.job_type': meta.jobType, 'aipowersalon.job_class': meta.jobClass, 'aipowersalon.job_id': meta.jobId ?? undefined, 'aipowersalon.attempt': meta.attempt ?? 1, 'aipowersalon.tenant_id': meta.tenantId ?? undefined },
  });
  const ctx = contextForJob({ jobType: meta.jobType, jobId: meta.jobId ?? undefined, tenantId: meta.tenantId, branchId: meta.branchId, correlationId: meta.correlationId,
    trace: { traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId, sampled: span.sampled } });
  const labels = { job_type: meta.jobType, job_class: meta.jobClass };
  const attempt = meta.attempt ?? 1;
  const r = rec(meta);
  const started = Date.now();
  return runWithContext(ctx, async () => {
    const l = log.withContext({ jobType: meta.jobType, jobClass: meta.jobClass, jobId: meta.jobId ?? undefined, attempt, sourceEventId: meta.sourceEventId ?? undefined });
    const enq = meta.enqueuedAt == null ? null : (meta.enqueuedAt instanceof Date ? meta.enqueuedAt.getTime() : Number(meta.enqueuedAt));
    const queueWaitMs = enq == null || !Number.isFinite(enq) ? undefined : Math.max(0, started - enq);
    if (queueWaitMs !== undefined) jobQueueWait.observe(queueWaitMs / 1000, labels);
    jobsStarted.inc(labels); jobsInFlight.inc({ job_class: meta.jobClass });
    // §111: the scheduler's cadence, LEARNED from the gap between consecutive starts, so the health aggregator can
    // tell a scheduler that has stopped ticking without every one of the 21 declaring its interval. The largest
    // recent gap is kept, so an occasional early manual run cannot shrink the yardstick and cause false alarms.
    if (r.lastStartedAt !== null) {
      const gap = started - r.lastStartedAt;
      if (gap >= 1_000) r.observedIntervalMs = r.observedIntervalMs === null ? gap : Math.max(Math.round(r.observedIntervalMs * 0.9), gap);
    }
    r.lastStartedAt = started; r.runs++;
    l.info('job.started', { queueWaitMs });
    const t0 = performance.now();
    try {
      const out = await fn();
      const ms = performance.now() - t0;
      jobsCompleted.inc(labels); jobDuration.observe(ms / 1000, labels);
      r.lastCompletedAt = Date.now(); r.lastDurationMs = ms; r.consecutiveFailures = 0; r.lastError = null;
      l.info('job.completed', { durationMs: Math.round(ms), queueWaitMs });
      span.end();
      return out;
    } catch (e) {
      const ms = performance.now() - t0;
      jobsFailed.inc(labels); jobDuration.observe(ms / 1000, labels);
      r.lastFailedAt = Date.now(); r.lastDurationMs = ms; r.consecutiveFailures++;
      r.lastError = e instanceof Error ? e.message : String(e);
      l.error('job.failed', { durationMs: Math.round(ms), attempt, exception: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { message: String(e) } });
      span.recordError(e).end();
      throw e;
    } finally {
      jobsInFlight.dec({ job_class: meta.jobClass });
    }
  });
}
