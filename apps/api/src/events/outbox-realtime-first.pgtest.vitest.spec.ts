// outbox-realtime-first.pgtest — 200-technician mandate §90 (Oct 26 2026): the REALTIME-FIRST lane. Under a 3,500-booking
// burst the realtime projection's frames waited behind every earlier batch's slow consumers (push, analytics rollup,
// in-app notifications, live ops): SSE lag p95 13 s on the 2-core host. Now the publisher projects each claimed batch
// right after the claim (InProcessTransport `first` → ConsumerRunner.runBatch: one processed_events read + one write per
// batch) and the batch's other consumers follow, batch after batch. What this pins (PGlite, one session):
//   • every event reaches the first-lane consumer exactly once and every other consumer exactly once
//   • per aggregate, EVERY consumer (first lane included) sees the events in occurred_at order
//   • a batch's frames all go out before any other consumer of that batch runs
//   • a redelivery never re-runs the first-lane consumer (processed_events); its failures are recorded like run()'s
//   • the lane failing as a whole is not fatal: the follow pass runs the realtime consumer the ordinary way
//   • an infrastructure failure mid-aggregate still releases the rest of the lane (044a1878) — order kept for all consumers
//   • drain({ wait: false }) leaves the follow passes queued; settle() waits for them
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, ConsumerError, type EventConsumer, type DomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport, type EventTransport } from './event-transport';
import { OutboxPublisher, PUBLISHER } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';

const T = '44444444-4444-4444-8444-4444444444e1';
let db: any;
let clock = 0;
const log: { who: string; agg: string; seq: number; at: number }[] = [];
const rec = (who: string) => (e: DomainEvent<any>) => { log.push({ who, agg: String(e.aggregateId), seq: Number(e.payload?.seq), at: clock++ }); };
const names = (tag: string) => ({ rt: `rt.${tag}`, slow: `slow.${tag}`, other: `other.${tag}` });
function setup(tag: string, opts: { failRt?: (e: DomainEvent<any>) => boolean } = {}) {
  const n = names(tag);
  const rt: EventConsumer = { name: n.rt, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
    async handle(e) { if (opts.failRt?.(e)) throw new ConsumerError('PERMANENT', 'rt_broken'); rec('rt')(e); } };
  const slow: EventConsumer = { name: n.slow, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
    async handle(e, trx: any) { await sql`select 1`.execute(trx); rec('slow')(e); } };
  const other: EventConsumer = { name: n.other, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_UPDATED], replay: 'REPLAY_SAFE',
    async handle(e, trx: any) { await sql`select 1`.execute(trx); rec('other')(e); } };
  const reg = new ConsumerRegistry(); for (const c of [rt, slow, other]) reg.register(c);
  const transport = new InProcessTransport(db, reg, new ConsumerRunner(db, { rand: () => 0 }), 1, null, { first: [n.rt] });
  return { n, transport };
}
async function write(tag: string, aggregates: number, perAggregate: number): Promise<DomainEvent<any>[]> {
  const w = new OutboxWriter(); const base = Date.UTC(2026, 9, 26, 9, 0, 0);
  const evs: DomainEvent<any>[] = [];
  for (let seq = 0; seq < perAggregate; seq++) for (let a = 0; a < aggregates; a++) evs.push(createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: T,
    aggregateType: 'appointment', aggregateId: `${tag}-a${a}`, actorType: 'user', occurredAt: new Date(base + (seq * aggregates + a) * 1000).toISOString(), payload: { appointmentId: `${tag}-a${a}`, seq } }));
  await w.writeAll(db, evs);
  return evs;
}
const seqs = (who: string, agg: string) => log.filter((l) => l.who === who && l.agg === agg).map((l) => l.seq);
const processed = async (consumer: string) => ((await sql`SELECT count(*)::int AS n FROM processed_events WHERE consumer_name = ${consumer}`.execute(db)).rows[0] as any).n;
const open = async () => ((await sql`SELECT count(*)::int AS n FROM outbox_events WHERE publish_status IN ('pending', 'claimed')`.execute(db)).rows[0] as any).n;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','R','Realtime First','realtime-first','RTFS01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg);
}, 60_000);
beforeEach(async () => { log.length = 0; await sql`UPDATE outbox_events SET publish_status = 'published', published_at = now() WHERE publish_status IN ('pending', 'claimed')`.execute(db); });

