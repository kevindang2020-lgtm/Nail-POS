// customer-merge.postgres.vitest.spec.ts — Functional Decision 29 on real Postgres: merging a duplicate moves EVERYTHING
// the customer owns to the primary (loyalty points, gift cards, memberships, tags), in one transaction, and logs it; and
// Keep Separate removes a pair from the queue for good. Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCustomersRepository } from './customers.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a7000000-0000-4000-8000-0000000000aa';
const B = 'b7000000-0000-4000-8000-0000000000bb';
const P = 'c7000000-0000-4000-8000-0000000000c1';   // primary
const D = 'c7000000-0000-4000-8000-0000000000c2';   // duplicate (same phone)
const ctx = { tenantId: T, branchId: B, userId: 'e7000000-0000-4000-8000-0000000000ee', role: 'OWNER', permissions: [] } as any;
let db: Kysely<any>; let pool: pg.Pool;
const q = async (s: any) => (await s.execute(db)).rows as any[];

async function seed() {
  for (const t of ['customer_duplicate_decisions', 'customer_merge_logs', 'customer_tags', 'customer_loyalty_profiles', 'gift_cards', 'customer_memberships']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db);
  await sql`delete from customers where tenant_id = ${T}`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, normalized_phone, status) values
    (${P}, ${T}, ${B}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active'),
    (${D}, ${T}, ${B}, 'Maria', 'Lopez', 'Maria Lopez', '+18565550177', '+18565550177', 'active')`.execute(db);
  await sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points) values (${T}, ${B}, ${P}, 100, 100), (${T}, ${B}, ${D}, 40, 60)`.execute(db);
  await sql`insert into gift_cards (tenant_id, branch_id, code, balance_cents, status, customer_id) values (${T}, ${B}, 'MERGE-GC', 2500, 'active', ${D})`.execute(db);
  await sql`insert into customer_tags (tenant_id, customer_id, tag) values (${T}, ${P}, 'vip'), (${T}, ${D}, 'vip'), (${T}, ${D}, 'gel-lover')`.execute(db);
}

describe.skipIf(!url)('real-Postgres customer merge (Decision 29)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Merge Salon', 'Merge Salon', 'merge-salon', 'MERGE', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await db?.destroy(); });

  it('merging moves the duplicate\'s loyalty points, gift card and tags to the primary — nothing is left on the archived profile', async () => {
    await seed();
    const repo = new KyselyCustomersRepository(db as any);
    const group = (await repo.duplicates(ctx)).find((g) => g.members.some((m) => m.customerId === D))!;
    expect(group).toBeTruthy();
    await repo.merge(ctx, group.duplicateGroupId, P);
    const profiles = await q(sql`select customer_id, points_balance, total_earned_points from customer_loyalty_profiles where tenant_id = ${T}`);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ customer_id: P }); expect(Number(profiles[0].points_balance)).toBe(140); expect(Number(profiles[0].total_earned_points)).toBe(160);
    expect((await q(sql`select customer_id from gift_cards where tenant_id = ${T} and code = 'MERGE-GC'`))[0].customer_id).toBe(P);
    expect((await q(sql`select tag from customer_tags where tenant_id = ${T} and customer_id = ${P} order by tag`)).map((r) => r.tag)).toEqual(['gel-lover', 'vip']);
    expect(await q(sql`select tag from customer_tags where tenant_id = ${T} and customer_id = ${D}`)).toEqual([]);
    expect((await q(sql`select status from customers where id = ${D}`))[0].status).toBe('archived');
    const log = await q(sql`select source_customer_id, target_customer_id, merge_summary_json from customer_merge_logs where tenant_id = ${T}`);
    expect(log).toHaveLength(1); expect(log[0]).toMatchObject({ source_customer_id: D, target_customer_id: P });
    expect(log[0].merge_summary_json.moved.loyalty_points).toBe(40);
  });

  it('Keep Separate removes the pair from the queue for good; Not Sure keeps it, flagged', async () => {
    await seed();
    const repo = new KyselyCustomersRepository(db as any);
    const g = (await repo.duplicates(ctx)).find((x) => x.members.some((m) => m.customerId === D))!;
    await repo.decideDuplicate(ctx, g.duplicateGroupId, 'not_sure');
    expect((await repo.duplicates(ctx)).find((x) => x.duplicateGroupId === g.duplicateGroupId)!.notSure).toBe(true);
    await repo.decideDuplicate(ctx, g.duplicateGroupId, 'keep_separate');
    expect((await repo.duplicates(ctx)).some((x) => x.members.some((m) => m.customerId === D))).toBe(false);
  });
});
