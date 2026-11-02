// outbox-lanes.postgres-race.vitest.spec.ts — M4 (Oct 24 2026, NEXT_STEPS M5-1) on REAL PostgreSQL with a connection
// pool: the publisher's lanes (aggregates in parallel) and each event's consumers two at a time, with a consumer that
// always fails. PGlite cannot prove this (one session: two open transactions share it). What it pins:
//   • every event published once; every healthy consumer processed every event exactly once (processed_events)
//   • a failing consumer's rollback never takes a healthy consumer's work with it (its own transaction, its own connection)
//   • per aggregate, every consumer saw the events in occurred_at order
//   • (Oct 26 2026) the same with TWO publisher instances draining at once and one infrastructure failure mid-aggregate:
//     every event reaches the transport exactly once (+1 for the failed attempt) and per-aggregate order still holds
// Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, ConsumerError, type EventConsumer } from '@aipowersalon/events';
import { ConsumerRegistry, InProcessTransport, TRANSPORT, type EventTransport } from './event-transport';
import { OutboxPublisher, PUBLISHER } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';

const url = process.env.PG_RACE_URL;
const T = 'a7000000-0000-4000-8000-0000000000a7';
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('outbox lanes on a real pool (M4)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 8 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Lanes Salon', 'Lanes Salon', 'lanes-salon-race', 'LANESR', 'active') on conflict (id) do nothing`.execute(db);
    // only this test's rows are due: everything else already in the outbox is set aside (a scratch race database)
    await sql`update outbox_events set publish_status = 'published', published_at = now() where publish_status in ('pending', 'claimed')`.execute(db);
  });
  afterAll(async () => { await db?.destroy(); });

  it('300 events over 30 appointments: each healthy consumer once per event, in order per appointment; the broken one dead-letters without undoing anyone', async () => {
    const tag = Date.now().toString(36);
    const seen: Record<string, string[]> = {};
    const mk = (name: string): EventConsumer => ({ name: `${name}.${tag}`, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
      async handle(e, trx: any) {
        await sql`select pg_sleep(${(Number(e.payload?.seq) % 3) / 1000})`.execute(trx);   // a little real work inside the transaction
        (seen[`${name}|${e.aggregateId}`] ||= []).push(String(e.payload?.seq));
      } });
    const broken: EventConsumer = { name: `broken.${tag}`, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
      async handle(_e, trx: any) { await sql`select 1`.execute(trx); throw new ConsumerError('PERMANENT', 'always'); } };
    const reg = new ConsumerRegistry(); for (const c of [mk('one'), broken, mk('two'), mk('three')]) reg.register(c);
    const w = new OutboxWriter(); const base = Date.now() - 60_000;
    const evs = [];
    for (let seq = 0; seq < 10; seq++) for (let a = 0; a < 30; a++) evs.push(createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: T, aggregateType: 'appointment',
      aggregateId: `${tag}-a${a}`, actorType: 'user', occurredAt: new Date(base + (seq * 30 + a) * 10).toISOString(), payload: { appointmentId: `${tag}-a${a}`, seq } }));
    await w.writeAll(db as any, evs);
    const pub = new OutboxPublisher(db as any, new InProcessTransport(db as any, reg, new ConsumerRunner(db as any, { rand: () => 0 }), TRANSPORT.consumerConcurrency), undefined, PUBLISHER.lanes);
    let total = 0; for (let i = 0; i < 10; i++) { const r = await pub.drain(); total += r.published; if (!r.batches) break; }
    expect(total).toBe(300);
    const ids = evs.map((e) => e.eventId);
    const processed = (await sql<{ consumer_name: string; n: number }>`select consumer_name, count(*)::int n from processed_events where event_id = any(${ids}::uuid[]) group by 1`.execute(db)).rows;
    const by = Object.fromEntries(processed.map((r) => [r.consumer_name, r.n]));
    for (const n of ['one', 'two', 'three']) expect(by[`${n}.${tag}`], n).toBe(300);
    expect(by[`broken.${tag}`]).toBeUndefined();
    const dead = (await sql<{ n: number }>`select count(*)::int n from event_dead_letters where consumer_name = ${`broken.${tag}`} and event_id = any(${ids}::uuid[])`.execute(db)).rows[0].n;
    expect(dead).toBe(300);
    for (const n of ['one', 'two', 'three']) for (let a = 0; a < 30; a++) expect(seen[`${n}|${tag}-a${a}`], `${n} a${a}`).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  }, 120_000);
  it('two publishers at once + an infrastructure failure on a0#0: each event published once, every aggregate in order', async () => {
    const tag = `x${Date.now().toString(36)}`;
    const seen: Record<string, string[]> = {};
    const mk = (name: string): EventConsumer => ({ name: `${name}.${tag}`, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
      async handle(e, trx: any) {
        await sql`select pg_sleep(${(Number(e.payload?.seq) % 3) / 1000})`.execute(trx);
        (seen[`${name}|${e.aggregateId}`] ||= []).push(String(e.payload?.seq));
      } });
    const reg = new ConsumerRegistry(); for (const c of [mk('one'), mk('two')]) reg.register(c);
    const w = new OutboxWriter(); const base = Date.now() - 60_000;
    const evs = [];
    for (let seq = 0; seq < 10; seq++) for (let a = 0; a < 30; a++) evs.push(createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: T, aggregateType: 'appointment',
      aggregateId: `${tag}-a${a}`, actorType: 'user', occurredAt: new Date(base + (seq * 30 + a) * 10).toISOString(), payload: { appointmentId: `${tag}-a${a}`, seq } }));
    await w.writeAll(db as any, evs);
    const inner = new InProcessTransport(db as any, reg, new ConsumerRunner(db as any, { rand: () => 0 }), TRANSPORT.consumerConcurrency);
    const calls: Record<string, number> = {}; let failNext = evs[0].eventId;   // a0#0: the first event of the run, as in the observed flake
    const counting: EventTransport = { async publish(e) {
      calls[e.eventId] = (calls[e.eventId] ?? 0) + 1;
      if (e.eventId === failNext) { failNext = ''; throw Object.assign(new Error('connection terminated'), { code: 'ECONNRESET' }); }
      return inner.publish(e);
    } };
    const pubs = [new OutboxPublisher(db as any, counting, undefined, PUBLISHER.lanes), new OutboxPublisher(db as any, counting, undefined, PUBLISHER.lanes)];
    const ids = evs.map((e) => e.eventId);
    const left = async () => (await sql<{ n: number }>`select count(*)::int n from outbox_events where id = any(${ids}::uuid[]) and publish_status <> 'published'`.execute(db)).rows[0].n;
    const deadline = Date.now() + 60_000;
    while ((await left()) > 0 && Date.now() < deadline) {
      await Promise.all(pubs.map((p) => p.drain()));
      await sql`update outbox_events set next_attempt_at = now() where id = ${evs[0].eventId} and publish_status = 'pending'`.execute(db);   // skip the 2-4 s backoff
    }
    expect(await left()).toBe(0);
    const over = Object.entries(calls).filter(([id, n]) => n !== (id === evs[0].eventId ? 2 : 1));
    expect(over, 'events handed to the transport more than once (double claim)').toEqual([]);
    for (const n of ['one', 'two']) for (let a = 0; a < 30; a++) expect(seen[`${n}|${tag}-a${a}`], `${n} a${a}`).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  }, 120_000);
});
