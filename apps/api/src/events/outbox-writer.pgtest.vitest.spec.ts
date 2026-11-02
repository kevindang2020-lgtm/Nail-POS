// outbox-writer.pgtest — proves the OUTBOX RULE (§18–19) against real Postgres: the event row commits with the
// business row or neither does. Uses the cached migrated schema (@aipowersalon/testing (packages/testing/src/pgtest-schema.mjs)); the cache
// key includes migration 433, so this runs on the real outbox_events table.
import { OutboxWriter, InvalidDomainEventError, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = '11111111-1111-1111-1111-111111111111';
let db: any; let writer: OutboxWriter;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                 VALUES ('${T}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;
                 CREATE TABLE IF NOT EXISTS _biz (id TEXT PRIMARY KEY, status TEXT NOT NULL);`);
  db = kyselyFor(pg); writer = new OutboxWriter();
}, 60_000);

const evt = (aggregateId: string) => createDomainEvent({
  eventType: DOMAIN_EVENTS.APPOINTMENT_COMPLETED, tenantId: T, aggregateType: 'appointment', aggregateId,
  actorType: 'user', payload: { appointmentId: aggregateId },
});

describe('OutboxWriter — the outbox rule against real Postgres', () => {
  it('§18: business row + outbox row commit together', async () => {
    await db.transaction().execute(async (trx: any) => {
      await sql`INSERT INTO _biz (id, status) VALUES ('a-1', 'completed')`.execute(trx);
      await writer.write(trx, evt('a-1'));
    });
    const biz = await sql`SELECT status FROM _biz WHERE id = 'a-1'`.execute(db);
    const out = await sql`SELECT event_type, publish_status, tenant_id, payload_json FROM outbox_events WHERE aggregate_id = 'a-1'`.execute(db);
    expect(biz.rows.length).toBe(1);
    expect(out.rows.length).toBe(1);
    expect((out.rows[0] as any).event_type).toBe('appointment.completed');
    expect((out.rows[0] as any).publish_status).toBe('pending');
    expect((out.rows[0] as any).tenant_id).toBe(T);
  });

  it('§18 all-or-nothing: an INVALID event throws and the business row rolls back with it', async () => {
    const bad = { ...evt('a-2'), payload: { appointmentId: 'a-2', otp: '123456' } };   // §225 forbidden key
    await expect(db.transaction().execute(async (trx: any) => {
      await sql`INSERT INTO _biz (id, status) VALUES ('a-2', 'completed')`.execute(trx);
      await writer.write(trx, bad as any);
    })).rejects.toBeInstanceOf(InvalidDomainEventError);
    const biz = await sql`SELECT 1 FROM _biz WHERE id = 'a-2'`.execute(db);
    const out = await sql`SELECT 1 FROM outbox_events WHERE aggregate_id = 'a-2'`.execute(db);
    expect(biz.rows.length).toBe(0);     // the business change did NOT survive
    expect(out.rows.length).toBe(0);     // and no half-written event exists
  });

  it('§13: a tenant event with no tenantId is refused before it can reach the table', async () => {
    const e = { ...evt('a-3'), tenantId: undefined };
    await expect(writer.write(db, e as any)).rejects.toBeInstanceOf(InvalidDomainEventError);
  });

  it('§10: the same eventId cannot be written twice (primary key) — duplicate writes surface, never silently double', async () => {
    const e = evt('a-4');
    await writer.write(db, e);
    await expect(writer.write(db, e)).rejects.toBeTruthy();
  });

  it('§212: the publisher\'s hot-path index exists on (publish_status, next_attempt_at)', async () => {
    const r = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'outbox_events'`.execute(db);
    expect((r.rows as any[]).map((x) => x.indexname)).toContain('idx_outbox_due');
  });
});
