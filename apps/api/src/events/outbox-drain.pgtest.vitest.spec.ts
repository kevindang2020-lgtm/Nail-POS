// outbox-drain.pgtest — found by the 200-technician M5 pilot (Oct 24 2026): a 3,500-booking burst left the realtime
// projection 2+ minutes behind, partly because the publisher claimed ONE batch per 1-second tick and idled in between.
// drain() claims the next batch at once while batches come back full, bounded by maxBatchesPerDrain; order within a
// tenant is unchanged; a concurrent firing does nothing (the tick guard).
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type EventConsumer } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport, TRANSPORT } from './event-transport';
import { OutboxPublisher, PUBLISHER } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';

const T = '33333333-3333-3333-3333-333333333333';
let db: any; let publisher: OutboxPublisher;
const seen: number[] = [];
const write = async (from: number, n: number) => {
  const w = new OutboxWriter(); const base = Date.UTC(2026, 9, 24, 9, 0, 0);
  for (let i = from; i < from + n; i++) await w.write(db, createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: T, aggregateType: 'appointment', aggregateId: `a-${i}`,
    actorType: 'worker', occurredAt: new Date(base + i * 1000).toISOString(), payload: { appointmentId: `a-${i}` } }));
};
const pending = async () => ((await sql`SELECT count(*)::int AS n FROM outbox_events WHERE publish_status <> 'published'`.execute(db)).rows[0] as any).n;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','D','Drain','drain','DRAI01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg);
  const consumer: EventConsumer = { name: 'drain.recorder', eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], replay: 'REPLAY_SAFE', async handle(e) { seen.push(Number(String(e.aggregateId).split('-')[1])); } };
  const registry = new ConsumerRegistry(); registry.register(consumer);
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db, { rand: () => 0 })));
}, 60_000);

describe('outbox drain — a backlog is published batch after batch, not one batch a second', () => {
  it('a 250-event backlog drains in ONE firing (3 batches: 100 + 100 + 50), each event once', async () => {
    await write(0, 250);
    const r = await publisher.drain();
    expect(r).toEqual({ batches: 3, published: 250 });
    expect(await pending()).toBe(0);
    expect(new Set(seen).size).toBe(250);
    expect(seen).toHaveLength(250);
    // batches stay in order: everything of batch 1 (#0-#99) is out before anything of batch 2 (lanes work inside a batch)
    expect(Math.max(...seen.slice(0, 100))).toBe(99);
  });
  it('the drain is bounded: at most maxBatchesPerDrain batches per firing, the rest on the next firing', async () => {
    const n = PUBLISHER.batch * (PUBLISHER.maxBatchesPerDrain + 1);
    await write(1000, n);
    const r1 = await publisher.drain();
    expect(r1.batches).toBe(PUBLISHER.maxBatchesPerDrain);
    expect(await pending()).toBe(PUBLISHER.batch);
    const r2 = await publisher.drain();
    expect(r2).toEqual({ batches: 1, published: PUBLISHER.batch });
    expect(await pending()).toBe(0);
  }, 120_000);
  it('nothing due → no batch; a firing while a pass runs does nothing (the tick guard)', async () => {
    expect(await publisher.drain()).toEqual({ batches: 0, published: 0 });
    await write(5000, 5);
    const [a, b] = await Promise.all([publisher.drain(), publisher.drain()]);
    expect(a.published + b.published).toBe(5);
    expect(await pending()).toBe(0);
  });
});

