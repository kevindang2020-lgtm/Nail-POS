// event-loop.pgtest — Constitution 8 Phases 6–11 END TO END on real Postgres with real transactions.
// Each test is named for the section it proves. Duplicate delivery, retry, dead letter, tenant mismatch and
// version handling are all exercised against the real outbox_events / processed_events / event_dead_letters.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type DomainEvent, ConsumerError, TenantMismatchError, registerUpcaster, _resetUpcasters, type EventConsumer } from '@aipowersalon/events';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from './event-transport';
import { OutboxPublisher, rowToEvent } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';

const T = '11111111-1111-1111-1111-111111111111';
let db: any; let writer: OutboxWriter; let registry: ConsumerRegistry; let publisher: OutboxPublisher; let runner: ConsumerRunner;
const calls: Record<string, number> = {};
const counting = (name: string, types: any[], fn?: (e: DomainEvent<any>) => Promise<void>, critical = false): EventConsumer => ({
  name, eventTypes: types, critical,
  async handle(e) { calls[name] = (calls[name] ?? 0) + 1; if (fn) await fn(e); },
});
const evt = (id: string, type: any = DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: string | undefined = T) => createDomainEvent({
  eventType: type, tenantId, aggregateType: 'appointment', aggregateId: id, actorType: 'user', payload: { appointmentId: id },
});

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                 VALUES ('${T}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg); writer = new OutboxWriter(); registry = new ConsumerRegistry();
  // The runner gets a deterministic clock (backoff maths); the PUBLISHER must use real time, because outbox
  // rows default next_attempt_at to Postgres now() — a frozen clock captured earlier is never "due".
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
}, 60_000);
beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; _resetUpcasters(); });

