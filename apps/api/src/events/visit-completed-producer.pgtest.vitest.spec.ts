// visit-completed-producer.pgtest — BUILD_PLAN Phase 15 (Constitution 8 §61–62 / §18): visit.completed was registered and
// recorded by nothing.
//
// The ONE canonical point: a visit is complete when its TICKET IS PAID. That is the platform's own definition of a visit —
// VISIT_TICKET_STATUSES ('paid' / 'closed') is what counts a customer's visits, last visit and returning status — and it is
// the moment every other end-of-visit fact is recorded (checkout.completed, payment.captured). The queue's in_service → done
// transition and service.completed happen BEFORE the guest has paid (a ticket can still be held, re-opened or voided) and a
// ticket may have several service lines, so neither is "the visit is over". The event is built in ONE place
// (visitCompletedEvent, @aipowersalon/checkout) and attached to the paid transition by each writer that records
// checkout.completed — the POS finalize (KyselyCheckoutRepository.setStatus('paid')) and the skip-line payment — and the guard
// below fails if a writer of checkout.completed stops recording it. One event per visit: only the transition INTO paid.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter, validateDomainEvent } from '@aipowersalon/events';
import { KyselyCheckoutRepository, SkipLineCheckoutRepository } from '@aipowersalon/checkout';

