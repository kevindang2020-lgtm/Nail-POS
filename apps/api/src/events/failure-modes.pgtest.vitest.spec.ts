// failure-modes.pgtest — Constitution 8 Phase 16 (§137–144, §203–208) and Phase 17 (§202) on real Postgres.
// Each test is the failure the constitution names, provoked for real, with the recovery asserted.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type DomainEvent, ConsumerError, type EventConsumer } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport, type EventTransport } from './event-transport';
import { OutboxPublisher, PUBLISHER } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';
import { DeadLetterRetryWorker } from './event-ops.service';

const T = '11111111-1111-1111-1111-111111111111';
let db: any; let writer: OutboxWriter; let registry: ConsumerRegistry; let runner: ConsumerRunner; let publisher: OutboxPublisher;
const seen: Record<string, string[]> = {};
const consumer = (name: string, types: any[], fn?: (e: DomainEvent<any>, trx: any) => Promise<void>): EventConsumer => ({
  name, eventTypes: types, async handle(e, trx) { (seen[name] ??= []).push(e.eventId); if (fn) await fn(e, trx); },
});
const evt = (id: string, type: any = DOMAIN_EVENTS.APPOINTMENT_COMPLETED, over: Partial<DomainEvent<any>> = {}) =>
  ({ ...createDomainEvent({ eventType: type, tenantId: T, aggregateType: 'appointment', aggregateId: id, actorType: 'user', payload: { appointmentId: id } }), ...over });

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','G','Glamour','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;
                 CREATE TABLE IF NOT EXISTS _effects (id TEXT PRIMARY KEY, event_id TEXT NOT NULL);`);
  db = kyselyFor(pg); writer = new OutboxWriter(); registry = new ConsumerRegistry();
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
  registry.register(consumer('audit.all', [DOMAIN_EVENTS.APPOINTMENT_COMPLETED, DOMAIN_EVENTS.PAYMENT_CAPTURED]));
}, 60_000);

describe('Phase 16 — named failure modes', () => {
  it('§206 publisher crash AFTER claiming, BEFORE marking: the reaper returns the row and it is delivered — once', async () => {
    const e = evt('crash-1'); await writer.write(db, e);
    // simulate a publisher that claimed the row and died: status 'claimed' with a stale claimed_at
    await sql`UPDATE outbox_events SET publish_status = 'claimed', claimed_by = 'pub-dead', claimed_at = now() - interval '10 minutes' WHERE id = ${e.eventId}`.execute(db);
    const r = await publisher.tick();
    expect(r.reclaimed).toBe(1);
    expect(r.published).toBe(1);
    expect(seen['audit.all'].filter((x) => x === e.eventId).length).toBe(1);
    // a FRESH claim (publisher alive, just slow) is NOT reaped
    const e2 = evt('crash-2'); await writer.write(db, e2);
    await sql`UPDATE outbox_events SET publish_status = 'claimed', claimed_by = 'pub-alive', claimed_at = now() WHERE id = ${e2.eventId}`.execute(db);
    expect((await publisher.tick()).reclaimed).toBe(0);
    await sql`UPDATE outbox_events SET publish_status = 'pending', claimed_by = NULL, claimed_at = NULL WHERE id = ${e2.eventId}`.execute(db);  // release for later tests
  });

  it('§207 consumer crash MID-TRANSACTION: the handler\'s own writes roll back with the processed marker', async () => {
    registry.register(consumer('effects.crashy', [DOMAIN_EVENTS.PAYMENT_CAPTURED], async (e, trx) => {
      await sql`INSERT INTO _effects (id, event_id) VALUES (${'fx-' + e.eventId}, ${e.eventId})`.execute(trx);   // a real write…
      throw new ConsumerError('TRANSIENT', 'crashed_after_write');                                         // …then the crash
    }));
    const e = evt('mid-1', DOMAIN_EVENTS.PAYMENT_CAPTURED);
    const r = await runner.run(registry.get('effects.crashy')!, e);
    expect(r.status).toBe('retry_scheduled');
    expect((await sql`SELECT 1 FROM _effects WHERE event_id = ${e.eventId}`.execute(db)).rows.length).toBe(0);         // write rolled back
    expect((await sql`SELECT 1 FROM processed_events WHERE event_id = ${e.eventId}`.execute(db)).rows.length).toBe(0); // marker rolled back
  });

  it('§208 poison event: PERMANENT goes straight to dead, and the retry worker never picks it up', async () => {
    registry.register(consumer('poison.target', [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], async () => { throw new ConsumerError('PERMANENT', 'invalid_payload'); }));
    const e = evt('poison-1');
    const r = await runner.run(registry.get('poison.target')!, e);
    expect(r.status).toBe('dead_lettered');
    const worker = new DeadLetterRetryWorker(db, registry, runner);
    await sql`UPDATE event_dead_letters SET next_attempt_at = now() - interval '1 minute' WHERE consumer_name = 'poison.target'`.execute(db);   // even if "due"
    expect((await worker.tick()).due).toBe(0);                                          // status is 'open', not 'retrying'
    expect(seen['poison.target'].length).toBe(1);                                        // exactly one attempt, ever
  });

  it('§204 transport outage: nothing is lost — rows stay pending with backoff, and drain when the transport returns', async () => {
    let down = true;
    const flaky: EventTransport = { async publish(_e) { if (down) throw Object.assign(new Error('redis down'), { code: 'ECONNREFUSED' }); return { delivered: 0, outcomes: {} }; } };
    while ((await publisher.tick()).claimed > 0) { /* drain leftovers from earlier tests so counts are exact */ }
    const pub = new OutboxPublisher(db, flaky);
    const ids = [] as string[];
    for (let i = 0; i < 3; i++) { const e = evt(`outage-${i}`); await writer.write(db, e); ids.push(e.eventId); }
    const r1 = await pub.tick();
    expect(r1.failed).toBe(3); expect(r1.published).toBe(0);
    const rows = (await sql`SELECT publish_status, attempt_count, last_error_code, next_attempt_at > now() AS deferred FROM outbox_events WHERE id = ANY(${ids as any})`.execute(db)).rows as any[];
    expect(rows.every((x) => x.publish_status === 'pending' && x.attempt_count === 1 && x.deferred === true)).toBe(true);   // backoff, not lost
    expect(rows[0].last_error_code).toBe('err_econnrefused');                                                             // §197 code only
    down = false;
    await sql`UPDATE outbox_events SET next_attempt_at = now() WHERE id = ANY(${ids as any})`.execute(db);                   // fast-forward the backoff
    expect((await pub.tick()).published).toBe(3);
  });

  it('§38/§41 out-of-order: the publisher delivers by occurred_at, and a consumer that revalidates state ignores stale', async () => {
    const order: string[] = [];
    const latest: Record<string, number> = {};
    registry.register(consumer('order.probe', [DOMAIN_EVENTS.APPOINTMENT_CONFIRMED], async (e) => {
      order.push(e.aggregateVersion == null ? '?' : String(e.aggregateVersion));
      // §56: revalidate — apply only if newer than what we have (aggregate_version), else no-op
      const cur = latest[e.aggregateId] ?? -1;
      if ((e.aggregateVersion ?? 0) > cur) latest[e.aggregateId] = e.aggregateVersion ?? 0;
    }));
    const base = Date.now();
    // write v3 FIRST (later occurred_at), then v1, then v2 — insertion order is the wrong order
    for (const [v, off] of [[3, 3000], [1, 1000], [2, 2000]] as const) {
      await writer.write(db, evt('ord-1', DOMAIN_EVENTS.APPOINTMENT_CONFIRMED, { aggregateVersion: v, occurredAt: new Date(base + off).toISOString() }));
    }
    await publisher.tick();
    expect(order).toEqual(['1', '2', '3']);                       // delivered by occurred_at, not insertion
    // now a stale v1 arrives AGAIN after v3 (a replay/redelivery): state does not regress
    await runner.run(registry.get('order.probe')!, evt('ord-1', DOMAIN_EVENTS.APPOINTMENT_CONFIRMED, { aggregateVersion: 1, occurredAt: new Date(base + 1000).toISOString() }));
    expect(latest['ord-1']).toBe(3);
  });

  it('§142 tenant isolation under load: two tenants\' events never cross in any consumer', async () => {
    const T2 = '22222222-2222-2222-2222-222222222222';
    await sql`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES (${T2},'L','Luxe','luxe','LUXE01','active') ON CONFLICT (id) DO NOTHING`.execute(db);
    const byTenant: Record<string, Set<string>> = {};
    registry.register(consumer('iso.probe', [DOMAIN_EVENTS.CUSTOMER_CREATED], async (e) => { (byTenant[e.tenantId!] ??= new Set()).add(e.aggregateId); }));
    for (let i = 0; i < 10; i++) {
      await writer.write(db, createDomainEvent({ eventType: DOMAIN_EVENTS.CUSTOMER_CREATED, tenantId: i % 2 ? T : T2, aggregateType: 'customer', aggregateId: `c-${i}`, actorType: 'user', payload: { customerId: `c-${i}` } }));
    }
    while ((await publisher.tick()).claimed > 0) { /* drain */ }
    expect([...byTenant[T]].every((id) => Number(id.slice(2)) % 2 === 1)).toBe(true);
    expect([...byTenant[T2]].every((id) => Number(id.slice(2)) % 2 === 0)).toBe(true);
  });
});

describe('Phase 17 — load (§202)', () => {
  it('500 events × 3 consumers drain completely, every consumer processes each exactly once, with measured throughput', async () => {
    const N = 500;
    const counts = { a: 0, b: 0, c: 0 };
    for (const k of ['a', 'b', 'c'] as const) registry.register(consumer(`load.${k}`, [DOMAIN_EVENTS.SERVICE_COMPLETED], async () => { counts[k]++; }));
    while ((await publisher.tick()).claimed > 0) { /* drain */ }
    const t0 = Date.now();
    await db.transaction().execute(async (trx: any) => { for (let i = 0; i < N; i++) await writer.write(trx, evt(`load-${i}`, DOMAIN_EVENTS.SERVICE_COMPLETED)); });
    const tWrite = Date.now() - t0;
    const t1 = Date.now(); let ticks = 0;
    while ((await publisher.tick()).claimed > 0) ticks++;
    const tDrain = Date.now() - t1;
    expect(counts).toEqual({ a: N, b: N, c: N });                                       // exactly once per consumer
    const processed: any = (await sql`SELECT count(*)::int AS n FROM processed_events WHERE consumer_name LIKE 'load.%'`.execute(db)).rows[0];
    expect(processed.n).toBe(N * 3);
    const pending: any = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE publish_status <> 'published' AND event_type = 'service.completed'`.execute(db)).rows[0];
    expect(pending.n).toBe(0);
    expect(ticks).toBe(Math.ceil(N / PUBLISHER.batch));                                 // batching works as configured
    console.log(`LOAD: wrote ${N} events in ${tWrite}ms; drained ${N}×3 deliveries in ${tDrain}ms over ${ticks} ticks (${Math.round((N * 3) / (tDrain / 1000))} deliveries/s on PGlite)`);
  });
});
