// consumer-runner.ts — Constitution 8, Phase 9–10: run ONE consumer against ONE event, the §24 way.
//
//   receive → validate schema → validate/upcast version → BEGIN → processed_events? (yes: COMMIT, done)
//   → handler(event, trx) → INSERT processed_events → COMMIT
//
// The processed_events insert is INSIDE the handler's transaction, so a handler's writes and its "done" marker
// commit together. If the handler throws, both roll back and the failure is recorded in event_dead_letters —
// per consumer (§49), classified (§51), retried only if TRANSIENT (§50), alerting if SECURITY (§143).
//
// This runner never throws for a consumer failure: that is the consumer's problem and is recorded as such.
// It throws only when the DATABASE itself is unavailable, which the publisher treats as a transport failure.
import { type DomainEvent, validateDomainEvent, DOMAIN_EVENTS, createDomainEvent, isPlatformEvent, type EventConsumer, ConsumerError, ConsumerTimeoutError, classifyError, maxAttemptsFor, nextAttemptDelayMs, upcastToCurrent, type ErrorClass } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import { runEventConsumer } from '@aipowersalon/observability';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { EVENT_DEAD_LETTER } from './event-lifecycles';

export type RunOutcome =
  | { status: 'processed' }
  | { status: 'duplicate' }                                   // already processed by this consumer — success (§23)
  | { status: 'retry_scheduled'; errorClass: 'TRANSIENT'; code: string; attempt: number; nextAttemptAt: Date }
  | { status: 'dead_lettered'; errorClass: ErrorClass; code: string; attempt: number };

export interface RunnerHooks {
  /** §143: called when a SECURITY-class failure is recorded. Default: writes a security.tenant_mismatch outbox event. */
  onSecurityFailure?: (event: DomainEvent<any>, consumer: EventConsumer, code: string) => Promise<void>;
  now?: () => Date;
  rand?: () => number;
}

export class ConsumerRunner {
  constructor(private readonly db: Kysely<DB>, private readonly hooks: RunnerHooks = {}) {}

  /** BUILD_PLAN Phase 11: every consumer run is a span in the trace of the request/job that wrote the event (the
   *  envelope's traceparent), with a consumer context (ids, tenant) around it — DB spans inside the handler join it. */
  async run(consumer: EventConsumer, raw: DomainEvent<any>): Promise<RunOutcome> {
    return runEventConsumer(
      { consumerName: consumer.name, eventId: String(raw?.eventId ?? ''), eventType: String(raw?.eventType ?? 'unknown'), correlationId: raw?.correlationId, tenantId: raw?.tenantId, branchId: raw?.branchId, traceparent: raw?.traceparent },
      () => this.runOnce(consumer, raw),
      (out) => out.status === 'dead_lettered' || out.status === 'retry_scheduled',
    );
  }

  private async runOnce(consumer: EventConsumer, raw: DomainEvent<any>): Promise<RunOutcome> {
    const now = this.hooks.now ?? (() => new Date());
    // 1. schema — a malformed event is PERMANENT for every consumer; nobody retries it
    const reasons = validateDomainEvent(raw);
    if (reasons.length) return this.fail(consumer, raw, new ConsumerError('PERMANENT', `invalid_event:${reasons[0]}`), now());
    // 2. version — upcast or refuse (§34–36)
    let event: DomainEvent<any>;
    try { event = upcastToCurrent(raw); } catch (e) { return this.fail(consumer, raw, e, now()); }
    // 3. §13/§14: tenant events must carry a tenant; the handler must load through tenant-aware repos
    if (!isPlatformEvent(event.eventType) && !event.tenantId) return this.fail(consumer, raw, new ConsumerError('SECURITY', 'tenant_id_missing'), now());

    try {
      const outcome = await this.db.transaction().execute(async (trx): Promise<RunOutcome> => {
        const seen = await trx.selectFrom('processed_events').select('event_id')
          .where('consumer_name', '=', consumer.name).where('event_id', '=', event.eventId).executeTakeFirst();
        if (seen) return { status: 'duplicate' };                                                     // §23
        await withTimeout(consumer.handle(event, trx), consumer.timeoutMs ?? 30_000);                // §127
        await trx.insertInto('processed_events').values({ consumer_name: consumer.name, event_id: event.eventId, tenant_id: event.tenantId ?? null }).execute();
        return { status: 'processed' };
      });
      if (outcome.status === 'processed') await this.resolveDeadLetterIfAny(consumer, event);      // a retry that finally succeeded
      return outcome;
    } catch (e) {
      return this.fail(consumer, event, e, now());
    }
  }

