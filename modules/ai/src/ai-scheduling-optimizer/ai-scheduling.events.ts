// ai-scheduling.events.ts — BUILD_PLAN Phase 7: SchedEventsPort over the transactional outbox. Every schedule.* domain
// event is written with the SAME connection as the state change it describes (pass the transaction handle) — so a
// recommendation is never "applied" without its event, nor an event sent for a change that rolled back. Realtime is the
// projection consumer's job (apps/api/src/events/consumers/realtime-projection.consumer.ts); nothing here emits directly.
import type { Kysely } from 'kysely';
import { createDomainEvent, validateDomainEvent, type OutboxWriter, type DomainEventType } from '@aipowersalon/events';
import type { SchedCtx, SchedEventsPort, SchedAggregateType } from './ai-scheduling.ports';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorType = (ctx: SchedCtx): 'user' | 'system' | 'worker' => (ctx.actor === 'automation' ? 'worker' : ctx.actor === 'system' || String(ctx.role).toUpperCase() === 'SYSTEM' ? 'system' : 'user');

export function schedEvent(ctx: SchedCtx, eventType: string, aggregate: { type: SchedAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>) {
  return createDomainEvent({
    eventType: eventType as DomainEventType, tenantId: ctx.tenantId,
    branchId: ctx.branchId && UUID_RE.test(ctx.branchId) ? ctx.branchId : undefined,
    aggregateType: aggregate.type, aggregateId: aggregate.id, aggregateVersion: aggregate.version ?? undefined,
    actorId: ctx.userId || undefined, actorType: actorType(ctx),
    requestId: ctx.requestId ?? undefined, correlationId: ctx.correlationId ?? undefined, payload,
  });
}

export class OutboxSchedEvents implements SchedEventsPort {
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter) {}
  async emit(ctx: SchedCtx, eventType: string, aggregate: { type: SchedAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>, trx?: unknown): Promise<void> {
    await this.outbox.write((trx ?? this.db) as never, schedEvent(ctx, eventType, aggregate, payload));
  }
}

/** Dev / unit tests: records the events (validated the same way the outbox would). */
export class InMemorySchedEvents implements SchedEventsPort {
  readonly events: { type: string; aggregateId: string; branchId: string | null; payload: Record<string, unknown> }[] = [];
  async emit(ctx: SchedCtx, eventType: string, aggregate: { type: SchedAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>): Promise<void> {
    const bad = validateDomainEvent(schedEvent(ctx, eventType, aggregate, payload));
    if (bad.length) throw new Error('invalid schedule event: ' + bad.join(', '));
    this.events.push({ type: eventType, aggregateId: aggregate.id, branchId: ctx.branchId ?? null, payload });
  }
}
