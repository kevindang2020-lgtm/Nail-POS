// request-context.vitest.spec — Constitution 11 §7–10, §275–277, §377: identity, propagation and ISOLATION.
import { describe, it, expect } from 'vitest';
import { runWithContext, getContext, enrichContext, newRequestId, newTraceId, sanitizeInboundId, contextForJob, contextForEvent, contextFields } from './request-context';
import { log, setLogSink, type LogRecord } from './logger';

const ctx = (id: string) => ({ requestId: id, correlationId: id, traceId: newTraceId(), service: 'api' as const });

describe('§7 request ids', () => {
  it('look like req_<26 chars> and are unique', () => {
    const a = newRequestId(), b = newRequestId();
    expect(a).toMatch(/^req_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
  });
  it('sort by creation time — a later request has a later id', () => {
    expect(newRequestId(1_000_000) < newRequestId(2_000_000)).toBe(true);
  });
  it('trace ids are W3C shape: 32 lowercase hex', () => expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/));
});

describe('§8–9 correlation continues a chain, but only for id-shaped input', () => {
  it('an inbound correlation id is accepted', () => expect(sanitizeInboundId('booking-abc-123')).toBe('booking-abc-123'));
  it('free text is refused — a client must not inject prose into every log line', () => {
    expect(sanitizeInboundId('<script>alert(1)</script>')).toBeUndefined();
    expect(sanitizeInboundId('hello world')).toBeUndefined();
    expect(sanitizeInboundId('x'.repeat(200))).toBeUndefined();
  });
  it('a job continues the correlation it was given; without one it starts its own', () => {
    expect(contextForJob({ jobType: 'sms', correlationId: 'corr_1' }).correlationId).toBe('corr_1');
    const fresh = contextForJob({ jobType: 'sms' });
    expect(fresh.correlationId).toBe(fresh.requestId);
  });
  it('an event consumer context names the consumer and event type as its operation', () => {
    const c = contextForEvent({ consumerName: 'realtime.projection', eventId: 'e1', eventType: 'ticket.paid', correlationId: 'corr_9', tenantId: 't1' });
    expect(c.operation).toBe('consumer.realtime.projection:ticket.paid');
    expect(c.correlationId).toBe('corr_9');
    expect(c.requestId).toBe('evt_e1');
  });
});

describe('§277/§377 THE ISOLATION TEST: concurrent requests never see each other\'s context', () => {
  it('two interleaved async flows keep their own tenant', async () => {
    const seen: Record<string, string | undefined> = {};
    const flow = (id: string, tenant: string, delay: number) => runWithContext(ctx(id), async () => {
      enrichContext({ tenantId: tenant });
      await new Promise((r) => setTimeout(r, delay));            // yield — the other flow runs in between
      seen[id] = getContext()?.tenantId;
      await new Promise((r) => setTimeout(r, delay));
      seen[id + ':after'] = getContext()?.tenantId;
    });
    await Promise.all([flow('A', 'tenant-A', 5), flow('B', 'tenant-B', 2)]);
    expect(seen).toEqual({ A: 'tenant-A', 'A:after': 'tenant-A', B: 'tenant-B', 'B:after': 'tenant-B' });
  });

  it('a log line written inside flow A carries A\'s ids even while B is mid-flight', async () => {
    const lines: LogRecord[] = [];
    setLogSink({ write: (r) => lines.push(r) });
    try {
      await Promise.all([
        runWithContext(ctx('req_A'), async () => { enrichContext({ tenantId: 'tenant-A' }); await new Promise((r) => setTimeout(r, 4)); log.info('from A'); }),
        runWithContext(ctx('req_B'), async () => { enrichContext({ tenantId: 'tenant-B' }); await new Promise((r) => setTimeout(r, 1)); log.info('from B'); }),
      ]);
    } finally { setLogSink(null); }
    const a = lines.find((l) => l.msg === 'from A')!, b = lines.find((l) => l.msg === 'from B')!;
    expect([a.requestId, a.tenantId]).toEqual(['req_A', 'tenant-A']);
    expect([b.requestId, b.tenantId]).toEqual(['req_B', 'tenant-B']);
  });

  it('outside any context, logging still works — with no ids rather than a stale one', () => {
    const lines: LogRecord[] = [];
    setLogSink({ write: (r) => lines.push(r) });
    try { log.info('bare'); } finally { setLogSink(null); }
    expect(lines[0].requestId).toBeUndefined();
    expect(getContext()).toBeUndefined();
  });
});

describe('§16 the structured line', () => {
  it('has the schema fields and redacts what it is given', () => {
    const lines: LogRecord[] = [];
    setLogSink({ write: (r) => lines.push(r) });
    try {
      runWithContext({ ...ctx('req_1'), tenantId: 't1', branchId: 'b1', operation: 'api.POST /x' }, () => log.warn('provider slow', { provider: 'twilio', password: 'nope', durationMs: 900 }));
    } finally { setLogSink(null); }
    const l = lines[0];
    expect(l).toMatchObject({ level: 'warn', msg: 'provider slow', requestId: 'req_1', tenantId: 't1', branchId: 'b1', operation: 'api.POST /x', provider: 'twilio', durationMs: 900, password: '[REDACTED]' });
    expect(l.timestamp).toMatch(/Z$/);
    expect(contextFields(getContext())).toEqual({});
  });
  it('withContext binds fields onto every subsequent line', () => {
    const lines: LogRecord[] = [];
    setLogSink({ write: (r) => lines.push(r) });
    try { log.withContext({ jobId: 'j1' }).info('started'); } finally { setLogSink(null); }
    expect(lines[0].jobId).toBe('j1');
  });
});