  /** Record the failure per (consumer, event): retry if TRANSIENT and attempts remain, else dead-letter. */
  private async fail(consumer: EventConsumer, event: DomainEvent<any>, err: unknown, at: Date): Promise<RunOutcome> {
    const { errorClass, code } = classifyError(err);
    const prev = await this.db.selectFrom('event_dead_letters').select(['attempts'])
      .where('consumer_name', '=', consumer.name).where('event_id', '=', event.eventId).executeTakeFirst();
    const attempt = (prev?.attempts ?? 0) + 1;
    const canRetry = errorClass === 'TRANSIENT' && attempt < maxAttemptsFor(consumer);
    const nextAt = canRetry ? new Date(at.getTime() + nextAttemptDelayMs(attempt, this.hooks.rand)) : null;
    const status = canRetry ? 'retrying' : 'open';

    await sql`
      INSERT INTO event_dead_letters (event_id, consumer_name, tenant_id, event_type, correlation_id, envelope_json, attempts, error_class, last_error_code, first_failed_at, last_failed_at, status, next_attempt_at)
      VALUES (${event.eventId}, ${consumer.name}, ${event.tenantId ?? null}, ${event.eventType}, ${event.correlationId ?? null}, ${JSON.stringify(event)}::jsonb, ${attempt}, ${errorClass}, ${code}, ${at}, ${at}, ${status}, ${nextAt})
      ON CONFLICT (consumer_name, event_id) DO UPDATE SET
        attempts = ${attempt}, error_class = ${errorClass}, last_error_code = ${code}, last_failed_at = ${at}, status = ${status}, next_attempt_at = ${nextAt}
      WHERE ${canMoveToSql(EVENT_DEAD_LETTER, status, 'event_dead_letters')}
    `.execute(this.db);

    if (errorClass === 'SECURITY') await this.securityAlert(event, consumer, code);
    return canRetry
      ? { status: 'retry_scheduled', errorClass: 'TRANSIENT', code, attempt, nextAttemptAt: nextAt! }
      : { status: 'dead_lettered', errorClass, code, attempt };
  }

  private async resolveDeadLetterIfAny(consumer: EventConsumer, event: DomainEvent<any>): Promise<void> {
    await this.db.updateTable('event_dead_letters').set({ status: 'resolved', resolved_at: new Date() as any, resolved_by: 'retry' })
      .where('consumer_name', '=', consumer.name).where('event_id', '=', event.eventId).where('status', '=', 'retrying').where(canMoveToSql(EVENT_DEAD_LETTER, 'resolved') as any).execute();
  }

  /** §143: a tenant mismatch is a security event in its own right — durable, via the outbox, never just a log line. */
  private async securityAlert(event: DomainEvent<any>, consumer: EventConsumer, code: string): Promise<void> {
    if (this.hooks.onSecurityFailure) return this.hooks.onSecurityFailure(event, consumer, code);
    const alert = createDomainEvent({
      eventType: DOMAIN_EVENTS.SECURITY_TENANT_MISMATCH, aggregateType: 'consumer', aggregateId: consumer.name, actorType: 'worker',
      correlationId: event.correlationId, causationId: event.eventId,
      payload: { consumerName: consumer.name, offendingEventId: event.eventId, offendingEventType: event.eventType, tenantId: event.tenantId ?? null, code },
    });
    await this.db.insertInto('outbox_events').values({
      id: alert.eventId, event_type: alert.eventType, event_version: alert.eventVersion, tenant_id: null, branch_id: null,
      aggregate_type: alert.aggregateType, aggregate_id: alert.aggregateId, actor_type: 'worker', correlation_id: alert.correlationId,
      causation_id: alert.causationId ?? null, payload_json: JSON.stringify(alert.payload) as any, occurred_at: alert.occurredAt as any,
    }).execute().catch(() => { /* alerting must never mask the original failure */ });
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ConsumerTimeoutError(ms)), ms); });
  try { return await Promise.race([p, timeout]); } finally { if (t) clearTimeout(t); }
}
