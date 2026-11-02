// outbox-aggregate-order.pgtest — §38 "occurred_at order PER AGGREGATE" must hold ACROSS publish failures, ticks and
// publisher instances, not just inside one healthy batch. Found by the outbox-lanes race spec (Oct 26 2026): consumer
// 'one' saw appointment a0 as [1, 2, …, 0, …] — event #0's publish failed (infrastructure, back to pending with a 2-4 s
// backoff), its lane carried on with #1, #2 …, and #0 reached every consumer that had not finished it AFTER them.
// Each test below failed against the pre-fix publisher.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type DomainEvent, type EventConsumer } from '@aipowersalon/events';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport, type EventTransport } from './event-transport';
import { OutboxPublisher } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';

const T = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
let db: any; let inner: InProcessTransport; let seen: string[] = []; let n = 0;
const base = Date.UTC(2026, 9, 26, 9, 0, 0);
const ev = (agg: string, seq: number) => createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: T, aggregateType: 'appointment',
  aggregateId: agg, actorType: 'user', occurredAt: new Date(base + (n++) * 1000).toISOString(), payload: { appointmentId: agg, seq } });
const write = async (...es: DomainEvent<any>[]) => { const w = new OutboxWriter(); for (const e of es) await w.write(db, e); return es; };
const status = async (id: string) => ((await sql`SELECT publish_status FROM outbox_events WHERE id = ${id}`.execute(db)).rows[0] as any).publish_status;
const of = (agg: string) => seen.filter((s) => s.startsWith(`${agg}#`));
/** A transport that fails (infrastructure, e.g. the pool) for the listed event ids the first time each is published. */
const failingOnce = (ids: string[]): EventTransport => { const left = new Set(ids); return { async publish(e) { if (left.delete(e.eventId)) throw Object.assign(new Error('connection lost'), { code: 'ECONNRESET' }); return inner.publish(e); } }; };
/** A transport that parks inside publish() for one event id until released — an instance "still publishing" it. */
const parking = (id: string) => { let enter!: () => void, release!: () => void; const entered = new Promise<void>((r) => (enter = r)); const gate = new Promise<void>((r) => (release = r));
  const t: EventTransport = { async publish(e) { if (e.eventId === id) { enter(); await gate; } return inner.publish(e); } }; return { t, entered, release }; };

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','O','Order','order-agg','ORDA01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg);
  const c: EventConsumer = { name: 'order.recorder', eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE', async handle(e) { seen.push(`${e.aggregateId}#${e.payload?.seq}`); } };
  const reg = new ConsumerRegistry(); reg.register(c);
  inner = new InProcessTransport(db, reg, new ConsumerRunner(db, { rand: () => 0 }));
}, 60_000);
beforeEach(async () => { seen = []; await sql`UPDATE outbox_events SET publish_status = 'published' WHERE publish_status IN ('pending', 'claimed')`.execute(db); });

describe('outbox — per-aggregate order across failures, ticks and instances (§38)', () => {
  it('a failed publish stops its lane: the aggregate\'s later events wait for it; other aggregates carry on', async () => {
    const [x0, x1, x2, y0, y1] = await write(ev('x', 0), ev('x', 1), ev('x', 2), ev('y', 0), ev('y', 1));
    const pub = new OutboxPublisher(db, failingOnce([x0.eventId]), undefined, 2);
    const r1 = await pub.tick();
    expect(r1.failed).toBe(1);
    expect(of('x')).toEqual([]);                                   // pre-fix: ['x#1', 'x#2'] — published past the failed x#0
    expect(of('y')).toEqual(['y#0', 'y#1']);
    expect([await status(x1.eventId), await status(x2.eventId)]).toEqual(['pending', 'pending']);   // released, not stuck 'claimed'
    expect((await pub.tick()).claimed).toBe(0);                    // x#0 is backing off — x#1 is NOT claimable behind it
    await sql`UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' WHERE id = ${x0.eventId}`.execute(db);   // backoff over
    await pub.tick();
    expect(of('x')).toEqual(['x#0', 'x#1', 'x#2']);
    expect([y0, y1].length).toBe(2);
  });

  it('across ticks: an event backing off holds back every later event of its aggregate, and only of its aggregate', async () => {
    const [p0, p1, p2, q0] = await write(ev('p', 0), ev('p', 1), ev('p', 2), ev('q', 0));
    await sql`UPDATE outbox_events SET attempt_count = 1, next_attempt_at = now() + interval '1 hour' WHERE id = ${p0.eventId}`.execute(db);
    const pub = new OutboxPublisher(db, inner, undefined, 2);
    const r = await pub.tick();
    expect(r.claimed).toBe(1);                                     // q#0 only; pre-fix: 3 (p#1, p#2 jump the queue)
    expect(seen).toEqual(['q#0']);
    expect(await status(p1.eventId)).toBe('pending'); expect(await status(p2.eventId)).toBe('pending');
    await sql`UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' WHERE id = ${p0.eventId}`.execute(db);
    await pub.tick();
    expect(of('p')).toEqual(['p#0', 'p#1', 'p#2']);
    expect(q0.eventId).toBeTruthy();
  });

  it('across instances: while instance A is still publishing k, instance B does not claim k+1 of the same aggregate', async () => {
    const [m0, m1, z0] = await write(ev('m', 0), ev('m', 1), ev('z', 0));
    // A claims only m#0 first (as if m#1 was written a moment later): park A inside m#0's publish
    await sql`UPDATE outbox_events SET next_attempt_at = now() + interval '1 hour' WHERE id IN (${m1.eventId}, ${z0.eventId})`.execute(db);
    const park = parking(m0.eventId);
    const A = new OutboxPublisher(db, park.t, undefined, 2);
    const aTick = A.tick();
    await park.entered;                                            // A holds m#0 'claimed', in flight
    await sql`UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' WHERE id IN (${m1.eventId}, ${z0.eventId})`.execute(db);
    const B = new OutboxPublisher(db, inner, undefined, 2);
    const rb = await B.tick();
    expect(rb.claimed).toBe(1);                                    // z#0 only; pre-fix: 2 — B published m#1 while A held m#0
    expect(of('m')).toEqual([]);
    park.release(); await aTick;
    await B.tick();
    expect(of('m')).toEqual(['m#0', 'm#1']);
  });

  it('a dead (failed, attempts exhausted) event no longer holds its aggregate back', async () => {
    const [d0, d1] = await write(ev('d', 0), ev('d', 1));
    await sql`UPDATE outbox_events SET publish_status = 'failed' WHERE id = ${d0.eventId}`.execute(db);
    const pub = new OutboxPublisher(db, inner, undefined, 2);
    await pub.tick();
    expect(of('d')).toEqual(['d#1']);
    expect(await status(d1.eventId)).toBe('published');
  });
});
