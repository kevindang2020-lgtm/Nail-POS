// job-telemetry.vitest.spec — Constitution 11 §13, §192, §314: every job announces itself, in context, and
// failure is recorded but NOT swallowed.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { runJob, jobRunRegistry, resetJobRunRegistry, jobsFailed, jobsCompleted, jobsInFlight, jobQueueWait } from './job-telemetry';
import { setLogSink, type LogRecord } from './logger';
import { getContext } from './request-context';

const capture = () => { const lines: LogRecord[] = []; setLogSink({ write: (r) => lines.push(r) }); return lines; };
const sum = (snap: Array<{ value: any }>) => snap.reduce((a, s) => a + (typeof s.value === 'number' ? s.value : 0), 0);

beforeEach(() => { resetJobRunRegistry(); });

describe('§192 started / completed / failed, with duration and attempt', () => {
  it('a successful job logs started then completed, both carrying the job context', async () => {
    const lines = capture();
    try { await runJob({ jobType: 'overview.snapshot', jobClass: 'standard', jobId: 'j1', attempt: 2 }, async () => 'ok'); } finally { setLogSink(null); }
    const msgs = lines.map((l) => l.msg);
    expect(msgs).toEqual(['job.started', 'job.completed']);
    expect(lines[1]).toMatchObject({ jobType: 'overview.snapshot', jobClass: 'standard', jobId: 'j1', attempt: 2, operation: 'job.overview.snapshot', service: 'job' });
    expect(typeof lines[1].durationMs).toBe('number');
  });

  it('a failing job logs job.failed at ERROR with the exception, and RETHROWS — telemetry never swallows', async () => {
    const lines = capture();
    let thrown: unknown;
    try { await runJob({ jobType: 'sms.reconcile', jobClass: 'reconciliation' }, async () => { throw new Error('twilio 503'); }); }
    catch (e) { thrown = e; } finally { setLogSink(null); }
    expect((thrown as Error).message).toBe('twilio 503');
    const f = lines.find((l) => l.msg === 'job.failed')!;
    expect(f.level).toBe('error');
    expect((f.exception as any).message).toBe('twilio 503');
  });

  it('the job runs INSIDE its own telemetry context, and the context is gone afterwards', async () => {
    let inside: string | undefined;
    await runJob({ jobType: 'x', jobClass: 'standard', tenantId: 't9' }, async () => { inside = `${getContext()?.operation}|${getContext()?.tenantId}`; });
    expect(inside).toBe('job.x|t9');
    expect(getContext()).toBeUndefined();
  });

  it('§13: a job caused by a request CONTINUES its correlation chain', async () => {
    let corr: string | undefined;
    await runJob({ jobType: 'x', jobClass: 'standard', correlationId: 'req_ORIGIN' }, async () => { corr = getContext()?.correlationId; });
    expect(corr).toBe('req_ORIGIN');
  });
});

describe('§314 queue wait is separate from processing time', () => {
  it('reports queueWaitMs when the job knows when it was enqueued', async () => {
    const lines = capture();
    const countBefore = jobQueueWait.snapshot().reduce((a, s) => a + (s.value as any).count, 0);
    try { await runJob({ jobType: 'x', jobClass: 'ai', enqueuedAt: Date.now() - 2_000 }, async () => undefined); } finally { setLogSink(null); }
    expect(lines[0].queueWaitMs).toBeGreaterThanOrEqual(1_900);
    // The METRIC too, not only the log field — a mutation dropping the histogram observe passed on the log alone.
    expect(jobQueueWait.snapshot().reduce((a, s) => a + (s.value as any).count, 0)).toBe(countBefore + 1);
  });
  it('and omits it when it does not', async () => {
    const lines = capture();
    try { await runJob({ jobType: 'x', jobClass: 'ai' }, async () => undefined); } finally { setLogSink(null); }
    expect(lines[0].queueWaitMs).toBeUndefined();
  });
});

describe('§48/§111 the run registry — how the aggregator sees a scheduler that stopped ticking', () => {
  it('records last success and clears the failure streak on success', async () => {
    await runJob({ jobType: 'y', jobClass: 'critical' }, async () => { throw new Error('a'); }).catch(() => undefined);
    await runJob({ jobType: 'y', jobClass: 'critical' }, async () => { throw new Error('b'); }).catch(() => undefined);
    let r = jobRunRegistry().find((x) => x.jobType === 'y')!;
    expect(r.consecutiveFailures).toBe(2); expect(r.lastError).toBe('b'); expect(r.lastCompletedAt).toBeNull();
    await runJob({ jobType: 'y', jobClass: 'critical' }, async () => undefined);
    r = jobRunRegistry().find((x) => x.jobType === 'y')!;
    expect(r.consecutiveFailures).toBe(0); expect(r.lastError).toBeNull(); expect(r.lastCompletedAt).not.toBeNull();
  });
  it('metrics are by job TYPE and CLASS, never by tenant', async () => {
    const before = sum(jobsCompleted.snapshot());
    await runJob({ jobType: 'z', jobClass: 'report', tenantId: 'secret-tenant' }, async () => undefined);
    expect(sum(jobsCompleted.snapshot())).toBe(before + 1);
    expect(JSON.stringify(jobsCompleted.snapshot())).not.toContain('secret-tenant');
    expect(jobsCompleted.labelNames).toEqual(['job_type', 'job_class']);
  });
  it('the in-flight gauge returns to its starting value even when the job throws', async () => {
    const before = sum(jobsInFlight.snapshot());
    await runJob({ jobType: 'w', jobClass: 'import' }, async () => { throw new Error('x'); }).catch(() => undefined);
    expect(sum(jobsInFlight.snapshot())).toBe(before);
    expect(sum(jobsFailed.snapshot())).toBeGreaterThan(0);
  });
});

describe('the scheduler interval is LEARNED from consecutive starts (§111)', () => {
  // The health aggregator flags a scheduler whose last start is older than 3× its interval — but no scheduler
  // declares its interval. The registry learns it from the gap between starts instead of editing all 21.
  afterEach(() => vi.useRealTimers());
  const at = (ms: number) => { vi.useFakeTimers(); vi.setSystemTime(ms); };

  it('two runs a minute apart teach a one-minute interval', async () => {
    resetJobRunRegistry();
    at(10_000_000); await runJob({ jobType: 'zz.learn', jobClass: 'standard' }, async () => undefined);
    at(10_060_000); await runJob({ jobType: 'zz.learn', jobClass: 'standard' }, async () => undefined);
    expect(jobRunRegistry().find((r) => r.jobType === 'zz.learn')!.observedIntervalMs).toBe(60_000);
  });
  it('one early manual run does not shrink the yardstick (which would cause false "stalled" alarms)', async () => {
    resetJobRunRegistry();
    const go = () => runJob({ jobType: 'zz.early', jobClass: 'standard' }, async () => undefined);
    at(20_000_000); await go(); at(20_060_000); await go(); at(20_065_000); await go();   // third = early manual trigger
    expect(jobRunRegistry().find((r) => r.jobType === 'zz.early')!.observedIntervalMs).toBeGreaterThanOrEqual(54_000);
  });
  it('a single run has no interval yet — null, not 0', async () => {
    resetJobRunRegistry();
    await runJob({ jobType: 'zz.once', jobClass: 'standard' }, async () => undefined);
    expect(jobRunRegistry().find((r) => r.jobType === 'zz.once')!.observedIntervalMs).toBeNull();
  });
});
