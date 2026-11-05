// customer-rewards.pgtest.vitest.spec.ts — Decision 15 from the customer app on real Postgres: only rewards worth
// something are offered (with their value); redeeming one takes the points and issues a code that carries a snapshot of
// the value and its expiry; a zero-value reward cannot be redeemed (it used to take points for a code worth nothing).
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCustomerRepository } from './customer.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a4922000-0000-4000-8000-0000000000a1', B = 'b4922000-0000-4000-8000-0000000000b1', C = 'c4922000-0000-4000-8000-0000000000c1';
const ctx = { tenantId: T, customerId: C } as any;
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCustomerRepository; let good = ''; let zero = ''; let pct = '';

describe.skipIf(!url)('customer rewards (Decision 15)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCustomerRepository(db as any);
    for (const t of ['loyalty_redemptions', 'loyalty_rewards', 'customer_notifications', 'customer_loyalty_profiles']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db);
    await sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance) values (${T}, ${B}, ${C}, 2000)`.execute(db);
    const ins = async (title: string, type: string, value: number, percent: number, days: number | null) => String(((await sql`insert into loyalty_rewards (tenant_id, title, points_cost, active, reward_type, value_cents, percent, valid_days) values (${T}, ${title}, 500, true, ${type}, ${value}, ${percent}, ${days}) returning id`.execute(db)).rows[0] as any).id);
    good = await ins('$10 off', 'amount_off', 1000, 0, 60); zero = await ins('Old reward', 'amount_off', 0, 0, null); pct = await ins('15% off', 'percent_off', 0, 15, null);
  });
  afterAll(async () => { for (const t of ['loyalty_redemptions', 'loyalty_rewards', 'customer_notifications', 'customer_loyalty_profiles']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('only rewards worth something are offered, with their value', async () => {
    const v = await repo.listRewards(ctx, C);
    expect(v.rewards.map((r: any) => [r.title, r.valueLabel, r.validDays])).toEqual(expect.arrayContaining([['$10 off', '$10.00 off', 60], ['15% off', '15% off', null]]));
    expect(v.rewards.find((r: any) => r.id === zero)).toBeUndefined();
  });

  it('redeeming takes the points and issues a code with the value snapshot and expiry', async () => {
    const before = Date.now();
    const r: any = await repo.redeemReward(ctx, C, good);
    expect(r.ok).toBe(true);
    const row: any = (await sql`select status, reward_type, value_cents, percent, expires_at, code from loyalty_redemptions where tenant_id = ${T} and reward_id = ${good}::uuid`.execute(db)).rows[0];
    expect(row).toMatchObject({ status: 'issued', reward_type: 'amount_off', value_cents: 1000, percent: 0 });
    const days = (new Date(row.expires_at).getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(59.9); expect(days).toBeLessThan(60.1);
    expect(await repo.loyaltyPoints(ctx, C)).toBe(1500);
    // editing the reward afterwards does not change the issued code
    await sql`update loyalty_rewards set value_cents = 5000 where id = ${good}::uuid`.execute(db);
    expect(((await sql`select value_cents from loyalty_redemptions where code = ${row.code}`.execute(db)).rows[0] as any).value_cents).toBe(1000);
  });

  it('a zero-value reward cannot be redeemed, and costs no points', async () => {
    const r: any = await repo.redeemReward(ctx, C, zero);
    expect(r).toMatchObject({ ok: false });
    expect(await repo.loyaltyPoints(ctx, C)).toBe(1500);
  });

  it('a percent reward snapshots its percent', async () => {
    expect(((await repo.redeemReward(ctx, C, pct)) as any).ok).toBe(true);
    expect(((await sql`select reward_type, percent, value_cents, expires_at from loyalty_redemptions where tenant_id = ${T} and reward_id = ${pct}::uuid`.execute(db)).rows[0] as any)).toMatchObject({ reward_type: 'percent_off', percent: 15, value_cents: 0, expires_at: null });
  });
});
