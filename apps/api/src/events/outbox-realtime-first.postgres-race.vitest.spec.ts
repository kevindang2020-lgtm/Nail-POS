// outbox-realtime-first.postgres-race — 200-technician mandate §90 (Oct 26 2026) on REAL PostgreSQL with a pool: the
// realtime-first lane runs AHEAD of the slow consumers. 1,000 bookings (one event per appointment, as a booking burst is)
// with a slow consumer (a little real work in its transaction) and the realtime-first consumer, drained by TWO publisher
// instances at once in the timer's mode (drain without waiting for the follow passes):
//   • every event projected exactly once and processed exactly once by every other consumer (processed_events)
//   • the realtime lane finished every frame while the slow consumers had done less than half of the burst
//   • per aggregate order for every consumer (an appointment with several updates keeps its order)
// Opt-in: PG_RACE_URL=postgres://… (a database migrated through 693).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type EventConsumer, type DomainEvent } from '@aipowersalon/events';
import { ConsumerRegistry, InProcessTransport, ConsumerBudget, consumerBudgetFor, TRANSPORT } from './event-transport';
import { OutboxPublisher, PUBLISHER } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';

const url = process.env.PG_RACE_URL;
const T = 'a7000000-0000-4000-8000-0000000000b9';
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('§90 realtime-first lane on a real pool', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'RT First Salon', 'RT First Salon', 'rt-first-race', 'RTFRST', 'active') on conflict (id) do nothing`.execute(db);
    await sql`update outbox_events set publish_status = 'published', published_at = now() where publish_status in ('pending', 'claimed')`.execute(db);
  });
  afterAll(async () => { await db?.destroy(); });

  it('1,000 bookings + 50 multi-update appointments, two publishers: frames run ahead of the slow consumers; once each; in order', async () => {
    const tag = Date.now().toString(36);
    const rtAt = new Map<string, number>(); const slowDone: number[] = []; const seen: Record<string, number[]> = {};
    const rt: EventConsumer = { name: `rt.${tag}`, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
      async handle(e) { rtAt.set(e.eventId, Date.now()); (seen[`rt|${e.aggregateId}`] ||= []).push(Number(e.payload?.seq)); } };
    const mkSlow = (name: string): EventConsumer => ({ name: `${name}.${tag}`, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
      async handle(e, trx: any) { await sql`select pg_sleep(0.002)`.execute(trx); (seen[`${name}|${e.aggregateId}`] ||= []).push(Number(e.payload?.seq)); if (name === 'slow') slowDone.push(Date.now()); } });
    const reg = new ConsumerRegistry(); for (const c of [rt, mkSlow('slow'), mkSlow('other')]) reg.register(c);
    const w = new OutboxWriter(); const base = Date.now() - 60_000; const evs: DomainEvent<any>[] = [];
    for (let i = 0; i < 1000; i++) evs.push(createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: T, aggregateType: 'appointment', aggregateId: `${tag}-b${i}`,
      actorType: 'user', occurredAt: new Date(base + i).toISOString(), payload: { appointmentId: `${tag}-b${i}`, seq: 0 } }));
    for (let seq = 0; seq < 4; seq++) for (let a = 0; a < 50; a++) evs.push(createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: T, aggregateType: 'appointment',
      aggregateId: `${tag}-m${a}`, actorType: 'user', occurredAt: new Date(base + 1000 + seq * 50 + a).toISOString(), payload: { appointmentId: `${tag}-m${a}`, seq } }));
    await w.writeAll(db as any, evs);
    const runner = new ConsumerRunner(db as any, { rand: () => 0 });
    const budget = new ConsumerBudget(consumerBudgetFor(8, PUBLISHER.lanes, TRANSPORT.consumerConcurrency));
    const mk = () => new OutboxPublisher(db as any, new InProcessTransport(db as any, reg, runner, TRANSPORT.consumerConcurrency, budget, { first: [rt.name] }), undefined, PUBLISHER.lanes);
    const pubs = [mk(), mk()];
    const open = async () => (await sql<{ n: number }>`select count(*)::int n from outbox_events where tenant_id = ${T} and publish_status in ('pending', 'claimed')`.execute(db)).rows[0].n;
    const t0 = Date.now();
    await Promise.all(pubs.map(async (p) => { for (let i = 0; i < 200; i++) { const r = await p.drain({ wait: false }); if (!r.batches) { await p.settle(); if (!(await open())) break; await new Promise((res) => setTimeout(res, 20)); } } await p.settle(); }));
    expect(await open()).toBe(0);
    const ids = evs.map((e) => e.eventId);
    const by = Object.fromEntries((await sql<{ consumer_name: string; n: number }>`select consumer_name, count(*)::int n from processed_events where event_id = any(${ids}::uuid[]) group by 1`.execute(db)).rows.map((r) => [r.consumer_name, r.n]));
    for (const c of ['rt', 'slow', 'other']) expect(by[`${c}.${tag}`], c).toBe(1200);
    expect(rtAt.size).toBe(1200);
    for (const c of ['rt', 'slow', 'other']) {
      expect(Object.entries(seen).filter(([k]) => k.startsWith(`${c}|`)).reduce((s, [, v]) => s + v.length, 0), `${c} deliveries`).toBe(1200);   // nobody twice
      for (let a = 0; a < 50; a++) expect(seen[`${c}|${tag}-m${a}`], `${c} m${a}`).toEqual([0, 1, 2, 3]);
    }
    // the lead: the realtime lane had projected all 1,000 bookings before the slow consumer had finished half of them
    const bookings = evs.slice(0, 1000).map((e) => rtAt.get(e.eventId)!);
    const rtDone = Math.max(...bookings) - t0;
    slowDone.sort((a, b) => a - b);
    const slowHalf = slowDone[599] - t0;
    expect(rtDone, `realtime done ${rtDone} ms, slow half ${slowHalf} ms`).toBeLessThan(slowHalf);
  }, 180_000);
});
