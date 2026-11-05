// consumer.ts — an outbox event consumer runs inside the trace of the request (or job) that WROTE the event.
//
// The outbox row carries the writer's `traceparent` (migration 548, nullable: events written before it, or outside any
// context, have none). The consumer span is a CHILD of that span and also LINKS to it, so a trace backend shows
// request → event → consumer as one tree even though the consumer ran later, in another process. Without a traceparent
// the consumer starts its own trace, exactly as before.
import { contextForEvent, runWithContext } from '../request-context';
import { startSpan } from './span';
import { parseTraceparent } from './traceparent';

export interface EventConsumerMeta {
  consumerName: string; eventId: string; eventType: string;
  correlationId?: string | null; tenantId?: string | null; branchId?: string | null; traceparent?: string | null;
}

export async function runEventConsumer<T>(meta: EventConsumerMeta, fn: () => Promise<T>, outcomeIsError: (out: T) => boolean = () => false): Promise<T> {
  const parent = parseTraceparent(meta.traceparent);
  const span = startSpan(`consume ${meta.eventType}`, {
    kind: 'consumer', parent: parent ?? null, links: parent ? [{ traceId: parent.traceId, spanId: parent.spanId }] : undefined,
    attributes: { 'messaging.system': 'outbox', 'messaging.operation': 'process', 'messaging.destination.name': meta.eventType, 'messaging.message.id': meta.eventId, 'aipowersalon.consumer': meta.consumerName, 'aipowersalon.tenant_id': meta.tenantId ?? undefined },
  });
  const ctx = contextForEvent({ consumerName: meta.consumerName, eventId: meta.eventId, eventType: meta.eventType, correlationId: meta.correlationId, tenantId: meta.tenantId, branchId: meta.branchId,
    trace: { traceId: span.traceId, spanId: span.spanId, parentSpanId: parent?.spanId, sampled: span.sampled } });
  return runWithContext(ctx, async () => {
    try {
      const out = await fn();
      if (outcomeIsError(out)) span.setStatus('error', 'ConsumerFailed');
      return out;
    } catch (e) { span.recordError(e); throw e; }
    finally { span.end(); }
  });
}