// M4 (Oct 24 2026, NEXT_STEPS M5-1): lanes inside a batch + concurrent consumers per event. Per AGGREGATE the order is
// the publisher's (occurred_at); different aggregates overlap; at most lanes × consumerConcurrency runs at once.
describe('outbox lanes — aggregates in parallel, each aggregate in order', () => {
  const A = '44444444-4444-4444-8444-444444444444';
  let pdb: any; const log: { agg: string; seq: number; consumer: string }[] = []; let live = 0, peak = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const mk = (name: string): EventConsumer => ({ name, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
    async handle(e) { live++; peak = Math.max(peak, live); await sleep((Number(e.payload?.seq) * 7 + name.length) % 5); log.push({ agg: e.aggregateId, seq: Number(e.payload?.seq), consumer: name }); live--; } });
  beforeAll(async () => {
    const pg = await migratedPglite();
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${A}','L','Lanes','lanes','LANE01','active') ON CONFLICT (id) DO NOTHING;`);
    pdb = kyselyFor(pg);
    const w = new OutboxWriter(); const base = Date.UTC(2026, 9, 24, 10, 0, 0);
    // 12 appointments, 8 updates each, interleaved in time: a1#0, a2#0, …, a12#0, a1#1, …
    for (let seq = 0; seq < 8; seq++) for (let a = 1; a <= 12; a++) await w.write(pdb, createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: A,
      aggregateType: 'appointment', aggregateId: `a${a}`, actorType: 'user', occurredAt: new Date(base + (seq * 12 + a) * 1000).toISOString(), payload: { appointmentId: `a${a}`, seq } }));
  }, 60_000);
  it('every consumer sees each appointment\'s updates in order; work overlaps, bounded by lanes × consumers', async () => {
    const reg = new ConsumerRegistry(); for (const n of ['c.one', 'c.two', 'c.three']) reg.register(mk(n));
    const pub = new OutboxPublisher(pdb, new InProcessTransport(pdb, reg, new ConsumerRunner(pdb, { rand: () => 0 }), TRANSPORT.consumerConcurrency), undefined, PUBLISHER.lanes);   // the production wiring
    const r = await pub.drain();
    expect(r.published).toBe(96);
    expect(log).toHaveLength(96 * 3);
    for (const c of ['c.one', 'c.two', 'c.three']) for (let a = 1; a <= 12; a++) {
      const seqs = log.filter((x) => x.consumer === c && x.agg === `a${a}`).map((x) => x.seq);
      expect(seqs, `${c} a${a}`).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(PUBLISHER.lanes * TRANSPORT.consumerConcurrency);
  }, 60_000);   // 96 events × 3 consumers on PGlite: well under a second alone, more on a loaded CI host
  it('lanes = 1 and one consumer at a time is the old strict order: the whole tenant in occurred_at order', async () => {
    const W = new OutboxWriter(); const base = Date.UTC(2026, 9, 24, 12, 0, 0); const seen2: number[] = [];
    for (let i = 0; i < 30; i++) await W.write(pdb, createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_CANCELED, tenantId: A, aggregateType: 'appointment', aggregateId: `s${i}`,
      actorType: 'user', occurredAt: new Date(base + i * 1000).toISOString(), payload: { appointmentId: `s${i}` } }));
    const reg = new ConsumerRegistry();
    reg.register({ name: 'strict', eventTypes: [DOMAIN_EVENTS.APPOINTMENT_CANCELED], replay: 'REPLAY_SAFE', async handle(e) { await sleep(Number(String(e.aggregateId).slice(1)) % 3); seen2.push(Number(String(e.aggregateId).slice(1))); } });
    await new OutboxPublisher(pdb, new InProcessTransport(pdb, reg, new ConsumerRunner(pdb, { rand: () => 0 }), 1), undefined, 1).drain();
    expect(seen2).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });
});

describe('InProcessTransport — one event\'s consumers run concurrently, still isolated (§30)', () => {
  const ev = createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: T, aggregateType: 'appointment', aggregateId: 'x-1', actorType: 'user', payload: { appointmentId: 'x-1' } });
  it('a failing consumer is dead-lettered while the others are processed; at most consumerConcurrency at once', async () => {
    let live = 0, peak = 0; const done: string[] = [];
    const slow = (name: string, fail = false): EventConsumer => ({ name, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], replay: 'REPLAY_SAFE',
      async handle() { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 10)); live--; if (fail) throw new Error('boom'); done.push(name); } });
    const reg = new ConsumerRegistry(); for (const c of [slow('t.a'), slow('t.b', true), slow('t.c'), slow('t.d'), slow('t.e')]) reg.register(c);
    const res = await new InProcessTransport(db, reg, new ConsumerRunner(db, { rand: () => 0 }), TRANSPORT.consumerConcurrency).publish(ev);
    expect(res.delivered).toBe(5);
    expect(res.outcomes['t.b'].status).toMatch(/dead_lettered|retry_scheduled/);
    expect(done.sort()).toEqual(['t.a', 't.c', 't.d', 't.e']);
    expect(peak).toBe(TRANSPORT.consumerConcurrency);
  });
  it('a runner that throws (database down) lets the others finish, then fails the publish (the event goes back to pending)', async () => {
    const ran: string[] = [];
    const reg = new ConsumerRegistry();
    for (const n of ['u.a', 'u.b', 'u.c']) reg.register({ name: n, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], replay: 'REPLAY_SAFE', async handle() { ran.push(n); } });
    const runner = new ConsumerRunner(db, { rand: () => 0 });
    const real = runner.run.bind(runner);
    (runner as any).run = async (c: EventConsumer, e: any) => { if (c.name === 'u.a') throw new Error('db down'); return real(c, e); };
    await expect(new InProcessTransport(db, reg, runner, TRANSPORT.consumerConcurrency).publish({ ...ev, eventId: '6b1f4c1e-5d2a-4a59-9a43-1f1f1f1f1f1f' })).rejects.toThrow('db down');
    expect(ran.sort()).toEqual(['u.b', 'u.c']);
  });
});

describe('the production wiring', () => {
  it('events.module builds the transport and the publisher with the M4 concurrency (2 consumers × 2 lanes) on the pipeline pool, under the shared budget; the class defaults stay serial', async () => {
    // the pool choice and the budget themselves are pinned by events-pipeline-pool.vitest (the @Module metadata)
    const src = (await import('node:fs')).readFileSync(new URL('./events.module.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/new InProcessTransport\(p\.db, reg, runner, TRANSPORT\.consumerConcurrency, budget, \{ first: \[REALTIME_PROJECTION_CONSUMER\] \}\)/);   // §90: the realtime-first lane
    expect(src).toMatch(/new OutboxPublisher\(p\.db, t, undefined, PUBLISHER\.lanes\)/);
    expect(TRANSPORT.consumerConcurrency).toBe(2);
    expect(PUBLISHER.lanes).toBe(2);
  });
});
