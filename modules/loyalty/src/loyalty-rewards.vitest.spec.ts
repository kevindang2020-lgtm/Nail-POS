// loyalty-rewards.vitest.spec.ts — Decision 15: owners/managers manage the rewards catalog; every reward is worth
// something (amount or percent); a customer-view role can read but not change it. Real-Postgres part opt-in (PG_RACE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { normalizeRewardInput, RewardValidationError, type LoyaltyContext } from './loyalty.dto';
import { InMemoryLoyaltyRepository } from './loyalty.repository';
import { KyselyLoyaltyRepository } from './loyalty.kysely.repository';
import { LoyaltyService, ForbiddenError } from './loyalty.service';

const owner: LoyaltyContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.customers.view', 'settings.edit'] };
const frontDesk: LoyaltyContext = { tenantId: 't1', branchId: 'b1', userId: 'u2', role: 'FRONT_DESK', permissions: ['pos.customers.view'] };

describe('normalizeRewardInput', () => {
  it('an amount-off and a percent-off reward', () => {
    expect(normalizeRewardInput({ title: ' $10 off ', pointsCost: 500, rewardType: 'amount_off', valueCents: 1000 })).toMatchObject({ title: '$10 off', valueCents: 1000, percent: 0, validDays: null, active: true });
    expect(normalizeRewardInput({ title: '15% off', pointsCost: 800, rewardType: 'percent_off', percent: 15, valueCents: 999, validDays: 60 })).toMatchObject({ percent: 15, valueCents: 0, validDays: 60 });
  });
  it('a reward must be worth something, cost points and have a name', () => {
    for (const bad of [{ title: 'x', pointsCost: 100, rewardType: 'amount_off', valueCents: 0 }, { title: 'x', pointsCost: 100, rewardType: 'percent_off', percent: 0 },
      { title: 'x', pointsCost: 100, rewardType: 'percent_off', percent: 101 }, { title: 'x', pointsCost: 0, rewardType: 'amount_off', valueCents: 100 },
      { title: '  ', pointsCost: 100, rewardType: 'amount_off', valueCents: 100 }, { title: 'x', pointsCost: 100, rewardType: 'amount_off', valueCents: 100, validDays: 0 }])
      expect(() => normalizeRewardInput(bad as any)).toThrow(RewardValidationError);
  });
  it('an edit changes only what it names (archive keeps the value)', () => {
    const cur = { id: 'r1', title: '$10 off', pointsCost: 500, active: true, rewardType: 'amount_off' as const, valueCents: 1000, percent: 0, validDays: null };
    expect(normalizeRewardInput({ active: false }, cur)).toMatchObject({ title: '$10 off', valueCents: 1000, active: false });
  });
});

describe('LoyaltyService rewards', () => {
  it('an owner creates and edits; front desk cannot', async () => {
    const svc = new LoyaltyService(new InMemoryLoyaltyRepository());
    const r = await svc.createReward(owner, { title: '$10 off', pointsCost: 500, rewardType: 'amount_off', valueCents: 1000 });
    expect((await svc.updateReward(owner, r.id, { valueCents: 1500 })).valueCents).toBe(1500);
    await expect(svc.createReward(frontDesk, { title: 'x', pointsCost: 1, rewardType: 'amount_off', valueCents: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.updateReward(frontDesk, r.id, { active: false })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('a reward change is audited with what changed (before → after); an edit that changes nothing writes no row; a failing recorder does not fail the save', async () => {
    const rows: any[] = []; const svc = new LoyaltyService(new InMemoryLoyaltyRepository(), { record: async (_c, i) => { rows.push(i); } });
    const r = await svc.createReward(owner, { title: 'Spring set', pointsCost: 150, rewardType: 'amount_off', valueCents: 500, stockTotal: 25, eligibleTiers: ['VIP'] });
    expect(rows[0]).toMatchObject({ module: 'loyalty', action: 'reward_created', resourceType: 'loyalty_reward', resourceId: r.id });
    expect(rows[0].metadata.changes.stockTotal).toEqual({ from: null, to: 25 });
    await svc.updateReward(owner, r.id, { stockTotal: 40, perMemberLimit: 1 });
    expect(rows[1]).toMatchObject({ action: 'reward_updated' });
    expect(rows[1].metadata.changes).toEqual({ stockTotal: { from: 25, to: 40 }, perMemberLimit: { from: null, to: 1 } });
    await svc.updateReward(owner, r.id, { stockTotal: 40 });
    expect(rows).toHaveLength(2);
    const failing = new LoyaltyService(new InMemoryLoyaltyRepository(), { record: async () => { throw new Error('audit down'); } });
    await expect(failing.createReward(owner, { title: 'x', pointsCost: 1, rewardType: 'amount_off', valueCents: 1 })).resolves.toMatchObject({ title: 'x' });
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a4921000-0000-4000-8000-0000000000a1';
describe.skipIf(!url)('rewards catalog on real Postgres', () => {
  let db: Kysely<any>; let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) }); await sql`delete from loyalty_rewards where tenant_id = ${T}`.execute(db); });
  afterAll(async () => { await sql`delete from loyalty_rewards where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });
  it('create, list, edit, archive — tenant scoped; the table refuses a percent over 100', async () => {
    const repo = new KyselyLoyaltyRepository(db as any); const svc = new LoyaltyService(repo); const c = { ...owner, tenantId: T };
    const r = await svc.createReward(c, { title: '15% off', pointsCost: 800, rewardType: 'percent_off', percent: 15, validDays: 30 });
    expect(await repo.listRewards(c)).toEqual([expect.objectContaining({ id: r.id, rewardType: 'percent_off', percent: 15, validDays: 30, active: true })]);
    expect((await svc.updateReward(c, r.id, { active: false })).active).toBe(false);
    expect(await repo.getReward({ ...c, tenantId: 'f4921000-0000-4000-8000-0000000000ff' }, r.id)).toBeNull();
    await expect(sql`update loyalty_rewards set percent = 150 where id = ${r.id}::uuid`.execute(db)).rejects.toThrow(/loyalty_rewards_value_check/);
  });
});
