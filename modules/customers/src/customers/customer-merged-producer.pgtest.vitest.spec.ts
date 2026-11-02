// customer-merged-producer.pgtest — BUILD_PLAN Phase 15 (Constitution 8 §78 / §18): customer.merged was registered and
// recorded by nothing. The canonical merge is the salon's own duplicate merge (Functional Decision 29,
// KyselyCustomersRepository.merge): it is the one path that moves everything the customer owns to the primary in one
// transaction. It now records ONE customer.merged per merge, in that transaction, with ids only.
// (The Super Admin support-session "merge" archives the source and snapshots it for a later tenant-confirmed
// reattribution — nothing moves, so it is not this fact and records none.)
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter, validateDomainEvent } from '@aipowersalon/events';
import { KyselyCustomersRepository } from './customers.kysely.repository';

const T = 'a7100000-0000-4000-8000-0000000000aa';
const B = 'b7100000-0000-4000-8000-0000000000bb';
const P = 'c7100000-0000-4000-8000-0000000000c1';   // primary
const D1 = 'c7100000-0000-4000-8000-0000000000c2';  // duplicates (same phone)
const D2 = 'c7100000-0000-4000-8000-0000000000c3';
const U = 'e7100000-0000-4000-8000-0000000000ee';
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: [] } as any;
let db: any;
const merged = async () => (await sql`select event_type, tenant_id, branch_id, aggregate_type, aggregate_id, actor_id, payload_json from outbox_events where event_type = 'customer.merged' and tenant_id = ${T}`.execute(db)).rows as any[];

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Merge Salon', 'Merge Salon', 'merge-ev', 'MERGEV', 'active') on conflict (id) do nothing`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
});
beforeEach(async () => {
  for (const t of ['customer_merge_logs', 'customer_loyalty_profiles']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db);
  await sql`delete from outbox_events where tenant_id = ${T}`.execute(db);
  await sql`delete from customers where tenant_id = ${T}`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone, status) values
    (${P}, ${T}, ${B}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active'),
    (${D1}, ${T}, ${B}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active'),
    (${D2}, ${T}, ${B}, 'Maria', 'L', 'Maria L', '+18565550177', '+18565550177', 'active')`.execute(db);
  await sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points) values (${T}, ${B}, ${D1}, 40, 60)`.execute(db);
});
const groupOf = async (repo: KyselyCustomersRepository) => (await repo.duplicates(ctx)).find((g) => g.members.some((m) => m.customerId === D1))!;

describe('customer.merged — one per merge, inside the merge transaction, ids only', () => {
  it('a merge of a three-profile group records exactly one customer.merged naming the primary and both merged-away ids', async () => {
    const repo = new KyselyCustomersRepository(db, new OutboxWriter());
    const g = await groupOf(repo);
    expect(g.members).toHaveLength(3);
    await repo.merge(ctx, g.duplicateGroupId, P);
    const ev = await merged();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ tenant_id: T, branch_id: B, aggregate_type: 'customer', aggregate_id: P, actor_id: U });
    const logs = (await sql`select id, source_customer_id from customer_merge_logs where tenant_id = ${T} order by source_customer_id`.execute(db)).rows as any[];
    expect(ev[0].payload_json).toEqual({ customerId: P, mergedCustomerIds: [D1, D2], mergeLogIds: logs.map((l) => l.id) });
  });
  it('the payload carries no name, phone or email (§95) and the envelope validates', async () => {
    const repo = new KyselyCustomersRepository(db, new OutboxWriter());
    await repo.merge(ctx, (await groupOf(repo)).duplicateGroupId, P);
    const [ev] = await merged();
    const text = JSON.stringify(ev.payload_json);
    for (const pii of ['Maria', 'Lopez', '5550177', '@']) expect(text).not.toContain(pii);
    expect(validateDomainEvent({ eventId: '0b8f8a8e-1c1e-4a3e-9a51-1f8e2b7c9d10', eventType: 'customer.merged' as any, eventVersion: 1, occurredAt: new Date(0).toISOString(), tenantId: T, aggregateType: 'customer', aggregateId: P, correlationId: 'c', payload: ev.payload_json })).toEqual([]);
  });
  it('a merge that rolls back records nothing — the event shares the transaction (the archive and the logs roll back with it)', async () => {
    // the event is written, then the transaction fails: if the event were written outside it, it would survive
    const failing = new OutboxWriter();
    const real = failing.write.bind(failing);
    failing.write = async (trx: any, e: any) => { await real(trx, e); if (e.eventType === 'customer.merged') throw new Error('boom after the event'); };
    const repo = new KyselyCustomersRepository(db, failing);
    await expect(repo.merge(ctx, (await groupOf(repo)).duplicateGroupId, P)).rejects.toThrow('boom');
    expect(await merged()).toEqual([]);
    expect(((await sql`select count(*)::int as n from customer_merge_logs where tenant_id = ${T}`.execute(db)).rows[0] as any).n).toBe(0);
    expect(((await sql`select status from customers where id = ${D1}`.execute(db)).rows[0] as any).status).toBe('active');
  });
  it('a refused merge (primary not in the group) records nothing', async () => {
    const repo = new KyselyCustomersRepository(db, new OutboxWriter());
    expect(await repo.merge(ctx, (await groupOf(repo)).duplicateGroupId, 'c7100000-0000-4000-8000-0000000000ff')).toBeNull();
    expect(await merged()).toEqual([]);
  });
});

