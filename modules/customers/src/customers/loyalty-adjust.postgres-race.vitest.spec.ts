// loyalty-adjust.postgres-race.vitest.spec.ts — Smooth Refresh spec §80/§109: two registers adjusting one customer's
// points at the same moment must never lose an adjustment or go negative. TRUE concurrency needs real Postgres (PGlite
// is single-session and merges interleaved transactions). Opt-in: PG_RACE_URL=postgres://... (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCustomersRepository } from './customers.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a2000000-0000-4000-8000-0000000000aa';
const B = 'b2000000-0000-4000-8000-0000000000bb';
const C = 'd2000000-0000-4000-8000-0000000000dd';
const ctx = { tenantId: T, branchId: B, userId: 'e2000000-0000-4000-8000-0000000000ee', role: 'MANAGER', permissions: [] } as any;

let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCustomersRepository;
const balance = async () => Number((await sql<{ b: string }>`select coalesce(sum(points_balance),0)::bigint as b from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${C}`.execute(db)).rows[0].b);
const profiles = async () => Number((await sql<{ n: number }>`select count(*)::int as n from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${C}`.execute(db)).rows[0].n);
const ledger = async () => (await sql<{ amount: string; running_balance: string }>`select amount, running_balance from loyalty_ledger where tenant_id = ${T} and customer_id = ${C} order by created_at, running_balance desc`.execute(db)).rows;

describe.skipIf(!url)('real-Postgres loyalty adjustment races (Smooth Refresh spec §80, §109)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCustomersRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Salon L', 'Race Salon L', 'race-salon-l', 'RACEL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Lia', 'Ng', 'Lia Ng') on conflict (id) do nothing`.execute(db);
  });
  const reset = async () => {
    await sql`delete from loyalty_ledger where tenant_id = ${T}`.execute(db);
    await sql`delete from customer_loyalty_profiles where tenant_id = ${T}`.execute(db);
  };
  afterAll(async () => { await reset().catch(() => undefined); await db?.destroy(); });

  it('ten registers each take 10 points from a 50-point balance at once — exactly five succeed, balance 0, ledger agrees', async () => {
    await reset();
    await repo.adjustLoyaltyPoints(ctx, C, { amount: 50, reason: 'seed' });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => repo.adjustLoyaltyPoints(ctx, C, { amount: -10, reason: 'race' })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((r) => r.status === 'rejected').every((r: any) => /below 0/.test(String(r.reason?.message)))).toBe(true);
    expect(await balance()).toBe(0);
    const rows = await ledger();
    expect(rows).toHaveLength(6);                                             // seed + five deductions, none lost
    expect(rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(0);           // the ledger sums to the balance
  });

  it('ten first-ever adjustments at once create ONE profile and keep every point', async () => {
    await reset();
    await Promise.all(Array.from({ length: 10 }, () => repo.adjustLoyaltyPoints(ctx, C, { amount: 5, reason: 'race' })));
    expect(await profiles()).toBe(1);
    expect(await balance()).toBe(50);
  });

  it('§105: two devices save the same customer version at the same instant — exactly one wins, the other gets VERSION_CONFLICT', async () => {
    const v0 = Number((await sql<{ v: number }>`select record_version as v from customers where id = ${C}`.execute(db)).rows[0].v);
    const results = await Promise.allSettled([
      repo.update(ctx, C, { email: 'device-a@example.com', expectedVersion: v0 }),
      repo.update(ctx, C, { email: 'device-b@example.com', expectedVersion: v0 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost: any = results.find((r) => r.status === 'rejected');
    expect(lost.reason?.code).toBe('VERSION_CONFLICT');
    const row = (await sql<{ v: number; email: string }>`select record_version as v, email from customers where id = ${C}`.execute(db)).rows[0];
    expect(Number(row.v)).toBe(v0 + 1);                                                  // one write, not two
    const winner: any = results.find((r) => r.status === 'fulfilled');
    expect(row.email).toBe(winner.value.email);                                          // the stored value is the winner's
  });
});

