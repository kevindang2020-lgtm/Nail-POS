// loyalty-program.pgtest — Loyalty & Rewards mandate (Oct 29 2026), against the REAL schema: the five KPIs from real
// rows (no invented tiers / zeros where data exists), newest-first numbered lists (a new record lands at the top of Page
// 1, a page past the end is clamped, ties break on id), enrol / adjust / redeem / void through the ledger exactly once
// (idempotency keys), balances never negative, voids restore points without inflating lifetime totals, and nothing of
// another salon is ever listed, counted or reachable.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { LoyaltyProgramRepository, LoyaltyProgramError } from './loyalty-program.repository';
import { applyLoyaltyEntry } from './loyalty-ledger.service';

const P = 'c5e81000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2');
const C1 = id('c1'), C2 = id('c2'), C3 = id('c3'), CX = id('c9');   // CX belongs to the other salon
const R1 = id('f1'), R2 = id('f2'), R3 = id('f3'), RX = id('f9');
const key = (n: number) => `c5e81000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view', 'pos.customers.loyalty.edit', 'pos.settings.edit'] };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2 };
let repo: LoyaltyProgramRepository; let pg: any;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const audited: { tenantId: string; action: string; resourceId: string | null | undefined }[] = [];
const auditor = { record: async (c: any, i: any) => { audited.push({ tenantId: c.tenantId, action: i.action, resourceId: i.resourceId }); } };
// Nov 5 2026 (Customer Profile & Global Loyalty Protection): staff can no longer adjust points; seed balances the way an
// owner-approved bonus lands — one 'adjust' ledger entry per approval request (key = the request id)
const grant = (c: typeof ctx, customerId: string, delta: number, k: string) => kyselyFor(pg).transaction().execute((trx: any) =>
  applyLoyaltyEntry(trx, { tenantId: c.tenantId, branchId: c.branchId, customerId, entryType: 'adjust', delta, reason: 'Owner-approved bonus (seed)', sourceTable: 'tenant_approval_requests', sourceId: k, legacyType: 'bonus_approved' }));
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof LoyaltyProgramError ? e.code : String((e as Error).message); } }

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Loyal LLC','Loyal','lp-loyal','LPL001','active'), ($2,'Other LLC','Other','lp-other','LPL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/Chicago')`, [B, T, B2, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, created_at) values
      ($1,$5,$6,'Ann','Lee','Ann Lee', now() - interval '40 days'), ($2,$5,$6,'Bea','Tran','Bea Tran', now() - interval '30 days'),
      ($3,$5,$6,'Cara','Vo','Cara Vo', now() - interval '20 days'), ($4,$7,$8,'Xena','Other','Xena Other', now())`, [C1, C2, C3, CX, T, B, T2, B2]);
  // Ann and Bea are members (Ann Gold, enrolled first); Cara is a customer who is not enrolled yet
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, created_at) values
      ($1,$2,$3,'Gold',0,0, now() - interval '20 days'), ($1,$2,$4,'Regular',0,0, now() - interval '10 days')`, [T, B, C1, C2]);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points) values ($1,$2,$3,'Platinum',0,0)`, [T2, B2, CX]);
  await q(`insert into loyalty_rewards (id, tenant_id, title, description, points_cost, active, reward_type, value_cents, created_at) values
      ($1,$4,'$5 off','',200,true,'amount_off',500, now() - interval '3 days'), ($2,$4,'Free polish','',100,false,'amount_off',800, now() - interval '2 days'),
      ($3,$4,'10% off','',300,true,'percent_off',0, now() - interval '1 day')`, [R1, R2, R3, T]);
  await q(`update loyalty_rewards set percent = 10 where id = $1`, [R3]);
  await q(`insert into loyalty_rewards (id, tenant_id, title, points_cost, active, reward_type, value_cents) values ($1,$2,'Other salon reward',10,true,'amount_off',100)`, [RX, T2]);
  repo = new LoyaltyProgramRepository(kyselyFor(pg) as never, auditor);
  // the other salon's member gets points through the same ledger (it must never leak into this salon's numbers)
  await grant(ctx2, CX, 999, key(900));
}, 180_000);

describe('Loyalty & Rewards — real tenant data', () => {
  it('KPIs and tiers come from this salon only; nothing invented', async () => {
    const o = await repo.overview(ctx);
    expect(o.kpis.loyaltyMembers).toBe(2);
    expect(o.kpis.pointsOutstanding).toBe(0);
    expect(o.kpis.activeRewards).toBe(2);
    expect(o.kpis.totalRewards).toBe(3);
    expect(o.kpis.redemptionsThisMonth).toBe(0);
    expect(o.tiers.map((t) => t.tier).sort()).toEqual(['Gold', 'Regular']);   // Platinum is the other salon's
    expect(o.period.timeZone).toBe('America/New_York');
  });

  it('enrolling puts the new member at the top of Page 1; a second enrolment and another salon\'s customer are refused', async () => {
    const m = await repo.enroll(ctx, C3);
    expect(m.customerId).toBe(C3); expect(m.pointsBalance).toBe(0);
    const p1 = await repo.members(ctx, { page: 1, pageSize: 2 });
    expect(p1.items[0]!.customerId).toBe(C3);
    expect(p1.totalItems).toBe(3); expect(p1.totalPages).toBe(2);
    expect(await code(repo.enroll(ctx, C3))).toBe('LOYALTY_ALREADY_ENROLLED');
    expect(await code(repo.enroll(ctx, CX))).toBe('CUSTOMER_NOT_FOUND');
  });

  it('adjust (Nov 5 2026): staff cannot add, set or lower points by hand — every call is refused and nothing moves', async () => {
    for (const b of [{ delta: 50, reason: '' }, { delta: 600, reason: 'Service recovery' }, { delta: -601, reason: 'too much' }]) {
      expect(await code(repo.adjust(ctx, { customerId: C1, ...b, idempotencyKey: key(1) }))).toBe('LOYALTY_DIRECT_EDIT_REFUSED');
    }
    expect(await code(repo.adjust(ctx, { customerId: CX, delta: 5, reason: 'cross salon', idempotencyKey: key(3) }))).toBe('LOYALTY_DIRECT_EDIT_REFUSED');
    expect((await q(`select count(*)::int n from loyalty_ledger where tenant_id = $1 and customer_id = $2`, [T, C1])).rows[0].n).toBe(0);
    // what an owner-approved +600 bonus writes: one ledger entry per approval, applied once
    const a = await grant(ctx, C1, 600, key(1));
    const again = await grant(ctx, C1, 600, key(1));
    expect(a.balanceAfter).toBe(600); expect(again.duplicate).toBe(true); expect(again.balanceAfter).toBe(600);
    expect((await q(`select count(*)::int n from loyalty_ledger where tenant_id = $1 and source_id = $2`, [T, key(1)])).rows[0].n).toBe(1);
  });

  it('redeem: exactly once per key, checked against balance and reward state', async () => {
    expect(await code(repo.redeem(ctx, { customerId: C1, rewardId: R2, idempotencyKey: key(10) }))).toBe('REWARD_NOT_AVAILABLE');   // inactive
    expect(await code(repo.redeem(ctx, { customerId: C2, rewardId: R1, idempotencyKey: key(11) }))).toBe('LOYALTY_INSUFFICIENT_POINTS');
    expect(await code(repo.redeem(ctx, { customerId: C1, rewardId: RX, idempotencyKey: key(12) }))).toBe('REWARD_NOT_FOUND');   // other salon's reward
    const r = await repo.redeem(ctx, { customerId: C1, rewardId: R1, idempotencyKey: key(13) });
    const replay = await repo.redeem(ctx, { customerId: C1, rewardId: R1, idempotencyKey: key(13) });
    expect(r.balanceAfter).toBe(400); expect(replay.duplicate).toBe(true); expect(replay.code).toBe(r.code); expect(replay.balanceAfter).toBe(400);
    expect(await code(repo.redeem(ctx, { customerId: C1, rewardId: R3, idempotencyKey: key(13) }))).toBe('LOYALTY_INVALID_ENTRY');   // key reused for another reward
    const list = await repo.redemptions(ctx, { page: 1, pageSize: 10 });
    expect(list.totalItems).toBe(1); expect(list.items[0]!.status).toBe('issued');
    const o = await repo.overview(ctx);
    // Loyalty guide (Nov 4 2026): an issued code is PENDING — Redemptions / Points Redeemed count completed (used) redemptions only
    expect(o.kpis.redemptionsThisMonth).toBe(0); expect(o.kpis.redemptionsPendingThisMonth).toBe(1); expect(o.kpis.pointsRedeemedThisMonth).toBe(0);
    expect(o.kpis.pointsOutstanding).toBe(400); expect(o.kpis.balanceReconciled).toBe(true);
    await q(`update loyalty_redemptions set status = 'used' where tenant_id = $1 and code = $2`, [T, r.code]);   // the code is used at checkout
    const o2 = await repo.overview(ctx);
    expect(o2.kpis.redemptionsThisMonth).toBe(1); expect(o2.kpis.pointsRedeemedThisMonth).toBe(200); expect(o2.kpis.redemptionsPendingThisMonth).toBe(0);
    await q(`update loyalty_redemptions set status = 'issued' where tenant_id = $1 and code = $2`, [T, r.code]);
  });

  it('void restores the points once, keeps the history, and does not inflate lifetime totals', async () => {
    const before = (await q(`select total_earned_points e, total_redeemed_points r from customer_loyalty_profiles where tenant_id = $1 and customer_id = $2`, [T, C1])).rows[0];
    expect(await code(repo.voidRedemption(ctx, key(13), ''))).toBe('LOYALTY_INVALID_ENTRY');
    expect(await code(repo.voidRedemption(ctx2, key(13), 'other salon'))).toBe('REDEMPTION_NOT_FOUND');
    const v = await repo.voidRedemption(ctx, key(13), 'Guest changed her mind');
    expect(v.balanceAfter).toBe(600); expect(v.redemption.status).toBe('void');
    expect(await code(repo.voidRedemption(ctx, key(13), 'twice'))).toBe('REDEMPTION_NOT_VOIDABLE');
    const after = (await q(`select total_earned_points e, total_redeemed_points r from customer_loyalty_profiles where tenant_id = $1 and customer_id = $2`, [T, C1])).rows[0];
    expect(Number(after.e)).toBe(Number(before.e)); expect(Number(after.r)).toBe(Number(before.r) - 200);
    const d = await repo.redemptionDetail(ctx, key(13));
    expect(d!.ledger.map((l) => l.delta).sort((a, b) => a - b)).toEqual([-200, 200]);
    const o = await repo.overview(ctx);
    expect(o.kpis.redemptionsThisMonth).toBe(0); expect(o.kpis.redemptionsVoidedThisMonth).toBe(1); expect(o.kpis.pointsRedeemedThisMonth).toBe(0);
    expect(o.kpis.balanceReconciled).toBe(true);
    expect(await repo.redemptionDetail(ctx2, key(13))).toBeNull();
    // every committed mutation is audited once (the replays and refusals are not)
    const mine = audited.filter((a) => a.tenantId === T).map((a) => a.action);
    // (points now arrive through the owner-approved bonus — audited by the approvals engine, not here; the refused adjusts are not audited)
    expect(mine).toEqual(['member_enrolled', 'reward_redeemed', 'redemption_voided']);
  });

  it('rewards and the ledger are newest first; a page past the end is clamped; the other salon never appears', async () => {
    const r = await repo.rewards(ctx, { page: 1, pageSize: 2 });
    expect(r.items.map((x) => x.id)).toEqual([R3, R2]);
    const last = await repo.rewards(ctx, { page: 99, pageSize: 2 });
    expect(last.page).toBe(2); expect(last.items.map((x) => x.id)).toEqual([R1]);
    expect((await repo.rewards(ctx, { page: 1, pageSize: 10, status: 'active' })).items.map((x) => x.id)).toEqual([R3, R1]);
    const l = await repo.ledger(ctx, { page: 1, pageSize: 50 });
    expect(l.items.every((x) => [C1, C2, C3].includes(x.customerId))).toBe(true);
    expect(l.items[0]!.reason).toMatch(/voided/i);
    const m = await repo.members(ctx, { page: 1, pageSize: 50, tier: 'Gold' });
    expect(m.items.map((x) => x.customerId)).toEqual([C1]);
    const s = await repo.members(ctx, { page: 1, pageSize: 50, q: 'bea' });
    expect(s.items.map((x) => x.customerId)).toEqual([C2]);
  });
});

// Loyalty guide (Nov 4 2026): a reward's dates, stock, per-member limit and eligible tiers are checked atomically at redemption
describe('Loyalty & Rewards — reward availability rules', () => {
  const RR = id('fa1');
  it('upcoming / expired refuse; stock and the per-member limit stop at the cap; an ineligible tier is refused; the catalog says why', async () => {
    await grant(ctx, C1, 5000, key(950));   // Ann (Gold)
    await grant(ctx, C2, 5000, key(951));   // Bea (Regular)
    await q(`insert into loyalty_rewards (id, tenant_id, title, points_cost, active, reward_type, value_cents, starts_on) values ($1,$2,'Ruled reward',10,true,'amount_off',100, current_date + 30)`, [RR, T]);
    expect(await code(repo.redeem(ctx, { customerId: C1, rewardId: RR, idempotencyKey: key(960) }))).toBe('REWARD_NOT_STARTED');
    await q(`update loyalty_rewards set starts_on = null, ends_on = current_date - 30 where id = $1`, [RR]);
    expect(await code(repo.redeem(ctx, { customerId: C1, rewardId: RR, idempotencyKey: key(961) }))).toBe('REWARD_EXPIRED');
    expect((await repo.rewards(ctx, { page: 1, pageSize: 20 })).items.find((r) => r.id === RR)?.availability).toBe('expired');
    await q(`update loyalty_rewards set ends_on = null, eligible_tiers = '{Gold}', per_member_limit = 1, stock_total = 2 where id = $1`, [RR]);
    expect(await code(repo.redeem(ctx, { customerId: C2, rewardId: RR, idempotencyKey: key(962) }))).toBe('REWARD_TIER_NOT_ELIGIBLE');   // Bea is Regular
    expect((await repo.redeem(ctx, { customerId: C1, rewardId: RR, idempotencyKey: key(963) })).duplicate).toBe(false);
    expect(await code(repo.redeem(ctx, { customerId: C1, rewardId: RR, idempotencyKey: key(964) }))).toBe('REWARD_MEMBER_LIMIT');
    await q(`update loyalty_rewards set eligible_tiers = null, per_member_limit = null where id = $1`, [RR]);
    expect((await repo.redeem(ctx, { customerId: C2, rewardId: RR, idempotencyKey: key(965) })).duplicate).toBe(false);
    expect(await code(repo.redeem(ctx, { customerId: C2, rewardId: RR, idempotencyKey: key(966) }))).toBe('REWARD_OUT_OF_STOCK');   // 2 of 2 used up
    const row = (await repo.rewards(ctx, { page: 1, pageSize: 20 })).items.find((r) => r.id === RR)!;
    expect(row).toMatchObject({ availability: 'out_of_stock', stockTotal: 2, stockLeft: 0 });
  });
  it('the last unit in stock goes once (the concurrent case is in loyalty-ledger.postgres-race on real PostgreSQL)', async () => {
    const RL = id('fa2');
    await q(`insert into loyalty_rewards (id, tenant_id, title, points_cost, active, reward_type, value_cents, stock_total) values ($1,$2,'Last one',10,true,'amount_off',100,1)`, [RL, T]);
    expect((await repo.redeem(ctx, { customerId: C1, rewardId: RL, idempotencyKey: key(970) })).duplicate).toBe(false);
    expect(await code(repo.redeem(ctx, { customerId: C2, rewardId: RL, idempotencyKey: key(971) }))).toBe('REWARD_OUT_OF_STOCK');
  });
});

// Loyalty guide (Nov 4 2026) "Manage Tiers" + member filters: configured tiers with threshold and benefits, rename relabels
// members and reward rules in one transaction, a held tier cannot be retired, a member moves only to a real tier, all audited
describe('Loyalty & Rewards — Manage Tiers and member filters', () => {
  it('create / rename / retire tiers with validation; renaming relabels members and reward eligibility; every change audited', async () => {
    const before = audited.length;
    expect(await code(repo.saveTier(ctx, { name: '  ' }))).toBe('LOYALTY_TIER_INVALID');
    const gold = await repo.saveTier(ctx, { name: 'Gold', rank: 2, minPoints: 1000, benefits: 'Free polish change' });
    expect(gold).toMatchObject({ name: 'Gold', minPoints: 1000, members: 1, active: true });   // Ann was already Gold
    expect(await code(repo.saveTier(ctx, { name: 'gold' }))).toBe('LOYALTY_TIER_EXISTS');
    const silver = await repo.saveTier(ctx, { name: 'Silver', rank: 1, minPoints: 500 });
    expect(silver.members).toBe(0);
    const ov = await repo.overview(ctx);
    expect(ov.tiers.find((t) => t.tier === 'Gold')).toMatchObject({ configured: true, minPoints: 1000, benefits: 'Free polish change' });
    expect(ov.tiers.find((t) => t.tier === 'Silver')).toMatchObject({ members: 0, configured: true });   // configured, nobody yet — still listed
    const RG = id('fa3');
    await q(`insert into loyalty_rewards (id, tenant_id, title, points_cost, active, reward_type, value_cents, eligible_tiers) values ($1,$2,'Gold perk',10,true,'amount_off',100,'{Gold}')`, [RG, T]);
    const renamed = await repo.saveTier(ctx, { id: gold.id, name: 'Gold Club', rank: 2, minPoints: 1000, benefits: 'Free polish change' });
    expect(renamed).toMatchObject({ name: 'Gold Club', members: 1 });
    expect((await repo.members(ctx, { page: 1, pageSize: 50, tier: 'Gold Club' })).items.map((m) => m.customerId)).toEqual([C1]);
    expect((await q(`select eligible_tiers from loyalty_rewards where id = $1`, [RG])).rows[0].eligible_tiers).toEqual(['Gold Club']);
    expect(await code(repo.saveTier(ctx, { id: gold.id, name: 'Gold Club', active: false }))).toBe('LOYALTY_TIER_IN_USE');   // Ann still holds it
    expect(await code(repo.saveTier(ctx, { id: id('fff'), name: 'Nope' }))).toBe('LOYALTY_TIER_NOT_FOUND');
    expect(await code(repo.saveTier(ctx2, { id: silver.id, name: 'Stolen' }))).toBe('LOYALTY_TIER_NOT_FOUND');   // another salon cannot touch it
    const acts = audited.slice(before).map((a) => a.action);
    expect(acts).toEqual(['tier_created', 'tier_created', 'tier_updated']);
    const list = await repo.tierList(ctx);
    expect(list.items.map((t) => t.name)).toEqual(['Silver', 'Gold Club']);   // by rank
    expect(list.unconfigured.map((u) => u.name)).toContain('Regular');
  });
  it('a member moves only to an active configured tier (or the default); the move is audited with a reason; retiring then works', async () => {
    const list = await repo.tierList(ctx); const gc = list.items.find((t) => t.name === 'Gold Club')!;
    expect(await code(repo.setMemberTier(ctx, { customerId: C1, tier: 'Diamond', reason: 'promo' }))).toBe('LOYALTY_TIER_NOT_FOUND');
    expect(await code(repo.setMemberTier(ctx, { customerId: C1, tier: 'Silver', reason: '' }))).toBe('LOYALTY_TIER_INVALID');
    expect(await code(repo.setMemberTier(ctx, { customerId: CX, tier: 'Silver', reason: 'other salon' }))).toBe('LOYALTY_NOT_ENROLLED');
    const before = audited.length;
    expect((await repo.setMemberTier(ctx, { customerId: C1, tier: 'silver', reason: 'downgrade after review' })).tier).toBe('Silver');
    expect(audited.slice(before).map((a) => a.action)).toEqual(['member_tier_changed']);
    expect((await repo.saveTier(ctx, { id: gc.id, name: 'Gold Club', active: false })).active).toBe(false);   // nobody holds it now
    expect(await code(repo.setMemberTier(ctx, { customerId: C1, tier: 'Gold Club', reason: 'retired tier' }))).toBe('LOYALTY_TIER_NOT_FOUND');
    expect((await repo.setMemberTier(ctx, { customerId: C1, tier: 'Regular', reason: 'back to default' })).tier).toBe('Regular');
  });
  it('members filter by customer status and sort by newest enrolment / balance / activity', async () => {
    await q(`update customers set status = 'inactive' where id = $1`, [C2]);
    expect((await repo.members(ctx, { page: 1, pageSize: 50, status: 'inactive' })).items.map((m) => m.customerId)).toEqual([C2]);
    expect((await repo.members(ctx, { page: 1, pageSize: 50, status: 'active' })).items.map((m) => m.customerId)).not.toContain(C2);
    await q(`update customers set status = 'active' where id = $1`, [C2]);
    const byBal = (await repo.members(ctx, { page: 1, pageSize: 50, sort: 'balance' })).items;
    expect(byBal.map((m) => m.pointsBalance)).toEqual([...byBal.map((m) => m.pointsBalance)].sort((a, b) => b - a));
    const newest = (await repo.members(ctx, { page: 1, pageSize: 50 })).items;
    expect(newest[0]!.customerId).toBe(C3);   // enrolled last
    const act = (await repo.members(ctx, { page: 1, pageSize: 50, sort: 'activity' })).items;
    const ts = act.map((m) => m.lastActivityAt).filter(Boolean) as string[];
    expect(ts).toEqual([...ts].sort().reverse());
  });
});
