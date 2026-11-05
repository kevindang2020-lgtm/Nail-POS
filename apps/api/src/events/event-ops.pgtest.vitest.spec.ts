// event-ops.pgtest — Constitution 8 Phase 15 on real Postgres: health, search, retry, discard, and the retry
// worker that re-runs due dead letters WITHOUT anyone calling the runner by hand (the gap Phase 10 left open).
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, ConsumerError, type EventConsumer } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from './event-transport';
import { OutboxPublisher } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';
import { EventOpsService, DeadLetterRetryWorker } from './event-ops.service';
import { checkEventPermission, EP } from './event-ops-permissions';

const T = '11111111-1111-1111-1111-111111111111';
let db: any; let ops: EventOpsService; let worker: DeadLetterRetryWorker; let publisher: OutboxPublisher; let registry: ConsumerRegistry; let runner: ConsumerRunner;
let flakyFails = 1; const handled: string[] = [];

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','G','Glamour','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg); registry = new ConsumerRegistry();
  const flaky: EventConsumer = { name: 'flaky.consumer', eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED],
    async handle(e) { if (flakyFails-- > 0) throw new ConsumerError('TRANSIENT', 'blip'); handled.push(e.eventId); } };
  const broken: EventConsumer = { name: 'broken.consumer', eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], async handle() { throw new ConsumerError('PERMANENT', 'bad'); } };
  registry.register(flaky); registry.register(broken);
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
  ops = new EventOpsService(db, registry); worker = new DeadLetterRetryWorker(db, registry, runner);
}, 60_000);

const evt = (id: string) => createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: T, aggregateType: 'appointment', aggregateId: id, actorType: 'user', payload: { appointmentId: id } });

describe('Phase 15 — event operations', () => {
  it('health() reports outbox, dead letters and per-consumer lag from real tables', async () => {
    const e = evt('a-1'); await new OutboxWriter().write(db, e);
    await publisher.tick();                                       // flaky → retrying (1st fail), broken → open
    const h = await ops.health();
    expect(h.outbox.published).toBeGreaterThanOrEqual(1);
    expect(h.deadLetters.retrying).toBeGreaterThanOrEqual(1);
    expect(h.deadLetters.open).toBeGreaterThanOrEqual(1);
    expect(h.deadLetters.byConsumer.find((c) => c.consumerName === 'broken.consumer')?.open).toBe(1);
    const flakyRow = h.consumers.find((c) => c.consumerName === 'flaky.consumer')!;
    expect(flakyRow.eventTypes).toContain('appointment.completed');
    expect(flakyRow.lagSec).not.toBeNull();                       // a published event it has not processed → lag
  });

  it('the RETRY WORKER re-runs a due retrying dead letter by itself and resolves it', async () => {
    // make the retry due now (backoff put it ~2s out; the worker only takes due rows)
    await sql`UPDATE event_dead_letters SET next_attempt_at = now() - interval '1 second' WHERE consumer_name = 'flaky.consumer' AND status = 'retrying'`.execute(db);
    const r = await worker.tick();
    expect(r.due).toBe(1);
    expect(Object.values(r.outcomes)).toEqual(['processed']);
    const row = await sql`SELECT status, resolved_by FROM event_dead_letters WHERE consumer_name = 'flaky.consumer'`.execute(db);
    expect(row.rows[0]).toMatchObject({ status: 'resolved', resolved_by: 'retry' });
    expect(handled.length).toBe(1);
    expect((await worker.tick()).due).toBe(0);                    // nothing left due; PERMANENT rows are never picked up
  });

  it('search() by correlation id returns the event with its per-consumer outcomes, no payloads', async () => {
    const e = evt('a-2'); await new OutboxWriter().write(db, e); await publisher.tick();
    const s = await ops.search({ correlationId: e.correlationId });
    expect(s.events.length).toBe(1);
    expect((s.events[0] as any).payload_json).toBeUndefined();     // §197: search never leaks payloads
    const names = s.outcomes.map((o: any) => `${o.consumer_name}:${o.status}`).sort();
    expect(names).toEqual(['broken.consumer:open', 'flaky.consumer:processed']);
  });

  it('retryDeadLetter puts an OPEN row back on the path without resetting attempts; discard keeps the row', async () => {
    const open: any = (await sql`SELECT id, attempts FROM event_dead_letters WHERE consumer_name = 'broken.consumer' ORDER BY first_failed_at LIMIT 1`.execute(db)).rows[0];
    expect((await ops.retryDeadLetter(open.id, 'sa-1')).ok).toBe(true);
    const after: any = (await sql`SELECT status, attempts FROM event_dead_letters WHERE id = ${open.id}`.execute(db)).rows[0];
    expect(after.status).toBe('retrying');
    expect(after.attempts).toBe(open.attempts);                   // history stays honest
    await worker.tick();                                          // broken is PERMANENT → back to open
    expect((await sql`SELECT status FROM event_dead_letters WHERE id = ${open.id}`.execute(db)).rows[0]).toMatchObject({ status: 'open' });
    expect((await ops.discardDeadLetter(open.id, 'sa-1')).ok).toBe(true);
    const d: any = (await sql`SELECT status, resolved_by FROM event_dead_letters WHERE id = ${open.id}`.execute(db)).rows[0];
    expect(d).toMatchObject({ status: 'discarded', resolved_by: 'sa-1' });   // row kept, never deleted (§155)
    expect((await ops.retryDeadLetter(open.id, 'sa-1'))).toEqual({ ok: false, reason: 'already_discarded' });
  });

  it('retrying a dead letter whose consumer is no longer registered is refused, not silently dropped', async () => {
    await sql`INSERT INTO event_dead_letters (event_id, consumer_name, event_type, envelope_json, attempts, error_class, status)
              VALUES (gen_random_uuid(), 'ghost.consumer', 'appointment.completed', '{}'::jsonb, 1, 'PERMANENT', 'open')`.execute(db);
    const ghost: any = (await sql`SELECT id FROM event_dead_letters WHERE consumer_name = 'ghost.consumer'`.execute(db)).rows[0];
    expect(await ops.retryDeadLetter(ghost.id, 'sa-1')).toEqual({ ok: false, reason: 'consumer_not_registered' });
  });
});

describe('§150–155 permissions', () => {
  const sa = (perms: string[]) => ({ role: 'SUPER_ADMIN', permissions: perms });
  it('unrestricted super admin: everything; wildcard: view+retry but NOT replay/purge; non-super-admin: nothing', () => {
    expect(checkEventPermission(sa([]), EP.purge)).toBe(true);
    expect(checkEventPermission(sa(['super_admin.events.*']), EP.retry)).toBe(true);
    expect(checkEventPermission(sa(['super_admin.events.*']), EP.purge)).toBe(false);
    expect(checkEventPermission(sa(['super_admin.events.*']), EP.replay)).toBe(false);
    expect(checkEventPermission(sa(['super_admin.events.view']), EP.retry)).toBe(false);
    expect(checkEventPermission({ role: 'OWNER', permissions: ['*'] }, EP.view)).toBe(false);
  });
});
