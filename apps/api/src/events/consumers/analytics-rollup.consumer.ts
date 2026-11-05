// analytics-rollup.consumer.ts — Constitution 8 §80/§128: the analytics consumer.
//
// Reuse, not a new store (§211): pos_kpi_daily_snapshots already exists with
// UNIQUE (tenant_id, branch_id, business_day, module) and a JSONB metrics bag, and POS screens already read it.
// This consumer adds a 'events' module row per tenant/branch/day and INCREMENTS counters in it.
//
// Two deliberate differences from the existing PosKpiSnapshots.upsertToday helper:
//   1. upsertToday REPLACES the metrics bag; a rollup must ADD to it, so the upsert below merges with a jsonb
//      increment rather than overwriting.
//   2. upsertToday is fail-soft (never throws) — correct for a best-effort call from a request path, wrong
//      inside a consumer, where swallowing the error would make the runner record a success that never happened.
//      Here a failure propagates and the §24 runner classifies it.
//
// Counting is not naturally idempotent, so processed_events IS the guard: it is inserted in the SAME
// transaction as the increment (§24), which is exactly why this consumer is REPLAY_SAFE_WITH_IDEMPOTENCY and
// not REPLAY_SAFE — delete those markers and a replay would double every counter.
import { type EventConsumer, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import { sql, type Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';

/** domain event → the counter(s) it increments. Money is summed in integer cents (§102). */
export function countersFor(e: DomainEvent<any>): Record<string, number> {
  switch (e.eventType) {
    case DOMAIN_EVENTS.APPOINTMENT_CREATED:   return { appointments_created: 1 };
    case DOMAIN_EVENTS.APPOINTMENT_CANCELED:  return { appointments_canceled: 1 };
    case DOMAIN_EVENTS.APPOINTMENT_NO_SHOW:   return { appointments_no_show: 1 };
    case DOMAIN_EVENTS.APPOINTMENT_COMPLETED: return { appointments_completed: 1 };
    case DOMAIN_EVENTS.SERVICE_COMPLETED:     return { services_completed: 1 };
    case DOMAIN_EVENTS.QUEUE_CUSTOMER_JOINED: return { queue_joined: 1 };
    case DOMAIN_EVENTS.CUSTOMER_CREATED:      return { customers_created: 1 };
    case DOMAIN_EVENTS.CHECKOUT_COMPLETED:    return { checkouts_completed: 1 };
    case DOMAIN_EVENTS.PAYMENT_CAPTURED:      return { payments_captured: 1, payment_cents: Number(e.payload?.amountCents ?? 0), tip_cents: Number(e.payload?.tipCents ?? 0) };
    case DOMAIN_EVENTS.PAYMENT_FAILED:        return { payments_failed: 1 };
    case DOMAIN_EVENTS.REVIEW_SUBMITTED:      return { reviews_submitted: 1, rating_sum: Number(e.payload?.rating ?? 0) };
    default: return {};
  }
}

export class AnalyticsRollupConsumer implements EventConsumer {
  readonly name = 'analytics.daily_rollup';
  readonly eventTypes = [
    DOMAIN_EVENTS.APPOINTMENT_CREATED, DOMAIN_EVENTS.APPOINTMENT_CANCELED, DOMAIN_EVENTS.APPOINTMENT_NO_SHOW,
    DOMAIN_EVENTS.APPOINTMENT_COMPLETED, DOMAIN_EVENTS.SERVICE_COMPLETED, DOMAIN_EVENTS.QUEUE_CUSTOMER_JOINED,
    DOMAIN_EVENTS.CUSTOMER_CREATED, DOMAIN_EVENTS.CHECKOUT_COMPLETED, DOMAIN_EVENTS.PAYMENT_CAPTURED,
    DOMAIN_EVENTS.PAYMENT_FAILED, DOMAIN_EVENTS.REVIEW_SUBMITTED,
  ] as const;
  // §44: safe to replay ONLY because processed_events dedupes; counters are not idempotent on their own.
  readonly replay = 'REPLAY_SAFE_WITH_IDEMPOTENCY' as const;
  // §128: analytics is high-volume and low-stakes — standard retries, not the critical budget.
  readonly critical = false;

  async handle(e: DomainEvent<any>, trx: Transaction<DB>): Promise<void> {
    const counters = countersFor(e);
    if (!Object.keys(counters).length || !e.tenantId || !e.branchId) return;   // no branch = not a branch-day metric
    // §53: roll up by the day the event HAPPENED (event time), not the day it was processed — a late delivery
    // must land on the original business day, or a night-time backlog silently moves yesterday's takings.
    const day = e.occurredAt.slice(0, 10);
    const inc = sql.raw(Object.entries(counters)
      .map(([k, v]) => `'${k}', COALESCE((pos_kpi_daily_snapshots.metrics->>'${k}')::numeric, 0) + ${Number(v)}`)
      .join(', '));
    await sql`
      INSERT INTO pos_kpi_daily_snapshots (tenant_id, branch_id, business_day, module, metrics)
      VALUES (${e.tenantId}, ${e.branchId}, ${day}::date, 'events', ${JSON.stringify(counters)}::jsonb)
      ON CONFLICT ON CONSTRAINT uq_pos_kpi_snapshot DO UPDATE
        SET metrics = pos_kpi_daily_snapshots.metrics || jsonb_build_object(${inc}), updated_at = now()
    `.execute(trx);
  }
}
