// outbox-writer.ts — Constitution 8, Phase 6: write a domain event INSIDE the caller's database transaction.
//
// §18–19 (the outbox rule): the event row commits atomically with the business rows, or neither does. This is
// the only correct way to emit a critical domain event; "commit, then emit()" loses the event if the process
// dies in between, and there is no record that it was ever meant to happen.
//
// Usage (inside an existing Kysely transaction):
//   await db.transaction().execute(async (trx) => {
//     await trx.updateTable('pos_tech_appointments').set({ status: 'completed' })...execute();
//     await outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, ... }));
//   });
//
// The writer validates the envelope first (§37) and REFUSES a bad one by throwing — inside a transaction that
// rolls the business change back too. A domain fact with a malformed event is not committed half-way (§18).
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { type DomainEvent, validateDomainEvent } from './event-contract';

const TRACEPARENT = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

export class InvalidDomainEventError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`invalid domain event: ${reasons.join(', ')}`);
    this.name = 'InvalidDomainEventError';
  }
}

export type DbLike = Kysely<DB> | Transaction<DB>;

// No Nest decorator: EventsCoreModule (./nest) provides it by factory, so the writer stays framework-free (§113).
export class OutboxWriter {
  /**
   * Insert the event into outbox_events using the SAME connection as the business write.
   * Pass the transaction handle, not the root db, or the atomicity guarantee is lost.
   */
  async write<T extends Record<string, unknown>>(trx: DbLike, event: DomainEvent<T>): Promise<void> {
    const reasons = validateDomainEvent(event);
    if (reasons.length) throw new InvalidDomainEventError(reasons);
    await trx.insertInto('outbox_events').values({
      id: event.eventId,
      event_type: event.eventType,
      event_version: event.eventVersion,
      tenant_id: event.tenantId ?? null,
      branch_id: event.branchId ?? null,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      aggregate_version: event.aggregateVersion ?? null,
      actor_id: event.actorId ?? null,
      actor_type: event.actorType ?? null,
      request_id: event.requestId ?? null,
      correlation_id: event.correlationId,
      causation_id: event.causationId ?? null,
      payload_json: JSON.stringify(event.payload) as unknown,
      // Phase 11 (migration 548): the trace continues into the consumers. Only a W3C-shaped value (the column CHECKs it).
      traceparent: typeof event.traceparent === 'string' && TRACEPARENT.test(event.traceparent) ? event.traceparent : null,
      occurred_at: event.occurredAt as unknown as Date,
    }).execute();
  }

  /** Write several events from one transaction (a checkout may produce ticket.paid AND payment.captured). */
  async writeAll(trx: DbLike, events: DomainEvent<any>[]): Promise<void> {
    for (const e of events) await this.write(trx, e);
  }
}
