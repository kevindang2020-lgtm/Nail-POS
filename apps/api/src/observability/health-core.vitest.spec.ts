// health-core.vitest.spec — Constitution 11 §84–91, §301–302, §332–333.
import { describe, it, expect } from 'vitest';
import { evaluateApi, evaluateDatabase, evaluateRedis, evaluateRealtime, evaluateWorkers, evaluateEvents, evaluateProviderGroup, evaluateWorkflow,
  applyHysteresis, effectiveStatus, rollup, toStatusPage, COMPONENTS, HYSTERESIS, type HysteresisState } from './health-core';

describe('§332 no fake green — no data is UNKNOWN everywhere', () => {
  it('api with no traffic', () => expect(evaluateApi({ requests: 0, serverErrors: 0, p95Seconds: null }).status).toBe('UNKNOWN'));
  it('database without a probe', () => expect(evaluateDatabase({ probeOk: null, poolUtilisation: null, waiting: 0, queryErrorRate: null }).status).toBe('UNKNOWN'));
  it('redis with no clients', () => expect(evaluateRedis([]).status).toBe('UNKNOWN'));
  it('workers with no jobs reported', () => expect(evaluateWorkers([], 0).status).toBe('UNKNOWN'));
  it('events not measured', () => expect(evaluateEvents(null).status).toBe('UNKNOWN'));
  it('a provider group nobody has called', () => expect(evaluateProviderGroup([{ provider: 'twilio', status: 'UNKNOWN' }]).status).toBe('UNKNOWN'));
  it('a workflow with no traffic', () => expect(evaluateWorkflow({ total: 0, systemFailures: 0 }).status).toBe('UNKNOWN'));
});

describe('evaluators', () => {
  it('api: 5% server errors degrade, 25% is an outage, slow p95 degrades', () => {
    expect(evaluateApi({ requests: 100, serverErrors: 5, p95Seconds: 0.1 }).status).toBe('DEGRADED');
    expect(evaluateApi({ requests: 100, serverErrors: 25, p95Seconds: 0.1 }).status).toBe('OUTAGE');
    expect(evaluateApi({ requests: 100, serverErrors: 0, p95Seconds: 2.5 })).toMatchObject({ status: 'DEGRADED', reason: 'latency_p95' });
    expect(evaluateApi({ requests: 100, serverErrors: 1, p95Seconds: 0.2 }).status).toBe('HEALTHY');
  });
  it('database: a failed probe is decisive; pool saturation needs WAITERS to matter', () => {
    expect(evaluateDatabase({ probeOk: false, poolUtilisation: 0.1, waiting: 0, queryErrorRate: 0 }).status).toBe('OUTAGE');
    expect(evaluateDatabase({ probeOk: true, poolUtilisation: 0.95, waiting: 3, queryErrorRate: 0 }).status).toBe('DEGRADED');
    expect(evaluateDatabase({ probeOk: true, poolUtilisation: 0.95, waiting: 0, queryErrorRate: 0 }).status).toBe('HEALTHY');   // busy, not starved
  });
  it('redis: one role down is DEGRADED and names the role; all down is OUTAGE', () => {
    expect(evaluateRedis([{ role: 'cache', up: true }, { role: 'realtime', up: false }])).toMatchObject({ status: 'DEGRADED', reason: 'down:realtime' });
    expect(evaluateRedis([{ role: 'cache', up: false }]).status).toBe('OUTAGE');
  });
  it('realtime maps Constitution 9\'s own verdict — IDLE is healthy, INCIDENT is an outage', () => {
    expect(evaluateRealtime({ status: 'IDLE', signals: [] }).status).toBe('HEALTHY');
    expect(evaluateRealtime({ status: 'INCIDENT', signals: ['backbone'] })).toMatchObject({ status: 'OUTAGE', reason: 'backbone' });
  });
  it('workers: a scheduler that STOPPED TICKING is caught — the failure no error log shows', () => {
    const now = 1_000_000;
    const r = evaluateWorkers([{ jobType: 'booking.hold_sweep', lastStartedAt: now - 400_000, lastFailedAt: null, lastCompletedAt: now - 400_000, intervalMs: 60_000 }], now);
    expect(r).toMatchObject({ status: 'DEGRADED', reason: 'stalled:booking.hold_sweep' });
  });
  it('workers: a last run that failed after the last success degrades; a later success clears it', () => {
    const now = 1_000_000;
    expect(evaluateWorkers([{ jobType: 'x', lastStartedAt: now, lastFailedAt: now, lastCompletedAt: now - 1, intervalMs: 60_000 }], now).status).toBe('DEGRADED');
    expect(evaluateWorkers([{ jobType: 'x', lastStartedAt: now, lastFailedAt: now - 5, lastCompletedAt: now, intervalMs: 60_000 }], now).status).toBe('HEALTHY');
  });
  it('events: oldest-pending age drives it (§46), and dead letters degrade', () => {
    expect(evaluateEvents({ oldestPendingAgeSec: 1000, openDeadLetters: 0, criticalConsumerLagSec: 0 }).status).toBe('OUTAGE');
    expect(evaluateEvents({ oldestPendingAgeSec: 200, openDeadLetters: 0, criticalConsumerLagSec: 0 }).status).toBe('DEGRADED');
    expect(evaluateEvents({ oldestPendingAgeSec: 5, openDeadLetters: 2, criticalConsumerLagSec: 0 })).toMatchObject({ status: 'DEGRADED', reason: 'dead_letters' });
  });
  it('§91 providers: one out of several is DEGRADED, all out is OUTAGE', () => {
    expect(evaluateProviderGroup([{ provider: 'cardpointe', status: 'OUTAGE' }, { provider: 'fiserv', status: 'HEALTHY' }])).toMatchObject({ status: 'DEGRADED', reason: 'outage:cardpointe' });
    expect(evaluateProviderGroup([{ provider: 'cardpointe', status: 'OUTAGE' }]).status).toBe('OUTAGE');
  });
  it('workflows: below minimum traffic one failure is DEGRADED, never an OUTAGE', () => {
    expect(evaluateWorkflow({ total: 2, systemFailures: 1 }).status).toBe('DEGRADED');
    expect(evaluateWorkflow({ total: 100, systemFailures: 15 }).status).toBe('OUTAGE');
    expect(evaluateWorkflow({ total: 100, systemFailures: 2 }).status).toBe('DEGRADED');
    expect(evaluateWorkflow({ total: 1000, systemFailures: 5 }).status).toBe('HEALTHY');
  });
});

