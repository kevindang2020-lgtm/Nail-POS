// loyalty-reward-stock.postgres-race — Loyalty guide (Nov 4 2026) on REAL Postgres: the reward row is locked at redemption,
// so when one unit is left and many members redeem at the same instant exactly one gets it and the rest are refused
// REWARD_OUT_OF_STOCK; a per-member limit of 1 holds the same way for one member redeeming many times at once.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database). PGlite is single-session and cannot interleave.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { LoyaltyProgramRepository, LoyaltyProgramError } from './loyalty-program.repository';

const url = process.env.PG_RACE_URL;
const P = 'a4000000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), RW = id(3), RM = id(4);
const CUST = Array.from({ length: 8 }, (_, i) => id(100 + i));
const KEY = (n: number) => 'a4000000-0000-4000-8000-9' + String(n).padStart(11, '0');
const ctx = { tenantId: T, branchId: B, userId: id(9), role: 'OWNER', permissions: ['pos.customers.view', 'pos.customers.loyalty.edit', 'pos.settings.edit'] };
let db: Kysely<any>; let pool: pg.Pool; let repo: LoyaltyProgramRepository;
const settle = async (ps: Promise<unknown>[]) => (await Promise.allSettled(ps)).map((r) => r.status === 'fulfilled' ? 'ok' : (r.reason instanceof LoyaltyProgramError ? r.reason.code : String(r.reason)));
async function cleanup() {
  for (const t of ['loyalty_redemptions', 'loyalty_ledger', 'customer_loyalty_profiles', 'loyalty_rewards', 'audit_logs', 'customers', 'branches'])
    await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`delete from tenants where id = ${T}`.execute(db).catch(() => undefined);
}

describe.skipIf(!url)('real-Postgres reward stock and per-member limit under concurrent redemptions', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await cleanup();
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Rewards', 'Race Rewards', 'race-rewards', 'RACERW', 'active')`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York')`.execute(db);
    for (const c of CUST) {
      await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${c}, ${T}, ${B}, 'M', 'R', 'M R')`.execute(db);
      await sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points) values (${T}, ${B}, ${c}, 'Regular', 0, 0)`.execute(db);
    }
    await sql`insert into loyalty_rewards (id, tenant_id, title, points_cost, active, reward_type, value_cents, stock_total) values (${RW}, ${T}, 'Last one', 10, true, 'amount_off', 100, 1)`.execute(db);
    await sql`insert into loyalty_rewards (id, tenant_id, title, points_cost, active, reward_type, value_cents, per_member_limit) values (${RM}, ${T}, 'Once each', 10, true, 'amount_off', 100, 1)`.execute(db);
    repo = new LoyaltyProgramRepository(db as never, { record: async () => undefined });
    let n = 0;
    for (const c of CUST) await repo.adjust(ctx, { customerId: c, delta: 500, reason: 'race seed', idempotencyKey: KEY(n++) });
  }, 60_000);
  afterAll(async () => { await cleanup(); await db?.destroy(); });

  it('eight members redeem the last unit at once: exactly one gets it, seven are refused out of stock', async () => {
    const out = await settle(CUST.map((c, i) => repo.redeem(ctx, { customerId: c, rewardId: RW, idempotencyKey: KEY(100 + i) })));
    expect(out.filter((x) => x === 'ok').length).toBe(1);
    expect(out.filter((x) => x === 'REWARD_OUT_OF_STOCK').length).toBe(7);
    const used = (await sql<any>`select count(*)::int n from loyalty_redemptions where tenant_id = ${T} and reward_id = ${RW} and status <> 'void'`.execute(db)).rows[0].n;
    expect(used).toBe(1);
  });

  it('one member redeems a once-each reward six times at once: one succeeds, five hit the member limit', async () => {
    const out = await settle(Array.from({ length: 6 }, (_, i) => repo.redeem(ctx, { customerId: CUST[0]!, rewardId: RM, idempotencyKey: KEY(200 + i) })));
    expect(out.filter((x) => x === 'ok').length).toBe(1);
    expect(out.filter((x) => x === 'REWARD_MEMBER_LIMIT').length).toBe(5);
  });
});
