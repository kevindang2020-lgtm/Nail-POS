// loyalty-reward-code.postgres-race.vitest.spec.ts — Decision 15 loyalty step on real Postgres (migration 492): ten
// registers race for one code and exactly one ticket gets it; release puts it back; paid marks it used; the table
// refuses an 'applied' code without a ticket. Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a4920000-0000-4000-8000-0000000000a1', C = 'c4920000-0000-4000-8000-0000000000c1', RW = 'e4920000-0000-4000-8000-0000000000e1';
const tk = (i: number) => `d4920000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const ctx = { tenantId: T, branchId: 'b', userId: 'u', role: 'FRONT_DESK', permissions: [] } as any;
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCheckoutRepository; let rid = '';

describe.skipIf(!url)('reward codes on real Postgres (Decision 15)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCheckoutRepository(db as any);
    await sql`delete from loyalty_redemptions where tenant_id = ${T}`.execute(db);
    const r: any = await sql`insert into loyalty_redemptions (tenant_id, customer_id, reward_id, reward_title, points_spent, code, status, reward_type, value_cents)
      values (${T}, ${C}, ${RW}, '$10 off', 500, 'RDMRACE0001', 'issued', 'amount_off', 1000) returning id`.execute(db);
    rid = String(r.rows[0].id);
  });
  afterAll(async () => { await sql`delete from loyalty_redemptions where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('finds the code with its value snapshot', async () => {
    expect(await repo.findRewardCode(ctx, 'RDMRACE0001')).toMatchObject({ redemptionId: rid, customerId: C, status: 'issued', rewardType: 'amount_off', valueCents: 1000 });
    expect(await repo.findRewardCode({ ...ctx, tenantId: 'f4920000-0000-4000-8000-0000000000ff' }, 'RDMRACE0001')).toBeNull();   // another salon never sees it
  });

  it('ten registers race for one code — exactly one ticket gets it; re-applying on that ticket is idempotent', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.reserveRewardCode(ctx, rid, tk(i + 1))));
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = tk(results.indexOf(true) + 1);
    expect(await repo.rewardCodeForTicket(ctx, winner)).toMatchObject({ status: 'applied', ticketId: winner });
    expect(await repo.reserveRewardCode(ctx, rid, winner)).toBe(true);
    expect(await repo.reserveRewardCode(ctx, rid, tk(99))).toBe(false);
    await repo.releaseRewardCodes(ctx, winner);
    expect(await repo.findRewardCode(ctx, 'RDMRACE0001')).toMatchObject({ status: 'issued', ticketId: null });
  });

  it('paid marks it used, and a used code cannot be reserved again', async () => {
    expect(await repo.reserveRewardCode(ctx, rid, tk(50))).toBe(true);
    await repo.markRewardCodesUsed(ctx, tk(50));
    expect(await repo.findRewardCode(ctx, 'RDMRACE0001')).toMatchObject({ status: 'used' });
    expect(await repo.reserveRewardCode(ctx, rid, tk(51))).toBe(false);
    const row: any = (await sql`select used_at from loyalty_redemptions where id = ${rid}::uuid`.execute(db)).rows[0];
    expect(row.used_at).not.toBeNull();
  });

  it("the table refuses an 'applied' code with no ticket, and a duplicate code in one salon", async () => {
    await expect(sql`update loyalty_redemptions set status = 'applied', ticket_id = null where id = ${rid}::uuid`.execute(db)).rejects.toThrow(/status_check/);
    await expect(sql`insert into loyalty_redemptions (tenant_id, customer_id, reward_id, reward_title, points_spent, code) values (${T}, ${C}, ${RW}, 'x', 1, 'RDMRACE0001')`.execute(db)).rejects.toThrow(/uq_loyalty_redemptions_tenant_code/);
  });
});