describe('§90 realtime-first lane', () => {
  it('600 events over 60 appointments: each consumer once per event, per-aggregate order for every consumer, a batch is projected before its slow consumers run', async () => {
    const tag = 'one'; const { n, transport } = setup(tag);
    const evs = await write(tag, 60, 10);
    const pub = new OutboxPublisher(db, transport, undefined, 2);
    // the timer's mode: drain without waiting; when nothing more can be claimed (an aggregate's later events wait for its
    // earlier ones — the head-of-line claim), let the follow passes finish, then go again
    let batches = 0;
    for (let i = 0; i < 40; i++) { const r = await pub.drain({ wait: false }); batches += r.batches; if (!r.batches) { await pub.settle(); if (!(await open())) break; } }
    expect(batches).toBeGreaterThanOrEqual(Math.ceil(600 / PUBLISHER.leadBatch));
    expect(await open()).toBe(0);
    for (const who of ['rt', 'slow', 'other']) expect(log.filter((l) => l.who === who), who).toHaveLength(600);
    for (const c of [n.rt, n.slow, n.other]) expect(await processed(c), c).toBe(600);
    for (const who of ['rt', 'slow', 'other']) for (let a = 0; a < 60; a++) expect(seqs(who, `${tag}-a${a}`), `${who} a${a}`).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // the first claimed batch (the first leadBatch events in claim order) was fully projected before ANY slow consumer ran
    const firstBatch = new Set(evs.slice(0, PUBLISHER.leadBatch).map((e) => `${e.aggregateId}#${e.payload.seq}`));
    const rtFirst = log.filter((l) => l.who === 'rt' && firstBatch.has(`${l.agg}#${l.seq}`));
    const slowStart = Math.min(...log.filter((l) => l.who !== 'rt').map((l) => l.at));
    expect(rtFirst).toHaveLength(PUBLISHER.leadBatch);
    expect(Math.max(...rtFirst.map((l) => l.at))).toBeLessThan(slowStart);
    // and every event was projected before its own slow consumers ran
    for (const e of evs) {
      const at = (who: string) => log.find((l) => l.who === who && l.agg === e.aggregateId && l.seq === e.payload.seq)!.at;
      expect(at('rt')).toBeLessThan(at('slow'));
    }
  }, 120_000);

  it('runBatch: a redelivered batch is not projected again; a handler failure is recorded (dead letter) and counts as done', async () => {
    const tag = 'two'; const { n, transport } = setup(tag, { failRt: (e) => e.aggregateId === 'two-a1' && e.payload?.seq === 0 });
    const evs = await write(tag, 3, 2);
    const done1 = await transport.publishFirst!(evs);
    expect(done1.size).toBe(6);
    expect(log.filter((l) => l.who === 'rt')).toHaveLength(5);                    // a1#0 threw
    const dead = (await sql`SELECT error_class, last_error_code FROM event_dead_letters WHERE consumer_name = ${n.rt}`.execute(db)).rows as any[];
    expect(dead).toEqual([{ error_class: 'PERMANENT', last_error_code: 'rt_broken' }]);
    const done2 = await transport.publishFirst!(evs);                               // redelivery
    expect(done2.size).toBe(6);
    expect(log.filter((l) => l.who === 'rt')).toHaveLength(5);                    // nothing projected twice
    expect(await processed(n.rt)).toBe(5);
    // skipFirst: the follow pass runs only the others
    const r = await transport.publish(evs[0], { skipFirst: true });
    expect(Object.keys(r.outcomes).sort()).toEqual([n.other, n.slow].sort());
  }, 60_000);

  it('the lane failing as a whole is not fatal: the follow pass runs the realtime consumer the ordinary way, once per event, in order', async () => {
    const tag = 'three'; const { n, transport } = setup(tag);
    const broken: EventTransport = { publish: (e, o) => transport.publish(e, o), publishFirst: async () => { throw Object.assign(new Error('connection terminated'), { code: 'ECONNRESET' }); } };
    await write(tag, 5, 4);
    const pub = new OutboxPublisher(db, broken, undefined, 2);
    const r = await pub.drain();
    expect(r.published).toBe(20);
    expect(await processed(n.rt)).toBe(20);
    for (let a = 0; a < 5; a++) expect(seqs('rt', `${tag}-a${a}`)).toEqual([0, 1, 2, 3]);
  }, 60_000);

  it('an infrastructure failure on a0#0: the rest of a0 is released, not published past; nothing is projected twice; order holds for every consumer', async () => {
    const tag = 'four'; const { n, transport } = setup(tag);
    const evs = await write(tag, 4, 5);
    let failNext = evs[0].eventId; const calls: Record<string, number> = {};
    const flaky: EventTransport = {
      publishFirst: (es) => transport.publishFirst!(es),
      async publish(e, o) { calls[e.eventId] = (calls[e.eventId] ?? 0) + 1; if (e.eventId === failNext) { failNext = ''; throw Object.assign(new Error('connection terminated'), { code: 'ECONNRESET' }); } return transport.publish(e, o); },
    };
    let backoff = 0;
    const pub = new OutboxPublisher(db, flaky, () => new Date(Date.now() + backoff), 2);
    const r1 = await pub.drain();
    expect(r1.published).toBe(15);                                                // a1..a3 out; a0 waits (#0 backing off, #1-#4 released)
    expect(seqs('slow', `${tag}-a0`)).toEqual([]);
    backoff = 10 * 60_000;                                                         // past the retry delay
    const r2 = await pub.drain();
    expect(r2.published).toBe(5);
    expect(await open()).toBe(0);
    for (const who of ['rt', 'slow', 'other']) for (let a = 0; a < 4; a++) expect(seqs(who, `${tag}-a${a}`), `${who} a${a}`).toEqual([0, 1, 2, 3, 4]);
    expect(log.filter((l) => l.who === 'rt')).toHaveLength(20);                   // projected once each (the retry found them processed)
    expect(calls[evs[0].eventId]).toBe(2);                                         // the failed attempt + the retry
    expect(await processed(n.slow)).toBe(20);
  }, 60_000);
});