describe('§301–302 hysteresis — no flapping, and recovery must be proven', () => {
  const run = (seq: string[], start: HysteresisState | null = null) => seq.reduce<HysteresisState | null>((s, o) => applyHysteresis(s, o as never), start)!.current;
  it('the first observation is accepted as-is', () => expect(run(['HEALTHY'])).toBe('HEALTHY'));
  it('ONE transient failure does not flip HEALTHY to OUTAGE', () => expect(run(['HEALTHY', 'OUTAGE', 'HEALTHY'])).toBe('HEALTHY'));
  it(`${HYSTERESIS.toWorse} consecutive bad observations DO flip it`, () => expect(run(['HEALTHY', 'OUTAGE', 'OUTAGE'])).toBe('OUTAGE'));
  it(`recovery needs ${HYSTERESIS.toBetter} consecutive good observations — MORE than degrading needed`, () => {
    expect(run(['OUTAGE', 'HEALTHY', 'HEALTHY'])).toBe('OUTAGE');
    expect(run(['OUTAGE', 'HEALTHY', 'HEALTHY', 'HEALTHY'])).toBe('HEALTHY');
  });
  it('an interrupted streak starts over', () => expect(run(['HEALTHY', 'OUTAGE', 'DEGRADED', 'OUTAGE'])).toBe('HEALTHY'));
});

describe('§333 staleness', () => {
  it('a fresh snapshot keeps its status', () => expect(effectiveStatus({ status: 'HEALTHY', expiresAt: 100 }, 50)).toBe('HEALTHY'));
  it('an EXPIRED snapshot is UNKNOWN — a stopped aggregator must not read as green', () => expect(effectiveStatus({ status: 'HEALTHY', expiresAt: 100 }, 101)).toBe('UNKNOWN'));
  it('no snapshot at all is UNKNOWN', () => expect(effectiveStatus(null, 0)).toBe('UNKNOWN'));
});

describe('§89 / §91 rollup — degradation stays where it belongs', () => {
  const c = (key: string, status: string, criticality: string) => ({ key, status, criticality }) as never;
  it('an OPTIONAL outage (AI) leaves the platform HEALTHY', () => {
    expect(rollup([c('api', 'HEALTHY', 'CRITICAL'), c('ai', 'OUTAGE', 'OPTIONAL')])).toBe('HEALTHY');
  });
  it('an IMPORTANT outage (SMS) pulls the platform to DEGRADED, never OUTAGE', () => {
    expect(rollup([c('api', 'HEALTHY', 'CRITICAL'), c('communications', 'OUTAGE', 'IMPORTANT')])).toBe('DEGRADED');
  });
  it('a CRITICAL outage (database) is a platform outage', () => {
    expect(rollup([c('database', 'OUTAGE', 'CRITICAL'), c('ai', 'HEALTHY', 'OPTIONAL')])).toBe('OUTAGE');
  });
  it('§332: a CRITICAL component we cannot see makes the platform UNKNOWN, not HEALTHY', () => {
    expect(rollup([c('api', 'HEALTHY', 'CRITICAL'), c('payments', 'UNKNOWN', 'CRITICAL')])).toBe('UNKNOWN');
  });
  it('planned MAINTENANCE on a critical component is not a platform failure', () => {
    expect(rollup([c('api', 'HEALTHY', 'CRITICAL'), c('payments', 'MAINTENANCE', 'CRITICAL')])).toBe('HEALTHY');
  });
});

describe('the registry and the status-page mapping', () => {
  it('covers every component §341 names', () => {
    const keys = COMPONENTS.map((x) => x.key);
    for (const k of ['api', 'database', 'redis', 'realtime', 'workers', 'payments', 'ai']) expect(keys, k).toContain(k);
  });
  it('every component has an owner and a runbook (§102, §177 — no alert nobody can act on)', () => {
    for (const x of COMPONENTS) { expect(x.owner, x.key).toBeTruthy(); expect(x.runbook, x.key).toBeTruthy(); }
  });
  it('UNKNOWN maps to the status page as "unknown" — never "operational"', () => {
    expect(toStatusPage('UNKNOWN', 'CRITICAL')).toBe('unknown');
    expect(toStatusPage('OUTAGE', 'CRITICAL')).toBe('major_outage');
    expect(toStatusPage('OUTAGE', 'IMPORTANT')).toBe('partial_outage');
  });
});
