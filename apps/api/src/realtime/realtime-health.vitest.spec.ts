// realtime-health.vitest.spec — Constitution 9 §143/§147: the incident evaluator's thresholds, and the rates that feed it.
import { describe, it, expect } from 'vitest';
import { evaluateRealtimeHealth, THRESHOLDS } from './realtime-health';
import { RealtimeMetrics } from './realtime.gateway';

const base = { activeConnections: 12, reconnectsPerMinute: 2, authFailuresPerMinute: 0, latencyP95Ms: 120, eventsPerMinute: 40, backbone: 'redis' as const, backbonePublishFailures: 0, slowClientDisconnects: 0 };

describe('§147 incident detection', () => {
  it('a healthy fleet is OPERATIONAL with no signals; nothing connected and nothing flowing is IDLE', () => {
    expect(evaluateRealtimeHealth(base)).toEqual({ status: 'OPERATIONAL', signals: [] });
    expect(evaluateRealtimeHealth({ ...base, activeConnections: 0, eventsPerMinute: 0 }).status).toBe('IDLE');
  });
  it('a reconnect storm or an auth-failure spike DEGRADES; both are named in the signals', () => {
    const r = evaluateRealtimeHealth({ ...base, reconnectsPerMinute: THRESHOLDS.reconnectStormPerMinute, authFailuresPerMinute: THRESHOLDS.authFailureSpikePerMinute });
    expect(r.status).toBe('DEGRADED');
    expect(r.signals.join(' ')).toMatch(/reconnect storm/); expect(r.signals.join(' ')).toMatch(/spike/);
  });
  it('event lag degrades at 3s and is an INCIDENT at 15s', () => {
    expect(evaluateRealtimeHealth({ ...base, latencyP95Ms: 3_000 }).status).toBe('DEGRADED');
    expect(evaluateRealtimeHealth({ ...base, latencyP95Ms: 15_000 }).status).toBe('INCIDENT');
  });
  it('repeated Redis publish failures are an INCIDENT on a redis backbone — and irrelevant on a single node', () => {
    expect(evaluateRealtimeHealth({ ...base, backbonePublishFailures: 5 }).status).toBe('INCIDENT');
    expect(evaluateRealtimeHealth({ ...base, backbone: 'in-process', backbonePublishFailures: 5 }).status).toBe('OPERATIONAL');
  });
  it('the worst signal wins: a storm plus lag at incident level is INCIDENT, not DEGRADED', () => {
    expect(evaluateRealtimeHealth({ ...base, reconnectsPerMinute: 500, latencyP95Ms: 20_000 }).status).toBe('INCIDENT');
  });
});

describe('§140 per-minute rates', () => {
  it('mark() increments the counter AND the current-minute rate; unrelated names stay at 0', () => {
    const m = new RealtimeMetrics();
    for (let i = 0; i < 7; i++) m.mark('reconnects');
    m.mark('originRejected'); m.mark('connectsRateLimited');
    expect(m.reconnects).toBe(7); expect(m.perMinute('reconnects')).toBe(7);
    const s = m.snapshot();
    expect(s.reconnectsPerMinute).toBe(7); expect(s.authFailuresPerMinute).toBe(2);
    expect(m.perMinute('authzTerminations')).toBe(0);
  });
});
