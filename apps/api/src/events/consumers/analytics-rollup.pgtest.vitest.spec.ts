// analytics-rollup.pgtest — the rollup on real Postgres, reusing pos_kpi_daily_snapshots (§211: no new store).
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { AnalyticsRollupConsumer, countersFor } from './analytics-rollup.consumer';

const T = '11111111-1111-1111-1111-111111111111';
const B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
let db: any; let publisher: OutboxPublisher; let runner: ConsumerRunner; let consumer: AnalyticsRollupConsumer;
const metrics = async (day = '2026-09-19') => {
  const r: any = (await sql`SELECT metrics FROM pos_kpi_daily_snapshots WHERE tenant_id = ${T} AND branch_id = ${B} AND module = 'events' AND business_day = ${day}::date`.execute(db)).rows[0];
  if (!r) return null;
  return typeof r.metrics === 'string' ? JSON.parse(r.metrics) : r.metrics;
};

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','G','Glamour','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;
                 INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg); consumer = new AnalyticsRollupConsumer();
  const registry = new ConsumerRegistry(); registry.register(consumer);
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
}, 60_000);

const evt = (type: any, payload: any = {}, occurredAt = '2026-09-19T14:00:00.000Z') => createDomainEvent({
  eventType: type, tenantId: T, branchId: B, aggregateType: 'x', aggregateId: `x-${Math.random()}`, actorType: 'user', occurredAt, payload,
});

describe('analytics.daily_rollup — increments, never replaces', () => {
  it('maps events to counters; money is summed in integer cents', () => {
    expect(countersFor(evt(DOMAIN_EVENTS.PAYMENT_CAPTURED, { amountCents: 4500, tipCents: 500 }))).toEqual({ payments_captured: 1, payment_cents: 4500, tip_cents: 500 });
    expect(countersFor(evt(DOMAIN_EVENTS.APPOINTMENT_CREATED))).toEqual({ appointments_created: 1 });
    expect(countersFor(evt(DOMAIN_EVENTS.SMS_SENT))).toEqual({});                    // not an analytics fact
  });

  it('two payments and an appointment ADD UP in one day-row — the second event does not overwrite the first', async () => {
    const w = new OutboxWriter();
    await w.write(db, evt(DOMAIN_EVENTS.PAYMENT_CAPTURED, { amountCents: 4500, tipCents: 500 }));
    await w.write(db, evt(DOMAIN_EVENTS.PAYMENT_CAPTURED, { amountCents: 2500, tipCents: 0 }));
    await w.write(db, evt(DOMAIN_EVENTS.APPOINTMENT_CREATED));
    while ((await publisher.tick()).claimed > 0) { /* drain */ }
    expect(await metrics()).toMatchObject({ payments_captured: 2, payment_cents: 7000, tip_cents: 500, appointments_created: 1 });
    const rows: any = (await sql`SELECT count(*)::int AS n FROM pos_kpi_daily_snapshots WHERE module = 'events'`.execute(db)).rows[0];
    expect(rows.n).toBe(1);                                                          // one row per tenant/branch/day
  });

  it('§53 a LATE event lands on the day it HAPPENED, not the day it was processed', async () => {
    await new OutboxWriter().write(db, evt(DOMAIN_EVENTS.APPOINTMENT_COMPLETED, {}, '2026-09-17T23:30:00.000Z'));
    while ((await publisher.tick()).claimed > 0) { /* drain */ }
    expect(await metrics('2026-09-17')).toMatchObject({ appointments_completed: 1 });
    expect((await metrics())?.appointments_completed).toBeUndefined();               // yesterday's takings did not move
  });

  it('§23 redelivery does not double-count — processed_events is the guard, in the same transaction', async () => {
    const e = evt(DOMAIN_EVENTS.CHECKOUT_COMPLETED);
    await new OutboxWriter().write(db, e);
    while ((await publisher.tick()).claimed > 0) { /* drain */ }
    expect((await metrics()).checkouts_completed).toBe(1);
    expect((await runner.run(consumer, e)).status).toBe('duplicate');
    expect((await metrics()).checkouts_completed).toBe(1);
  });

  it('an event with no branch is skipped rather than rolled into a wrong bucket', async () => {
    const before = await metrics();
    const e = { ...evt(DOMAIN_EVENTS.CUSTOMER_CREATED), branchId: undefined };
    expect((await runner.run(consumer, e as any)).status).toBe('processed');
    expect(await metrics()).toEqual(before);
  });
});
