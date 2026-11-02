// loyalty-ledger.postgres-race — BUILD_PLAN Phase 10 (audit bug 4) on REAL Postgres: concurrent earns for one customer.
// Before: each writer did `SELECT … FOR UPDATE` on the profile — which locks NOTHING when the customer has no profile
// yet — so two payments captured at once each inserted a profile (two balances for one person), and a redelivered
// payment raced its own first delivery. Now applyLoyaltyEntry takes a per-customer advisory lock first.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database). PGlite is single-session and cannot interleave.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { applyLoyaltyEntry } from './loyalty-ledger.service';

const url = process.env.PG_RACE_URL;
const T = 'a3000000-0000-4000-8000-0000000000aa', B = 'b3000000-0000-4000-8000-0000000000bb', C = 'd3000000-0000-4000-8000-0000000000dd';
const PAY = (n: number) => `e3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db: Kysely<any>; let pool: pg.Pool;
const earn = (n: number, pts: number) => db.transaction().execute((t) => applyLoyaltyEntry(t as any, { tenantId: T, branchId: B, customerId: C, entryType: 'earn', delta: pts, sourceTable: 'payments', sourceId: PAY(n) }));
const reset = async () => { await sql`delete from loyalty_ledger where tenant_id = ${T}`.execute(db); await sql`delete from customer_loyalty_profiles where tenant_id = ${T}`.execute(db); };

describe.skipIf(!url)('real-Postgres concurrent loyalty earns (Phase 10, bug 4)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Ledger', 'Race Ledger', 'race-ledger', 'RACELG', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Rae', 'Ng', 'Rae Ng') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await reset().catch(() => undefined); await sql`delete from customers where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from branches where tenant_id = ${T}`.execute(db).catch(() => undefined); await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('two payments captured at the same instant for a customer with NO profile: one profile, both earns, an unbroken chain', async () => {
    await reset();
    await Promise.all([earn(1, 30), earn(2, 45)]);
    const profiles = (await sql<any>`select points_balance from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${C}`.execute(db)).rows;
    expect(profiles).toEqual([{ points_balance: 75 }]);
    const rows = (await sql<any>`select delta::int d, balance_after::int b from loyalty_ledger where tenant_id = ${T} and customer_id = ${C} order by balance_after`.execute(db)).rows;
    expect(rows.length).toBe(2);
    expect(rows[1].b).toBe(rows[0].b + rows[1].d);                                     // the second saw the first's balance
    expect(rows[0].b).toBe(rows[0].d);
  });

  it('twelve payments + every one redelivered at once: each earns exactly once, sum(delta) = balance', async () => {
    await reset();
    const jobs = Array.from({ length: 12 }, (_, i) => i + 10).flatMap((n) => [earn(n, n), earn(n, n)]);
    const out = await Promise.all(jobs);
    expect(out.filter((r) => r.applied)).toHaveLength(12);
    expect(out.filter((r) => r.duplicate)).toHaveLength(12);
    const sum = Array.from({ length: 12 }, (_, i) => i + 10).reduce((a, b) => a + b, 0);
    const p = (await sql<any>`select points_balance, (select sum(delta)::int from loyalty_ledger where tenant_id = ${T} and customer_id = ${C}) s,
      (select count(*)::int from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${C}) n from customer_loyalty_profiles where tenant_id = ${T} and customer_id = ${C}`.execute(db)).rows[0];
    expect(p).toEqual({ points_balance: sum, s: sum, n: 1 });
  });
});
