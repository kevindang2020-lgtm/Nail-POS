// event-replay.pgtest — §43–47 on real Postgres. The refusals are the point: a replay that duplicates a real
// effect is the failure this whole design exists to prevent.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent, type EventConsumer } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from './event-transport';
import { OutboxPublisher } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';
import { EventReplayService } from './event-replay.service';

const T = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
let db: any; let replay: EventReplayService; let publisher: OutboxPublisher; let registry: ConsumerRegistry;
const ran: Record<string, string[]> = {};
const consumer = (name: string, replayClass: any): EventConsumer => ({
  name, eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], replay: replayClass,
  async handle(e) { (ran[name] ??= []).push(e.eventId); },
});

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                 VALUES ('${T}','G','Glamour','glamour','GLAM01','active'), ('${T2}','L','Luxe','luxe','LUXE01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg); registry = new ConsumerRegistry();
  registry.register(consumer('proj.safe', 'REPLAY_SAFE'));
  registry.register(consumer('money.guarded', 'REPLAY_SAFE_WITH_IDEMPOTENCY'));
  registry.register(consumer('sms.sender', 'NOT_REPLAYABLE'));
  registry.register({ name: 'undeclared', eventTypes: [DOMAIN_EVENTS.APPOINTMENT_COMPLETED], async handle(e) { (ran['undeclared'] ??= []).push(e.eventId); } });
  const runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
  replay = new EventReplayService(db, registry, runner);
  // history: three events for T, one for T2
  const w = new OutboxWriter();
  for (const [i, tenant] of [[0, T], [1, T], [2, T], [3, T2]] as const) {
    await w.write(db, createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: tenant as string, aggregateType: 'appointment', aggregateId: `a-${i}`, actorType: 'user',
      occurredAt: new Date(Date.UTC(2026, 8, 10 + (i as number))).toISOString(), payload: { appointmentId: `a-${i}` } }));
  }
  while ((await publisher.tick()).claimed > 0) { /* drain: everything is now 'published' and processed once */ }
}, 60_000);

const range = { from: '2026-09-01T00:00:00Z', to: '2026-09-30T00:00:00Z' };

describe('§43/§44 — replay is a property of the CONSUMER', () => {
  it('a NOT_REPLAYABLE consumer is refused outright — this is the SMS/payment prohibition', async () => {
    const p = await replay.preview({ consumerName: 'sms.sender', tenantId: T, ...range });
    expect(p).toMatchObject({ ok: false, reason: 'consumer_not_replayable', replayClass: 'NOT_REPLAYABLE' });
    expect(p.token).toBeUndefined();
    const r = await replay.run({ consumerName: 'sms.sender', tenantId: T, ...range }, 'anything', 'sa-1');
    expect(r).toMatchObject({ ok: false, reason: 'consumer_not_replayable', ran: 0 });
  });

  it('a consumer that never DECLARED a class is treated as NOT_REPLAYABLE — the safe default', async () => {
    expect(await replay.preview({ consumerName: 'undeclared', tenantId: T, ...range })).toMatchObject({ ok: false, reason: 'consumer_not_replayable' });
  });

  it('an unregistered consumer name is refused, not silently ignored', async () => {
    expect(await replay.preview({ consumerName: 'ghost', tenantId: T, ...range })).toMatchObject({ ok: false, reason: 'consumer_not_registered' });
  });
});

describe('§45/§46 — preview, confirm, scope', () => {
  it('preview changes nothing and reports what WOULD run, including what is already processed', async () => {
    const before = ran['proj.safe']?.length ?? 0;
    const p = await replay.preview({ consumerName: 'proj.safe', tenantId: T, ...range });
    expect(p.ok).toBe(true);
    expect(p.matched).toBe(3);                       // tenant T only — §46, T2's event is not in scope
    expect(p.alreadyProcessed).toBe(3);              // the publisher already delivered them
    expect(p.wouldRun).toBe(0);
    expect(p.token).toMatch(/^[0-9a-f]{16}$/);
    expect(ran['proj.safe']?.length ?? 0).toBe(before);   // nothing ran
  });

  it('§45 run without the token, or with a stale one, is refused', async () => {
    const req = { consumerName: 'proj.safe', tenantId: T, ...range };
    expect(await replay.run(req, '', 'sa-1')).toMatchObject({ ok: false, reason: 'confirmation_token_mismatch' });
    expect(await replay.run(req, 'deadbeefdeadbeef', 'sa-1')).toMatchObject({ ok: false, reason: 'confirmation_token_mismatch' });
  });

  it('§46 a replay requires a tenant and a range — no platform-wide, no unbounded', async () => {
    expect(await replay.preview({ consumerName: 'proj.safe', tenantId: '', ...range })).toMatchObject({ reason: 'tenant_scope_required' });
    expect(await replay.preview({ consumerName: 'proj.safe', tenantId: T, from: '', to: '' })).toMatchObject({ reason: 'range_required' });
  });

  it('§47 replaying already-processed events re-does nothing (original eventId → processed_events), and is audited', async () => {
    const req = { consumerName: 'proj.safe', tenantId: T, ...range };
    const p = await replay.preview(req);
    const before = ran['proj.safe']?.length ?? 0;
    const r = await replay.run(req, p.token!, 'sa-7');
    expect(r).toMatchObject({ ok: true, ran: 3, processed: 0, duplicate: 3, failed: 0 });
    expect(ran['proj.safe']?.length ?? 0).toBe(before);       // the handler did not run again
    const audit = (await sql`SELECT action_type, entity_id, user_id, metadata_json FROM audit_logs WHERE action_type = 'event_replay_executed'`.execute(db)).rows as any[];
    expect(audit.length).toBe(1);
    expect(audit[0].entity_id).toBe('proj.safe');
    const meta = typeof audit[0].metadata_json === 'string' ? JSON.parse(audit[0].metadata_json) : audit[0].metadata_json;
    expect(meta).toMatchObject({ actor: 'sa-7', ran: 3, processed: 0, duplicate: 3 });   // actor kept in metadata: user_id is UUID-typed
  });

  it('a genuine gap IS rebuilt: a consumer that never saw the history processes it on replay', async () => {
    const req = { consumerName: 'money.guarded', tenantId: T, ...range };
    const p = await replay.preview(req);
    expect(p).toMatchObject({ ok: true, matched: 3, alreadyProcessed: 3 });   // it was registered before the drain too
    // simulate a consumer that missed one: delete its marker for a single event
    // Pick a marker for an event belonging to THIS tenant: the consumer also processed tenant T2's event, and
    // deleting that one would be outside the replay's scope (§46) — so wouldRun would stay 0 and prove nothing.
    const one: any = (await sql`SELECT pe.event_id FROM processed_events pe JOIN outbox_events o ON o.id = pe.event_id
                                WHERE pe.consumer_name = 'money.guarded' AND o.tenant_id = ${T} LIMIT 1`.execute(db)).rows[0];
    await sql`DELETE FROM processed_events WHERE consumer_name = 'money.guarded' AND event_id = ${one.event_id}`.execute(db);
    const p2 = await replay.preview(req);
    expect(p2.wouldRun).toBe(1);
    const r = await replay.run(req, p2.token!, 'sa-7');
    expect(r).toMatchObject({ ok: true, processed: 1, duplicate: 2 });
  });
});