// On PGlite every handle is ONE session, so an event written through the root handle instead of the transaction would
// still roll back with it and the test above could not tell. On real Postgres (a pool) it can: opt-in, PG_RACE_URL=… (a
// migrated database), the same lane as the other real-Postgres merge test.
const url = process.env.PG_RACE_URL;
describe.skipIf(!url)('real Postgres: the event shares the merge transaction', () => {
  it('the merge fails after the event is written → no event, no merge log, the duplicate still active', async () => {
    const { Kysely, PostgresDialect } = await import('kysely');
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    const rdb = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    try {
      await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Merge Salon', 'Merge Salon', 'merge-ev', 'MERGEV', 'active') on conflict (id) do nothing`.execute(rdb);
      await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(rdb);
      for (const t of ['customer_merge_logs', 'customer_loyalty_profiles', 'outbox_events']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(rdb);
      await sql`delete from customers where tenant_id = ${T}`.execute(rdb);
      await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone, status) values
        (${P}, ${T}, ${B}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active'),
        (${D1}, ${T}, ${B}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active')`.execute(rdb);
      const failing = new OutboxWriter();
      const real = failing.write.bind(failing);
      failing.write = async (trx: any, e: any) => { await real(trx, e); if (e.eventType === 'customer.merged') throw new Error('boom after the event'); };
      const repo = new KyselyCustomersRepository(rdb as any, failing);
      const g = (await repo.duplicates(ctx)).find((x) => x.members.some((m) => m.customerId === D1))!;
      await expect(repo.merge(ctx, g.duplicateGroupId, P)).rejects.toThrow('boom');
      expect((await sql`select id from outbox_events where tenant_id = ${T} and event_type = 'customer.merged'`.execute(rdb)).rows).toEqual([]);
      expect((await sql`select id from customer_merge_logs where tenant_id = ${T}`.execute(rdb)).rows).toEqual([]);
      // and a successful merge on the pool records exactly one
      const ok = new KyselyCustomersRepository(rdb as any, new OutboxWriter());
      await ok.merge(ctx, g.duplicateGroupId, P);
      expect((await sql`select aggregate_id from outbox_events where tenant_id = ${T} and event_type = 'customer.merged'`.execute(rdb)).rows).toEqual([{ aggregate_id: P }]);
    } finally {
      for (const t of ['customer_merge_logs', 'customer_loyalty_profiles', 'outbox_events']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(rdb).catch(() => undefined);
      await rdb.destroy();
    }
  });
});
