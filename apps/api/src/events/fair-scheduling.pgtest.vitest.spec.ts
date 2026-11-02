// fair-scheduling.pgtest — §129, using the constitution's own scenario: one tenant floods the outbox, and
// another tenant's event must NOT wait behind all of it.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type EventConsumer } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from './event-transport';
import { OutboxPublisher, PUBLISHER } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';

const NOISY = '11111111-1111-1111-1111-111111111111';   // "tenant A generates 100k analytics events"
const QUIET = '22222222-2222-2222-2222-222222222222';   // "tenant B's critical event should not wait"
let db: any; let publisher: OutboxPublisher;
const order: { tenant: string; id: string }[] = [];

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                 VALUES ('${NOISY}','A','Noisy','noisy','NOIS01','active'), ('${QUIET}','B','Quiet','quiet','QUIE01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg);
  const consumer: EventConsumer = { name: 'order.recorder', eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED],
    replay: 'REPLAY_SAFE', async handle(e) { order.push({ tenant: e.tenantId!, id: e.aggregateId }); } };
  const registry = new ConsumerRegistry(); registry.register(consumer);
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db, { rand: () => 0 })), undefined, 1);   // one lane: §38 tenant order is pinned here; lanes are pinned in outbox-drain

  const w = new OutboxWriter();
  const base = Date.UTC(2026, 8, 19, 9, 0, 0);
  // The flood lands FIRST — under plain FIFO every one of these would be published before the quiet tenant's event.
  for (let i = 0; i < 200; i++) {
    await w.write(db, createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: NOISY, aggregateType: 'appointment', aggregateId: `noisy-${i}`,
      actorType: 'worker', occurredAt: new Date(base + i * 1000).toISOString(), payload: { appointmentId: `noisy-${i}` } }));
  }
  // …and the quiet tenant's single event arrives LAST in wall-clock terms.
  await w.write(db, createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: QUIET, aggregateType: 'appointment', aggregateId: 'quiet-1',
    actorType: 'user', occurredAt: new Date(base + 999_000).toISOString(), payload: { appointmentId: 'quiet-1' } }));
}, 60_000);

describe('§129 — a flooding tenant must not starve a quiet one', () => {
  it("the quiet tenant's event is published in the FIRST batch, not after 200 noisy ones", async () => {
    const r = await publisher.tick();
    expect(r.published).toBe(PUBLISHER.batch);                         // a full batch — fairness must not cost throughput
    const quietPos = order.findIndex((o) => o.tenant === QUIET);
    expect(quietPos).toBeGreaterThanOrEqual(0);                        // it went out in batch ONE
    // Under plain FIFO it would have been number 201. Round-robin puts it FIRST: rank 1 of its own tenant.
    expect(quietPos).toBeLessThanOrEqual(1);
  });

  it('a single tenant with the outbox to itself still gets FULL batches — fairness costs no throughput', async () => {
    // The quiet tenant is already drained, so only the noisy one is due: the ranking degrades to plain FIFO.
    const before = order.length;
    const r = await publisher.tick();
    expect(r.published).toBe(PUBLISHER.batch);
    expect(order.length - before).toBe(PUBLISHER.batch);
  });

  it('§38 fairness between tenants never reorders events WITHIN a tenant (the single-lane publisher keeps tenant order)', async () => {
    while ((await publisher.tick()).claimed > 0) { /* drain the rest */ }
    const noisySeq = order.filter((o) => o.tenant === NOISY).map((o) => Number(o.id.split('-')[1]));
    expect(noisySeq).toEqual([...noisySeq].sort((a, b) => a - b));     // still occurred_at order inside the tenant
    expect(noisySeq.length).toBe(200);
    const pending: any = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE publish_status <> 'published'`.execute(db)).rows[0];
    expect(pending.n).toBe(0);                                          // everything drains; nobody is starved forever
  });
});
