// discounts-roi.pgtest — Extras (Coupons & Promotions 13 "Source-Based ROI Explanation" + 14 "Advanced Branch Scorecard") against
// the REAL schema: an offer's details separate associated revenue (distinct paid tickets that used it), discount cost (net of
// reversals), campaign spend (provider cost of linked campaigns' messages — null unless every sent message is costed) and the
// incremental lift (always unverified); the same counts per ticket location; a branch user sees only their location; nothing
// from another salon.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DiscountsScreenRepository } from './discounts-screen';

const P = 'd15c0000-0000-4000-8000-0000001';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B3 = id('b3'), BX = id('b2');
const owner = { tenantId: T, branchId: '', userId: id('ee1'), role: 'OWNER', permissions: ['pos.marketing.view'] };
const branchUser = { ...owner, branchId: B3 };
let pg: any; let repo: DiscountsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Roi LLC','Roi','roi-a','ROA001','active'), ($2,'Other LLC','Other','roi-b','ROB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Haddon','active','America/New_York'), ($4,$5,'Else','active','America/New_York')`, [B, T, B3, BX, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$3,$4,'Mai','Le','Mai Le'), ($2,$3,$4,'Ana','Ho','Ana Ho')`, [id('c1'), id('c2'), T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'X','Y','X Y')`, [id('c9'), T2, BX]);
  for (const [d, t] of [['d1', T], ['d2', T], ['d9', T2]] as const)
    await q(`insert into deals (id, tenant_id, owner_type, kind, title, discount_type, discount_percent, status, requires_code) values ($1,$2,'salon','coupon',$3,'percent',20,'active',true)`, [id(d), t, 'Deal ' + d]);
  const tk = (n: string, tenant: string, br: string, cust: string, total: number, status = 'paid') =>
    q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, subtotal_cents, total_cents, status) values ($1,$2,$3,$4,$5,$6,$6,$7)`, [id(n), tenant, br, id(cust), Number('0x' + n.slice(-2)), total, status]);
  await tk('7a1', T, B, 'c1', 8000); await tk('7a2', T, B, 'c2', 6000); await tk('7a3', T, B3, 'c1', 5000); await tk('7a4', T, B3, 'c2', 9000); await tk('7a5', T, B, 'c2', 4000, 'open'); await tk('7a6', T, B, 'c1', 3000);
  await tk('7a9', T2, BX, 'c9', 7000);
  const red = (n: string, deal: string, tenant: string, br: string, cust: string, ticket: string, status: string, cents: number, reversed = 0) =>
    q(`insert into deal_redemptions (id, deal_id, tenant_id, branch_id, customer_id, ticket_id, amount_discounted_cents, reversed_cents, deal_version, status, kind, applied_at, redeemed_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,'coupon',now(),now(),now())`, [id(n), id(deal), tenant, br, id(cust), id(ticket), cents, reversed, status]);
  await red('e1', 'd1', T, B, 'c1', '7a1', 'redeemed', 2000);
  await red('e2', 'd1', T, B, 'c1', '7a6', 'redeemed', 500);
  await red('e3', 'd1', T, B, 'c2', '7a2', 'partially_reversed', 1500, 500);
  await red('e4', 'd1', T, B3, 'c1', '7a3', 'redeemed', 1000);
  await red('e5', 'd1', T, B3, 'c2', '7a4', 'reversed', 1800);               // fully reversed: not confirmed
  await red('e6', 'd1', T, B, 'c2', '7a5', 'applied', 800);                  // pending at checkout: not confirmed
  await red('e9', 'd9', T2, BX, 'c9', '7a9', 'redeemed', 1400);
  // d1: one campaign, two sent messages, both costed by the provider (0.0079 + 0.0079 USD = 15800 micros → 2 cents)
  await q(`insert into campaigns (id, tenant_id, name, channel, status, deal_id) values ($1,$2,'Spring SMS','sms','completed',$3)`, [id('ca1'), T, id('d1')]);
  for (const [k, pid, cu] of [['5a1', 'pv-1', 'c1'], ['5a2', 'pv-2', 'c2']] as const) {
    await q(`insert into ai_marketing_campaign_sends (id, tenant_id, branch_id, campaign_id, customer_id, channel, message_version, status, provider_id) values ($1,$2,$3,$4,$5,'sms',1,'sent',$6)`, [id(k), T, B, id('ca1'), id(cu), pid]);
    await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id, provider_cost_micros) values ($1,'sms','+18565550000','hi',$2,'delivered',$3,7900)`, [T, id('c1'), pid]);
  }
  // d2: a campaign whose one sent message has no provider cost yet → spend unknown, never estimated
  await q(`insert into campaigns (id, tenant_id, name, channel, status, deal_id) values ($1,$2,'Fall SMS','sms','completed',$3)`, [id('ca2'), T, id('d2')]);
  await q(`insert into ai_marketing_campaign_sends (id, tenant_id, branch_id, campaign_id, customer_id, channel, message_version, status, provider_id) values ($1,$2,$3,$4,$5,'sms',1,'sent','pv-3')`, [id('5a3'), T, B, id('ca2'), id('c2')]);
  await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id) values ($1,'sms','+18565550001','hi',$2,'sent','pv-3')`, [T, id('c2')]);
  repo = new DiscountsScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Discount details — source-based ROI and branch scorecard (read-only)', () => {
  it('separates associated revenue, discount cost, campaign spend and unverified lift', async () => {
    const d = await repo.detail(owner, id('d1')) as any;
    expect(d.roi).toEqual({
      associatedRevenueCents: 8000 + 3000 + 6000 + 5000, associatedTickets: 4, discountCostCents: 2000 + 500 + 1000 + 1000, redemptions: 4,
      campaignSpend: { campaigns: 1, messagesSent: 2, messagesCosted: 2, spendCents: 2, state: 'known' }, incrementalLift: 'unverified',
      // extras Promotions Management 12 (round 10): revenue − discount − the reported spend; explicitly NOT incremental
      measuredContribution: { cents: 22000 - 4500 - 2, basis: 'revenue_minus_discount_and_spend', incremental: false },
    });
    expect(d.roi.discountCostCents).toBe(d.usage.savingsCents);   // the same figure the usage card shows
  });
  it('per location: redemptions, customers, discounts and the paid tickets behind the sales (an open ticket is not sales)', async () => {
    const d = await repo.detail(owner, id('d1')) as any;
    expect(d.byBranch).toEqual([
      { branchId: B, branchName: 'Main', redemptions: 3, uniqueCustomers: 2, discountCents: 3500, associatedTickets: 3, associatedRevenueCents: 17000 },
      { branchId: B3, branchName: 'Haddon', redemptions: 1, uniqueCustomers: 1, discountCents: 1000, associatedTickets: 1, associatedRevenueCents: 5000 },
    ]);
    const mine = await repo.detail(branchUser, id('d1')) as any;   // a branch user: only their location's tickets
    expect(mine.byBranch.map((b: any) => b.branchName)).toEqual(['Haddon']);
    expect(mine.roi.associatedRevenueCents).toBe(5000);
  });
  it('spend is unknown (null) while any sent message is uncosted; an offer with no campaign says so', async () => {
    const d2 = await repo.detail(owner, id('d2')) as any;
    expect(d2.roi.campaignSpend).toEqual({ campaigns: 1, messagesSent: 1, messagesCosted: 0, spendCents: null, state: 'cost_unknown' });
    expect(d2.roi.associatedRevenueCents).toBe(0); expect(d2.byBranch).toEqual([]);
    expect(d2.roi.measuredContribution).toEqual({ cents: null, basis: 'spend_unknown', incremental: false });   // never guessed while spend is unknown
    await expect(repo.detail(owner, id('d9'))).rejects.toThrow();   // another salon's offer is not found
  });
});
