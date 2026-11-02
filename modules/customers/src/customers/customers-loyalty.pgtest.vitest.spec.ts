// customers-loyalty.pgtest — w4 sweep SW-12 (Oct 13 2026): POS → Customer profile → Loyalty showed NO available rewards
// and NO redemption history, and a second branch showed the guest's points as 0. loyalty_rewards / loyalty_redemptions
// are tenant-wide (no branch_id column) but were branch-scoped — PostgreSQL refused both statements ("column branch_id does
// not exist", x144 in the live sweep's PostgreSQL log) and .catch(() => []) emptied them. The loyalty profile is one per
// (tenant, customer) — its branch_id is where it was opened — so filtering it by the CURRENT branch hid it elsewhere.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';

const P = 'c5e80000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), B1 = id('b1'), B2 = id('b2'), C = id('c0'), C2 = id('c2'), R1 = id('f1'), R2 = id('f2');
const ctxAt = (b: string) => ({ tenantId: T, branchId: b, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view'] } as any);
let repo: KyselyCustomersRepository;

beforeAll(async () => {
  const pg: any = await migratedPglite();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Loyal LLC','Loyal','cust-loyal','CLOY01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Main','active','America/New_York'), ($2,$3,'Second','active','America/New_York')`, [B1, B2, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [C, T, B1]);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points, loyalty_tier) values ($1,$2,$3,300,350,'Gold')`, [T, B1, C]);
  // a guest of Main whose loyalty profile was opened when she first earned points at the Second branch
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Bea','Guest','Bea Guest')`, [C2, T, B1]);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points, loyalty_tier) values ($1,$2,$3,120,120,'Silver')`, [T, B2, C2]);
  await q(`insert into loyalty_rewards (id, tenant_id, title, description, points_cost, active) values ($1,$3,'$5 off','Five off',200,true), ($2,$3,'Free mani','Big one',900,true)`, [R1, R2, T]);
  await q(`insert into loyalty_redemptions (tenant_id, customer_id, reward_id, reward_title, points_spent, code) values ($1,$2,$3,'$5 off',50,'LOY-W4')`, [T, C, R1]);
  repo = new KyselyCustomersRepository(kyselyFor(pg) as never);
}, 180_000);

describe('POS → Customer profile → Loyalty', () => {
  it('shows the rewards the guest can afford and their redemption history', async () => {
    const l = await repo.getLoyalty(ctxAt(B1), C);
    expect(l.points).toBe(300);
    expect(l.availableRewards.map((r: any) => r.id)).toEqual([R1]);
    expect(l.redemptions).toHaveLength(1);
  });
  it('a profile opened at ANOTHER branch of the salon still shows (one profile per salon + guest)', async () => {
    const l = await repo.getLoyalty(ctxAt(B1), C2);
    expect(l.points).toBe(120);
    expect(l.tier).toBe('Silver');
  });
});
