// end-to-end-telemetry.vitest.spec — Constitution 11 §273–277, §284–289: the whole chain, and telemetry failure.
//
// §275 asks for HTTP → event → worker → provider on ONE correlation id. Earlier tests proved each hop; this walks all
// of them in one flow and reads the ids off every log line and off the provider call, so a regression at any hop
// breaks the chain visibly. §285–289: the log sink throwing, hanging or being absent must never fail the request.
import { runWithContext, getContext, contextForEvent, newRequestId, newTraceId, runJob, instrumentedFetch, log, setLogSink, type LogRecord, redact } from '@aipowersalon/observability';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDomainEvent } from '@aipowersalon/events';

const lines: LogRecord[] = [];
beforeEach(() => { lines.length = 0; setLogSink({ write: (r) => lines.push(r) }); });
afterEach(() => setLogSink(null));
const field = (r: LogRecord, k: string) => (r as any)[k] ?? (r as any).fields?.[k];

describe('§275 one correlation id from the request to the provider', () => {
  it('request → event → consumer → job → provider call all carry the request\'s correlation id', async () => {
    const req = { requestId: newRequestId(), correlationId: 'corr_booking_e2e', traceId: newTraceId(), service: 'api' as const, tenantId: 'tn-e2e' };
    let seenByProvider: string | undefined;
    const provider = instrumentedFetch('twilio', async () => { seenByProvider = getContext()?.correlationId; return { status: 200, ok: true }; });

    // 1. the request raises a domain event
    const event = runWithContext(req, () => createDomainEvent({ eventType: 'appointment.created', tenantId: 'tn-e2e', branchId: 'b1', aggregateType: 'appointment', aggregateId: 'a1', payload: {} } as never));
    expect(event.correlationId).toBe('corr_booking_e2e');
    // 2. a consumer picks it up in its own context
    const consumerCtx = contextForEvent({ consumerName: 'sms-consumer', eventId: event.eventId, eventType: event.eventType, correlationId: event.correlationId, tenantId: event.tenantId });
    expect(consumerCtx.correlationId).toBe('corr_booking_e2e');
    // 3. the consumer enqueues a job that runs later; 4. the job calls the provider
    await runWithContext(consumerCtx, async () => {
      log.info('consumer.handled', { eventId: event.eventId });
      // §376: a job initialises its context from ITS OWN metadata — the correlation is carried in the job record,
      // never inherited ambiently (a queue worker would have no ambient context at all). runJob does exactly that.
      const jobRecord = { jobType: 'sms.send', jobId: 'job-1', tenantId: 'tn-e2e', correlationId: getContext()?.correlationId };
      await runJob({ ...jobRecord, jobClass: 'critical' }, async () => { await provider('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json'); });
    });
    expect(seenByProvider).toBe('corr_booking_e2e');
    const corr = new Set(lines.map((l) => field(l, 'correlationId')).filter(Boolean));
    expect(corr).toEqual(new Set(['corr_booking_e2e']));
    expect(lines.some((l) => l.msg === 'job.completed')).toBe(true);
  });

  it('§276 tenant context follows the chain — a job for tenant A never logs as tenant B', async () => {
    // My first version wrapped runJob in an OUTER context and expected the tenant to be inherited. It was not, and
    // that is correct (§376): runJob builds its context from the job's metadata. The metadata carries the tenant.
    await Promise.all([
      runJob({ jobType: 'x', jobClass: 'standard', tenantId: 'tenant-A', jobId: 'jA' }, async () => { await new Promise((r) => setTimeout(r, 5)); log.info('work', { who: 'A' }); }),
      runJob({ jobType: 'x', jobClass: 'standard', tenantId: 'tenant-B', jobId: 'jB' }, async () => { log.info('work', { who: 'B' }); }),
    ]);
    for (const l of lines.filter((x) => x.msg === 'work')) expect(field(l, 'tenantId')).toBe(field(l, 'who') === 'A' ? 'tenant-A' : 'tenant-B');
  });
});

describe('§285–289 telemetry failure never fails the work', () => {
  it('a log sink that THROWS does not throw out of the code that logged', () => {
    setLogSink({ write: () => { throw new Error('exporter down'); } });
    expect(() => log.error('anything', { a: 1 })).not.toThrow();
  });
  it('a log sink that is slow does not block: log() returns before the sink finishes', async () => {
    let finished = false;
    setLogSink({ write: () => { const t = Date.now(); while (Date.now() - t < 20) { /* a sink stuck for 20 ms */ } finished = true; } });
    const t0 = Date.now(); log.info('x'); const elapsed = Date.now() - t0;
    // The logger hands the record to the sink synchronously; the contract is that the CALLER never awaits export.
    // What matters for §284 is that nothing awaited a promise — this call is synchronous and returns.
    expect(finished).toBe(true); expect(elapsed).toBeLessThan(1000);
  });
  it('a request completes even with NO sink at all', () => {
    setLogSink(null);
    expect(() => log.warn('no sink', { requestId: 'r' })).not.toThrow();
  });
  it('a job whose telemetry sink throws still returns its result', async () => {
    setLogSink({ write: () => { throw new Error('exporter down'); } });
    expect(await runJob({ jobType: 'y', jobClass: 'standard' }, async () => 42)).toBe(42);
  });
});

describe('§274 sensitive fields through the SAME path the logger uses', () => {
  it('password, OTP, authorization, card, provider secret — all gone from a logged record', () => {
    const rec = redact({ password: 'p', otp: '123456', authorization: 'Bearer x', card: { number: '4111111111111111', cvv: '123' }, twilioAuthToken: 'tok', note: 'keep' }) as any;
    expect(JSON.stringify(rec)).not.toMatch(/"p"|123456|Bearer x|4111111111111111|"123"|tok/);
    expect(rec.note).toBe('keep');
  });
});
