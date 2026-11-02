// loyalty-program.pgtest — Loyalty & Rewards mandate (Oct 29 2026), against the REAL schema: the five KPIs from real
// rows (no invented tiers / zeros where data exists), newest-first numbered lists (a new record lands at the top of Page
// 1, a page past the end is clamped, ties break on id), enrol / adjust / redeem / void through the ledger exactly once
// (idempotency keys), balances never negative, voids restore points without inflating lifetime totals, and nothing of
// another salon is ever listed, counted or reachable.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { LoyaltyProgramRepository, LoyaltyProgramError } from './loyalty-program.repository';

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
  await repo.adjust(ctx2, { customerId: CX, delta: 999, reason: 'other salon seed', idempotencyKey: key(900) });
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

  it('adjust: a reason is required, the same key applies once, the balance never goes negative', async () => {
    expect(await code(repo.adjust(ctx, { customerId: C1, delta: 50, reason: '', idempotencyKey: key(1) }))).toBe('LOYALTY_INVALID_ENTRY');
    expect(await code(repo.adjust(ctx, { customerId: C1, delta: 50, reason: 'ok', idempotencyKey: 'not-a-uuid' }))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const a = await repo.adjust(ctx, { customerId: C1, delta: 600, reason: 'Service recovery', idempotencyKey: key(1) });
    const again = await repo.adjust(ctx, { customerId: C1, delta: 600, reason: 'Service recovery', idempotencyKey: key(1) });
    expect(a.balanceAfter).toBe(600); expect(again.duplicate).toBe(true); expect(again.balanceAfter).toBe(600);
    const n = (await q(`select count(*)::int n from loyalty_ledger where tenant_id = $1 and source_id = $2`, [T, key(1)])).rows[0].n;
    expect(n).toBe(1);
    expect(await code(repo.adjust(ctx, { customerId: C1, delta: -601, reason: 'too much', idempotencyKey: key(2) }))).toBe('LOYALTY_INSUFFICIENT_POINTS');
    expect(await code(repo.adjust(ctx, { customerId: CX, delta: 5, reason: 'cross salon', idempotencyKey: key(3) }))).toBe('CUSTOMER_NOT_FOUND');
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
    expect(o.kpis.redemptionsThisMonth).toBe(1); expect(o.kpis.redemptionsPendingThisMonth).toBe(1); expect(o.kpis.pointsRedeemedThisMonth).toBe(200);
    expect(o.kpis.pointsOutstanding).toBe(400); expect(o.kpis.balanceReconciled).toBe(true);
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
    expect(mine).toEqual(['member_enrolled', 'points_adjusted', 'reward_redeemed', 'redemption_voided']);
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
