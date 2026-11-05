// correlation-propagation.vitest.spec — Constitution 11 §8, §12, §275: HTTP → event → consumer preserves ONE chain.
import { describe, it, expect } from 'vitest';
import { createDomainEvent } from '@aipowersalon/events';
import { runWithContext, contextForEvent, contextForJob, getContext, newTraceId } from '@aipowersalon/observability';

const inRequest = <T>(requestId: string, fn: () => T) =>
  runWithContext({ requestId, correlationId: requestId, traceId: newTraceId(), tenantId: 't1', service: 'api' }, fn);

const evt = (over: Record<string, unknown> = {}) =>
  createDomainEvent({ eventType: 'appointment.created', aggregateType: 'appointment', aggregateId: 'a1', tenantId: 't1', branchId: 'b1', payload: {}, ...over } as never);

describe('§275 the chain survives the hop into async', () => {
  it('an event raised inside a request carries the REQUEST\'s correlation and request ids', () => {
    const e = inRequest('req_ORIGIN', () => evt());
    expect(e.correlationId).toBe('req_ORIGIN');
    expect(e.requestId).toBe('req_ORIGIN');
  });

  it('three events from one request share ONE correlation — previously they were three unrelated chains', () => {
    const [a, b, c] = inRequest('req_ORIGIN', () => [evt(), evt(), evt()]);
    expect(new Set([a.correlationId, b.correlationId, c.correlationId]).size).toBe(1);
    expect(new Set([a.eventId, b.eventId, c.eventId]).size).toBe(3);   // still distinct events
  });

  it('a consumer handling that event continues the same chain into its own context', () => {
    const e = inRequest('req_ORIGIN', () => evt());
    const consumerCtx = contextForEvent({ consumerName: 'sms.sender', eventId: e.eventId, eventType: e.eventType, correlationId: e.correlationId, tenantId: e.tenantId });
    expect(consumerCtx.correlationId).toBe('req_ORIGIN');
    // …and a job the consumer enqueues continues it again
    expect(contextForJob({ jobType: 'twilio.send', correlationId: consumerCtx.correlationId }).correlationId).toBe('req_ORIGIN');
  });

  it('an event raised OUTSIDE any request starts a new chain equal to its own id — unchanged Constitution 8 behaviour', () => {
    expect(getContext()).toBeUndefined();
    const e = evt();
    expect(e.correlationId).toBe(e.eventId);
    expect(e.requestId).toBeUndefined();
  });

  it('an explicit correlationId still wins over the ambient one', () => {
    const e = inRequest('req_ORIGIN', () => evt({ correlationId: 'corr_explicit' }));
    expect(e.correlationId).toBe('corr_explicit');
  });
});