const T = '11111111-1111-1111-1111-1111111111c5', B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac5';
const CUST = 'dddddddd-dddd-dddd-dddd-ddddddddddc5';
const POS1 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeec51', POS2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeec52';
const SKIP = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeec54', SKIP2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeec55';
const USER = 'ffffffff-ffff-ffff-ffff-ffffffffffc5';
const ctx: any = { tenantId: T, branchId: B, userId: USER, role: 'OWNER', permissions: [] };
let db: any;
const visits = async (ticketId: string) => (await sql`SELECT event_type, tenant_id, branch_id, aggregate_type, aggregate_id, correlation_id, payload_json FROM outbox_events WHERE event_type = 'visit.completed' AND aggregate_id = ${ticketId}`.execute(db)).rows as any[];
const status = async (ticketId: string) => ((await sql`SELECT status FROM tickets WHERE id = ${ticketId}`.execute(db)).rows[0] as any)?.status;
/** an outbox whose write of visit.completed succeeds and then fails the transaction */
const failingAfterVisit = () => {
  const w = new OutboxWriter(); const real = w.write.bind(w);
  w.write = async (trx: any, e: any) => { await real(trx, e); if (e.eventType === 'visit.completed') throw new Error('boom after the event'); };
  return w;
};

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','V','Visit Salon','visit-ev','VISIT5','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main') ON CONFLICT (id) DO NOTHING;
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES ('${CUST}','${T}','${B}','Ava','Kim','Ava Kim','+16095550188','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES
      ('${POS1}','${T}','${B}','${CUST}','serving'), ('${POS2}','${T}','${B}','${CUST}','serving'),
      ('${SKIP}','${T}','${B}','${CUST}','serving'), ('${SKIP2}','${T}','${B}','${CUST}','serving') ON CONFLICT (id) DO NOTHING;
  `);
  db = kyselyFor(pg);
}, 60_000);

describe('visit.completed — the ticket is paid', () => {
  it('POS finalize (setStatus paid) records ONE visit.completed with the ticket and customer ids, beside checkout.completed', async () => {
    const repo = new KyselyCheckoutRepository(db, new OutboxWriter());
    expect(await repo.setStatus(ctx, POS1, 'paid' as any)).toBe(true);
    const ev = await visits(POS1);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tenant_id: T, branch_id: B, aggregate_type: 'ticket', aggregate_id: POS1, correlation_id: `ticket:${POS1}` });
    expect(ev[0].payload_json).toEqual({ ticketId: POS1, customerId: CUST, channel: 'pos' });
    expect(validateDomainEvent({ eventId: '0b8f8a8e-1c1e-4a3e-9a51-1f8e2b7c9d10', eventType: 'visit.completed' as any, eventVersion: 1, occurredAt: new Date(0).toISOString(), tenantId: T, aggregateType: 'ticket', aggregateId: POS1, correlationId: 'c', payload: ev[0].payload_json })).toEqual([]);
  });
  it('marking an already-paid ticket paid again records no second visit', async () => {
    const repo = new KyselyCheckoutRepository(db, new OutboxWriter());
    await repo.setStatus(ctx, POS1, 'paid' as any);
    expect(await visits(POS1)).toHaveLength(1);
  });
  it('a finalize that rolls back records no visit and leaves the ticket unpaid', async () => {
    await new KyselyCheckoutRepository(db, failingAfterVisit()).setStatus(ctx, POS2, 'paid' as any);
    expect(await visits(POS2)).toEqual([]);
    expect(await status(POS2)).toBe('serving');
  });
  it('a skip-line payment records ONE visit.completed (channel skip_line); its idempotent retry records none', async () => {
    const repo = new SkipLineCheckoutRepository(db, new OutboxWriter());
    await repo.recordPaymentAndCloseTicket(ctx, SKIP, 'card', 4500, 500, { idempotencyKey: 'visit-skip-1' });
    await repo.recordPaymentAndCloseTicket(ctx, SKIP, 'card', 4500, 500, { idempotencyKey: 'visit-skip-1' });
    expect((await visits(SKIP)).map((e) => e.payload_json)).toEqual([{ ticketId: SKIP, customerId: CUST, channel: 'skip_line' }]);
  });
  it('a second (non-retry) skip-line payment on the already-paid ticket records no second visit', async () => {
    await new SkipLineCheckoutRepository(db, new OutboxWriter()).recordPaymentAndCloseTicket(ctx, SKIP, 'cash', 500, 0, { idempotencyKey: 'visit-skip-2' });
    expect(await visits(SKIP)).toHaveLength(1);
  });
  it('a skip-line payment that rolls back records no visit and leaves the ticket unpaid', async () => {
    await expect(new SkipLineCheckoutRepository(db, failingAfterVisit()).recordPaymentAndCloseTicket(ctx, SKIP2, 'cash', 3000, 0)).rejects.toThrow('boom');
    expect(await visits(SKIP2)).toEqual([]);
    expect(await status(SKIP2)).toBe('serving');
  });
});

describe('guard: every writer of checkout.completed also records the visit through the one builder', () => {
  const ROOTS = [resolve(__dirname, '..'), resolve(__dirname, '../../../../modules')];
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    if (n === 'node_modules' || n === 'dist') return [];
    const p = resolve(d, n); return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const writers = ROOTS.flatMap(walk).filter((f) => f.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(f) && !/events\/consumers\//.test(f))
    .filter((f) => /eventType:\s*DOMAIN_EVENTS\.CHECKOUT_COMPLETED/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
  it('finds the two writers', () => { expect(writers.length).toBe(2); });
  for (const f of writers) it(`${f.split('/src/')[1]} calls visitCompletedEvent(`, () => {
    expect(readFileSync(f, 'utf8')).toMatch(/visitCompletedEvent\(/);
  });
});

// PGlite is one session, so an event written through the root handle instead of the transaction would still roll back
// with it. On real Postgres (a pool) the difference shows. Opt-in: PG_RACE_URL=… (a migrated database).
const url = process.env.PG_RACE_URL;
describe.skipIf(!url)('real Postgres: visit.completed shares the paid transaction', () => {
  it('a POS finalize and a skip-line payment that fail after the event leave no visit and an unpaid ticket', async () => {
    const { Kysely, PostgresDialect } = await import('kysely');
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    const rdb = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    const ids = [POS2, SKIP2];
    try {
      await sql`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES (${T},'V','Visit Salon','visit-ev','VISIT5','active') ON CONFLICT (id) DO NOTHING`.execute(rdb);
      await sql`INSERT INTO branches (id, tenant_id, name) VALUES (${B},${T},'Main') ON CONFLICT (id) DO NOTHING`.execute(rdb);
      await sql`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES (${CUST},${T},${B},'Ava','Kim','Ava Kim','+16095550188','active') ON CONFLICT (id) DO NOTHING`.execute(rdb);
      for (const t of ['outbox_events', 'receipts', 'payments']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(rdb);
      await sql`DELETE FROM tickets WHERE tenant_id = ${T}`.execute(rdb);
      for (const id of ids) await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES (${id}, ${T}, ${B}, ${CUST}, 'serving')`.execute(rdb);
      await new KyselyCheckoutRepository(rdb as any, failingAfterVisit()).setStatus(ctx, POS2, 'paid' as any);
      await expect(new SkipLineCheckoutRepository(rdb as any, failingAfterVisit()).recordPaymentAndCloseTicket(ctx, SKIP2, 'cash', 3000, 0)).rejects.toThrow('boom');
      expect((await sql`SELECT aggregate_id FROM outbox_events WHERE tenant_id = ${T} AND event_type = 'visit.completed'`.execute(rdb)).rows).toEqual([]);
      expect((await sql`SELECT status FROM tickets WHERE tenant_id = ${T} ORDER BY id`.execute(rdb)).rows).toEqual([{ status: 'serving' }, { status: 'serving' }]);
      // and the successful finalize on the pool records exactly one
      await new KyselyCheckoutRepository(rdb as any, new OutboxWriter()).setStatus(ctx, POS2, 'paid' as any);
      expect((await sql`SELECT aggregate_id FROM outbox_events WHERE tenant_id = ${T} AND event_type = 'visit.completed'`.execute(rdb)).rows).toEqual([{ aggregate_id: POS2 }]);
    } finally {
      for (const t of ['outbox_events', 'receipts', 'payments']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(rdb).catch(() => undefined);
      await sql`DELETE FROM tickets WHERE tenant_id = ${T}`.execute(rdb).catch(() => undefined);
      await rdb.destroy();
    }
  });
});