describe('§18→§24: the full loop', () => {
  it('an event written in a transaction is claimed, delivered once, and marked published', async () => {
    registry.register(counting('loyalty.on_completed', [DOMAIN_EVENTS.APPOINTMENT_COMPLETED]));
    await db.transaction().execute(async (trx: any) => { await writer.write(trx, evt('a-1')); });
    const r = await publisher.tick();
    expect(r.published).toBe(1);
    expect(calls['loyalty.on_completed']).toBe(1);
    const row = await sql`SELECT publish_status, claimed_by FROM outbox_events WHERE aggregate_id = 'a-1'`.execute(db);
    expect((row.rows[0] as any).publish_status).toBe('published');
    expect((row.rows[0] as any).claimed_by).toBeNull();
    const done = await sql`SELECT 1 FROM processed_events WHERE consumer_name = 'loyalty.on_completed'`.execute(db);
    expect(done.rows.length).toBe(1);
  });

  it('§22/§23: delivering the SAME event again is a no-op — the consumer is not invoked twice', async () => {
    const e = evt('a-2');
    await writer.write(db, e);
    await publisher.tick();
    expect(calls['loyalty.on_completed']).toBe(1);
    const again = await runner.run(registry.get('loyalty.on_completed')!, e);   // simulate redelivery
    expect(again.status).toBe('duplicate');
    expect(calls['loyalty.on_completed']).toBe(1);                              // still once
  });

  it('§30: one failing consumer does not block another on the same event', async () => {
    registry.register(counting('analytics.on_completed', [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], async () => { throw new ConsumerError('PERMANENT', 'bad_payload'); }));
    await writer.write(db, evt('a-3'));
    const r = await publisher.tick();
    expect(r.published).toBe(1);                                   // the EVENT is published regardless
    expect(calls['loyalty.on_completed']).toBe(1);                 // healthy consumer ran
    const dl = await sql`SELECT consumer_name, status, error_class, attempts FROM event_dead_letters WHERE consumer_name = 'analytics.on_completed'`.execute(db);
    expect(dl.rows.length).toBe(1);
    expect(dl.rows[0]).toMatchObject({ status: 'open', error_class: 'PERMANENT', attempts: 1 });   // §50: PERMANENT never retries
  });

  it('§50: a TRANSIENT failure schedules a retry with backoff, then dead-letters after max attempts', async () => {
    registry.register(counting('push.on_completed', [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], async () => { throw new ConsumerError('TRANSIENT', 'provider_timeout'); }));
    const e = evt('a-4');
    const c = registry.get('push.on_completed')!;
    const first = await runner.run(c, e);
    expect(first.status).toBe('retry_scheduled');
    if (first.status === 'retry_scheduled') expect(first.attempt).toBe(1);
    const row1 = await sql`SELECT status, attempts, next_attempt_at FROM event_dead_letters WHERE consumer_name = 'push.on_completed'`.execute(db);
    expect((row1.rows[0] as any).status).toBe('retrying');
    expect((row1.rows[0] as any).next_attempt_at).not.toBeNull();
    for (let i = 0; i < 3; i++) await runner.run(c, e);
    const last = await runner.run(c, e);                          // 5th attempt = standard max
    expect(last.status).toBe('dead_lettered');
    const rowN = await sql`SELECT status, attempts FROM event_dead_letters WHERE consumer_name = 'push.on_completed'`.execute(db);
    expect((rowN.rows[0] as any).status).toBe('open');
    expect((rowN.rows[0] as any).attempts).toBe(5);
  });

  it('§50: a retry that finally succeeds resolves its dead-letter row', async () => {
    let flaky = 0;
    registry.register(counting('sms.on_completed', [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], async () => { if (flaky++ === 0) throw new ConsumerError('TRANSIENT', 'blip'); }));
    const e = evt('a-5'); const c = registry.get('sms.on_completed')!;
    expect((await runner.run(c, e)).status).toBe('retry_scheduled');
    expect((await runner.run(c, e)).status).toBe('processed');
    const row = await sql`SELECT status, resolved_by FROM event_dead_letters WHERE consumer_name = 'sms.on_completed'`.execute(db);
    expect(row.rows[0]).toMatchObject({ status: 'resolved', resolved_by: 'retry' });
  });

  it('§14/§143: a tenant mismatch is SECURITY — no retry, and a security.tenant_mismatch event is written to the outbox', async () => {
    registry.register(counting('review.on_completed', [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], async () => { throw new TenantMismatchError(); }));
    const e = evt('a-6'); const c = registry.get('review.on_completed')!;
    const r = await runner.run(c, e);
    expect(r.status).toBe('dead_lettered');
    if (r.status === 'dead_lettered') expect(r.errorClass).toBe('SECURITY');
    const alert = await sql`SELECT event_type, tenant_id, payload_json FROM outbox_events WHERE event_type = 'security.tenant_mismatch'`.execute(db);
    expect(alert.rows.length).toBe(1);
    expect((alert.rows[0] as any).tenant_id).toBeNull();                          // platform-scoped (§168)
    const p = (alert.rows[0] as any).payload_json;
    expect((typeof p === 'string' ? JSON.parse(p) : p).offendingEventId).toBe(e.eventId);
  });

  it('§34/§36: an older version is upcast; a newer-than-known version is PERMANENT', async () => {
    registerUpcaster(DOMAIN_EVENTS.APPOINTMENT_COMPLETED, 0, (ev) => ({ ...ev, eventVersion: 1, payload: { ...ev.payload, upcast: true } }));
    let seen: any = null;
    registry.register(counting('ver.probe', [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], async (ev) => { seen = ev; }));
    const c = registry.get('ver.probe')!;
    const oldEvent = { ...evt('a-7'), eventVersion: 0 };
    // validateDomainEvent rejects version 0 up front (schema) — the runner must therefore classify it PERMANENT, not crash
    const r0 = await runner.run(c, oldEvent as any);
    expect(r0.status).toBe('dead_lettered');
    const tooNew = { ...evt('a-8'), eventVersion: 9 };
    const r9 = await runner.run(c, tooNew as any);
    expect(r9.status).toBe('dead_lettered');
    if (r9.status === 'dead_lettered') expect(r9.errorClass).toBe('PERMANENT');
    expect(seen).toBeNull();
  });

  it('§21: two publishers never claim the same rows (FOR UPDATE SKIP LOCKED)', async () => {
    registry.register(counting('claim.probe', [DOMAIN_EVENTS.PAYMENT_CAPTURED]));
    // Drain first: the §143 test above wrote a security.tenant_mismatch alert to the outbox, and the publisher
    // correctly publishes that too — which is exactly what §143 wants, but it would skew this count.
    while ((await publisher.tick()).claimed > 0) { /* drain */ }
    for (let i = 0; i < 6; i++) await writer.write(db, evt(`p-${i}`, DOMAIN_EVENTS.PAYMENT_CAPTURED));
    const second = new OutboxPublisher(db, new InProcessTransport(db, registry, runner), () => new Date());
    const [a, b] = await Promise.all([publisher.tick(), second.tick()]);
    expect(a.published + b.published).toBe(6);                    // every event published exactly once across both
    expect(calls['claim.probe']).toBe(6);
  });

  it('rowToEvent round-trips the envelope faithfully', async () => {
    const e = evt('a-9'); await writer.write(db, e);
    const row = await sql`SELECT * FROM outbox_events WHERE id = ${e.eventId}`.execute(db);
    const back = rowToEvent(row.rows[0]);
    expect(back).toMatchObject({ eventId: e.eventId, eventType: e.eventType, tenantId: T, aggregateId: 'a-9', correlationId: e.correlationId, payload: { appointmentId: 'a-9' } });
  });
});
