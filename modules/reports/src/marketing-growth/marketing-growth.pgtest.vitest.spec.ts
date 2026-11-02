// marketing-growth.pgtest — Marketing & Growth Complete Build Guide (30 Oct 2026) §18, against the REAL schema (every migration).
//   GATE 0      loyalty 1,298 points: Σ balances vs Σ ledger (a planted gap is a defect with the amount); roll-forward
//               opening + earn + redeem + reverse + adjust + merge = closing; gift-card balance vs last ledger entry;
//               referral self-referral + duplicate referred customer excluded from the verified value; typed campaign
//               revenue never counted; promotion counter vs ledger; review spam + "0 ★ with no reviews" → N/A
//   Search      partial name / phone digits / e-mail / id; campaigns / offers / referrals / reviews; gift cards ONLY by an
//               exact last 4 (never partial, never a balance); page 2 of a scope; another salon's customer is invisible
//   Activity    newest first, exact totals, 10 / 20 pages, type filter, salon-local day boundaries (23:30 New York)
//   Journey     one customer's events only, consent state, a shared phone stays two customers; another salon's id → 404
//   Economics   sends without a provider cost → spend N/A (never 0) and ROI N/A; no sends → no spend; Σ rows = headline;
//               self-referral rewards are not a reward cost
//   Security    a branch-confined user asking for another branch → 403 BRANCH_NOT_AUTHORIZED
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RetentionRepository } from '@aipowersalon/customers';
import { CampaignCenter } from '@aipowersalon/communications';
import { MarketingGrowthRepository, MarketingGrowthError } from './marketing-growth.repository';

const P = 'f6a74000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B3 = id('b3'), B2 = id('b2');
const [AVA, BEN, CAT, DAN, EVE, FAY, X] = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c99'].map(id);
const PERMS = ['pos.customers.view', 'pos.marketing.manage', 'pos.marketing.view'];
const ctx: any = { tenantId: T, branchId: B, userId: id('e01'), role: 'OWNER', permissions: PERMS };
let pg: any; let db: any; let repo: MarketingGrowthRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof MarketingGrowthError ? e.code : String((e as Error).message); } }
let n = 0;
const bal: Record<string, number> = {};

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  repo = new MarketingGrowthRepository(db, new RetentionRepository(db), new CampaignCenter(db, async () => { throw new Error('read-only'); }));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot Nail Salon','mg-pilot','MGP001','active'), ($2,'Other LLC','Other Nails','mg-other','MGP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Uptown','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, B3, B2, T2]);
  const cust = (cid: string, tenant: string, first: string, phone: string | null, email: string | null, sms: boolean) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, marketing_email_opt_in, created_at)
       values ($1,$2,$3,$4,'Glow',$4 || ' Glow',$5,$6,$7,false, now() - make_interval(days => $8))`, [cid, tenant, tenant === T ? B : B2, first, phone, email, sms, ++n]);
  await cust(AVA, T, 'Ava', '+12155550101', 'ava@example.com', true);
  await cust(BEN, T, 'Ben', '+12155550102', null, true);
  await cust(CAT, T, 'Cat', '+12155550103', 'cat@example.com', false);
  await cust(DAN, T, 'Dan', '+12155550104', null, true);     // DAN + EVE share a family phone
  await cust(EVE, T, 'Eve', '+12155550104', null, true);
  await cust(FAY, T, 'Fay', '+12155550106', null, true);
  await cust(X, T2, 'Xena', '+12155550199', 'xena@other.test', true);   // another salon
  await q(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms','+12155550102')`, [T]);   // Ben opted out

  // LOYALTY — 1,298 points in all, as photographed. Ava 1,000 + Ben 298; Cat's profile says 50 but her ledger says 40 (a planted gap)
  const led = async (cust0: string, type: string, delta: number, at: string, reason: string | null = null) => {
    bal[cust0] = (bal[cust0] ?? 0) + delta;
    return q(`insert into loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after, source_table, source_id, reason, created_at) values ($1,$2,$3,$4,$5,$7,'test',gen_random_uuid(),$6, ${at})`, [T, B, cust0, type, delta, reason, bal[cust0]]);
  };
  await led(AVA, 'earn', 1100, `now() - interval '60 days'`); await led(AVA, 'redeem', -100, `now() - interval '2 days'`);
  await led(BEN, 'earn', 300, `now() - interval '3 days'`); await led(BEN, 'reverse', -2, `now() - interval '1 day'`);
  await led(CAT, 'earn', 40, `now() - interval '5 days'`);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points) values
    ($1,$2,$3,'Gold',1000,1100,100), ($1,$2,$4,'Regular',298,300,0), ($1,$2,$5,'Regular',50,50,0)`, [T, B, AVA, BEN, CAT]);

  // GIFT CARDS — card 1: $40 owed, ledger agrees; card 2: says $25 owed but its last ledger entry says $20
  await q(`insert into gift_cards (id, tenant_id, branch_id, code, initial_balance_cents, balance_cents, status, customer_id, card_number_last4, reference) values
    ($1,$2,$3,'GCX-1',5000,4000,'partially_redeemed',$4,'4242','GCREF0001'), ($5,$2,$3,'GCX-2',2500,2500,'active',null,'1881','GCREF0002')`, [id('f01'), T, B, AVA, id('f02')]);
  await q(`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, created_at) values
    ($1,$2,$3,'activate',5000,5000, now() - interval '10 days'), ($1,$2,$3,'redeem',-1000,4000, now() - interval '1 day'), ($1,$2,$4,'activate',2000,2000, now() - interval '9 days')`, [T, B, id('f01'), id('f02')]);

  // REFERRALS — Ava → Dan rewarded $10; Fay → Fay (self) rewarded $5; Ava → Eve pending. (A second referral of the same customer is
  // refused by the unique index ux_referral_redemptions_referred, so the duplicate check can only find legacy rows.)
  await q(`insert into customer_referrals (tenant_id, customer_id, code) values ($1,$2,'AVA10'), ($1,$3,'FAY5')`, [T, AVA, FAY]);
  await q(`insert into referral_redemptions (tenant_id, referrer_customer_id, referred_customer_id, code, status, reward_cents, redeemed_at, rewarded_at) values
    ($1,$2,$3,'AVA10','rewarded',1000, now() - interval '20 days', now() - interval '19 days'),
    ($1,$4,$4,'FAY5','rewarded',500, now() - interval '16 days', now() - interval '15 days'), ($1,$2,$5,'AVA10','pending',0, now() - interval '2 days', null)`, [T, AVA, DAN, FAY, EVE]);

  // CAMPAIGNS — "spring into glow" typed revenue $500 / cost $0 (the old "0x"); "Fall glow" sent 2 messages without a provider cost
  await q(`insert into campaigns (id, tenant_id, name, channel, audience_label, audience_size, status, revenue_cents, cost_cents, created_at) values
    ($1,$2,'spring into glow','sms','Everyone',50,'completed',50000,0, now() - interval '30 days'), ($3,$2,'Fall glow','sms','Returning',2,'completed',0,0, now() - interval '3 days')`, [id('d01'), T, id('d02')]);
  await q(`insert into ai_marketing_campaign_sends (tenant_id, branch_id, campaign_id, customer_id, channel, message_version, status, provider_id, created_at) values
    ($1,$2,$3,$4,'sms',1,'sent','SMtest-1', now() - interval '3 days'), ($1,$2,$3,$5,'sms',1,'sent','SMtest-2', now() - interval '3 days')`, [T, B, id('d02'), AVA, DAN]);

  // REVIEWS — 5 ★ and 4 ★, plus a 1 ★ marked spam
  await q(`insert into reviews (tenant_id, branch_id, customer_id, rating, comment, source, is_spam, created_at) values
    ($1,$2,$3,5,'Lovely gel set','google',false, now() - interval '4 days'), ($1,$2,$4,4,'Good','internal',false, now() - interval '6 days'), ($1,$2,null,1,'buy cheap watches','google',true, now() - interval '7 days')`, [T, B, AVA, CAT]);

  // VISITS — Ava: a paid ticket at 23:30 New York yesterday (salon-local day boundary)
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at) values
    ($1,$2,$3,$4,'paid',6500,'70001', ((now() at time zone 'America/New_York')::date - 1 + time '23:30') at time zone 'America/New_York', ((now() at time zone 'America/New_York')::date - 1 + time '23:30') at time zone 'America/New_York')`, [id('ab1'), T, B, AVA]);
  // 25 extra campaigns for paging the activity history
  for (let i = 0; i < 25; i++) await q(`insert into campaigns (tenant_id, name, channel, audience_size, status, created_at) values ($1,$2,'email',0,'draft', now() - make_interval(days => $3))`, [T, `Filler ${String(i).padStart(2, '0')}`, 40 + i]);
}, 240_000);

describe('GATE 0 — reconciliation before UI sign-off', () => {
  it('loyalty: 1,348 points in the profiles vs 1,338 in the ledger → a defect of 10 points naming Cat; roll-forward balances; expiry 0 by construction', async () => {
    const r: any = await repo.reconciliation(ctx, { preset: 'month' });
    const l = r.sections.find((s: any) => s.key === 'loyalty');
    expect(l.values).toMatchObject({ members: 3, pointsOutstandingTenantWide: 1348, ledgerTotal: 1338 });
    const d = l.defects.find((x: any) => x.code === 'loyalty_balance_vs_ledger');
    expect(d).toMatchObject({ amount: 10, unit: 'points', severity: 'high' }); expect(d.examples[0]).toMatchObject({ customer: 'Cat Glow', balance: 50, ledger: 40 });
    expect(l.status).toBe('failed');
    const rf = l.rollForward; expect(rf.balanced).toBe(true); expect(rf.expired).toBe(0);
    expect(rf.opening + rf.earned + rf.redeemed + rf.reversed + rf.adjusted + rf.merged).toBe(rf.closing);
    expect(l.separateLiabilities.note).toMatch(/separate/);
    expect(l.caveats[0]).toMatch(/5,000/);
  });
  it('loyalty without the planted gap: 1,298 points = ledger, ready', async () => {
    await q(`insert into loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after, source_table, source_id, reason) values ($1,$2,$3,'adjust',10,50,'test',gen_random_uuid(),'opening balance correction')`, [T, B, CAT]);
    await q(`update customer_loyalty_profiles set points_balance = 0 where tenant_id = $1 and customer_id = $2`, [T, CAT]);
    await q(`insert into loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after, source_table, source_id, reason) values ($1,$2,$3,'adjust',-50,0,'test',gen_random_uuid(),'test: zero the profile')`, [T, B, CAT]);
    const l = (await repo.reconciliation(ctx, {}) as any).sections.find((s: any) => s.key === 'loyalty');
    expect(l.values).toMatchObject({ pointsOutstandingTenantWide: 1298, ledgerTotal: 1298 });
    expect(l.defects.filter((x: any) => x.code === 'loyalty_balance_vs_ledger')).toEqual([]);
    expect(l.status).toBe('ready');
  });
  it('gift cards: $65 outstanding; card ••1881 says $25 but its ledger says $20 → a $5 defect', async () => {
    const g = (await repo.reconciliation(ctx, {}) as any).sections.find((s: any) => s.key === 'gift_cards');
    expect(g.values).toEqual({ activeCards: 2, outstandingCents: 6500 });
    expect(g.defects.map((d: any) => [d.code, d.amount])).toEqual([['gift_card_balance_vs_ledger', 500]]);
    expect(g.activityInPeriod).toMatchObject({ issuedCents: 7000, redeemedCents: 1000 });
  });
  it('referrals: published $15 counts a self-referral; verified value is $10', async () => {
    const f = (await repo.reconciliation(ctx, {}) as any).sections.find((s: any) => s.key === 'referrals');
    expect(f.values).toMatchObject({ codesIssued: 2, referrals: 3, pending: 1, rewarded: 2, publishedRewardValueCents: 1500, verifiedRewardValueCents: 1000 });
    expect(f.defects.map((d: any) => d.code)).toEqual(['referral_self']);
  });
  it('campaigns: typed revenue $500 is never counted; verified revenue $0, ROI N/A (null), not "0x"', async () => {
    const c = (await repo.reconciliation(ctx, {}) as any).sections.find((s: any) => s.key === 'campaigns');
    expect(c.values).toMatchObject({ legacyRevenueCents: 50000, legacyRevenueOverCost: null, verifiedRevenueCents: 0, verifiedRoi: null });
    expect(c.defects.map((d: any) => d.code)).toEqual(['campaign_roi_zero_for_unknown', 'campaign_revenue_typed']);
  });
  it('reviews: spam is flagged; the average excluding spam is 4.5', async () => {
    const v = (await repo.reconciliation(ctx, {}) as any).sections.find((s: any) => s.key === 'reviews');
    expect(v.values).toMatchObject({ reviews: 3, averageAll: 3.3, averageExcludingSpam: 4.5, spam: 1 });
    expect(v.defects.map((d: any) => d.code)).toEqual(['reviews_spam_in_average']);
  });
  it('another salon sees none of it', async () => {
    const r: any = await repo.reconciliation({ ...ctx, tenantId: T2, branchId: B2 }, {});
    expect(r.sections.find((s: any) => s.key === 'loyalty').values.members).toBe(0);
    expect(r.sections.find((s: any) => s.key === 'gift_cards').values.outstandingCents).toBe(0);
  });
});

describe('search — grouped, server-side, masked', () => {
  it('partial name, phone digits, e-mail and id find the customer; contact details are masked', async () => {
    for (const s of ['ava', '0101', 'ava@example', AVA]) {
      const r: any = await repo.search(ctx, { q: s, scope: 'customers' });
      expect(r.groups[0].items.map((x: any) => x.title)).toContain('Ava Glow');
    }
    const r: any = await repo.search(ctx, { q: 'ava', scope: 'customers' });
    expect(r.groups[0].items[0].sub).toMatch(/••• 0101/); expect(JSON.stringify(r)).not.toMatch(/2155550101|ava@example\.com/);
  });
  it('"all" returns identifiable groups (never flattened) with counts', async () => {
    const r: any = await repo.search(ctx, { q: 'glow' });
    const by = Object.fromEntries(r.groups.map((g: any) => [g.scope, g.count]));
    expect(by).toMatchObject({ customers: 6, campaigns: 2 });
    expect(r.groups.map((g: any) => g.scope)).toEqual(['customers', 'campaigns', 'offers', 'loyalty', 'referrals', 'gift_cards', 'reviews']);
  });
  it('gift cards: an exact last 4 finds the card (masked, no balance); a partial number finds nothing', async () => {
    const hit: any = await repo.search(ctx, { q: '4242', scope: 'gift_cards' });
    expect(hit.groups[0].items).toEqual([expect.objectContaining({ title: 'Gift card •••• 4242' })]);
    expect(JSON.stringify(hit)).not.toMatch(/balance/i); expect(Object.keys(hit.groups[0].items[0]).sort()).toEqual(['at', 'id', 'link', 'sub', 'title']);   // no balance field at all
    for (const s of ['42', '424', '24']) expect((await repo.search(ctx, { q: s, scope: 'gift_cards' }) as any).groups[0].count).toBe(0);
  });
  it('referrals by code and reviews by text', async () => {
    expect((await repo.search(ctx, { q: 'AVA10', scope: 'referrals' }) as any).groups[0].count).toBe(2);
    expect((await repo.search(ctx, { q: 'gel set', scope: 'reviews' }) as any).groups[0].items[0].title).toMatch(/^5 ★/);
  });
  it('a scope pages beyond page 1 with an exact total', async () => {
    const p1: any = await repo.search(ctx, { q: 'filler', scope: 'campaigns', page: 1, pageSize: 10 });
    const p3: any = await repo.search(ctx, { q: 'filler', scope: 'campaigns', page: 3, pageSize: 10 });
    expect(p1.groups[0].pagination).toMatchObject({ totalItems: 25, totalPages: 3 }); expect(p3.groups[0].items.length).toBe(5);
    expect(p1.groups[0].items[0].title).toBe('Filler 00');   // newest first
  });
  it('another salon\'s customer is invisible — no row, no count', async () => {
    const r: any = await repo.search(ctx, { q: 'xena' });
    expect(r.total).toBe(0);
  });
  it('one character is not a search', async () => { expect((await repo.search(ctx, { q: 'a' }) as any).groups).toEqual([]); });
});

describe('activity history and the customer journey', () => {
  it('newest first, exact total, 10 / 20 pages, type filter', async () => {
    const a: any = await repo.activity(ctx, { pageSize: 10 });
    const b: any = await repo.activity(ctx, { pageSize: 20, page: 2 });
    expect(a.items.length).toBe(10); expect(a.pagination.totalItems).toBe(b.pagination.totalItems);
    const at = a.items.map((x: any) => x.at); expect([...at].sort().reverse()).toEqual(at);
    const lo: any = await repo.activity(ctx, { type: 'loyalty', pageSize: 50 });
    expect(lo.items.every((x: any) => x.type === 'loyalty')).toBe(true); expect(lo.pagination.totalItems).toBe(7);   // 5 fixture rows + 2 corrections
    expect(await code(repo.activity(ctx, { type: 'bogus' }))).toBe('MKT_GROWTH_INVALID_FILTER');
  });
  it('salon-local days: a visit paid at 23:30 New York yesterday is yesterday, not today', async () => {
    const y = (await q(`select ((now() at time zone 'America/New_York')::date - 1)::text as d`)).rows[0].d;
    const t = (await q(`select ((now() at time zone 'America/New_York')::date)::text as d`)).rows[0].d;
    const jy: any = await repo.journey(ctx, AVA, { type: 'visit', preset: 'custom', from: y, to: y });
    const jt: any = await repo.journey(ctx, AVA, { type: 'visit', preset: 'custom', from: t, to: t });
    expect(jy.timeline.pagination.totalItems).toBe(1); expect(jt.timeline.pagination.totalItems).toBe(0);
    expect(await code(repo.activity(ctx, { preset: 'custom', from: t, to: y }))).toBe('MKT_GROWTH_INVALID_FILTER');
  });
  it('journey: only this customer\'s events; consent shown; a shared phone stays two customers', async () => {
    const j: any = await repo.journey(ctx, DAN, { pageSize: 50 });
    expect(j.customer).toMatchObject({ name: 'Dan Glow', phone: '••• 0104', sharedPhoneProfiles: 1, segment: 'never_visited' });
    expect(j.privacy).toMatch(/NOT merged/);
    expect(j.timeline.items.map((x: any) => x.type).sort()).toEqual(['message', 'referral']);
    const b: any = await repo.journey(ctx, BEN, {});
    expect(b.consent.sms).toBe('opted_out');
    expect((await repo.journey(ctx, CAT, {}) as any).consent.sms).toBe('no_consent');
  });
  it('another salon\'s customer id → 404 CUSTOMER_NOT_FOUND', async () => {
    expect(await code(repo.journey(ctx, X, {}))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(repo.journey(ctx, 'not-a-uuid', {}))).toBe('CUSTOMER_NOT_FOUND');
  });
});

describe('economics — Marketing Cost & Profit', () => {
  it('sends without a provider cost → spend N/A and ROI N/A (never 0); no sends → no spend; Σ rows = headline', async () => {
    const e: any = await repo.economics(ctx, {});
    const fall = e.campaigns.find((c: any) => c.name === 'Fall glow'); const spring = e.campaigns.find((c: any) => c.name === 'spring into glow');
    expect(fall).toMatchObject({ sent: 2, spendCents: null, costState: 'missing', roi: null, roas: null });
    expect(spring).toMatchObject({ sent: 0, spendCents: 0, costState: 'no_spend', attributedRevenueCents: 0 });
    expect(e.totals).toMatchObject({ spendCents: null, campaignsMissingCost: 1, roi: null, roas: null, attributedRevenueCents: 0 });
    expect(e.reconciliation.reconciled).toBe(true);
    expect(e.programCosts).toMatchObject({ referralRewardCents: 1000, referralRewards: 1 });   // Fay's self-referral is not a cost
    expect(e.formulas.margin).toMatch(/Not available/);
  });
});

describe('branch security', () => {
  it('a branch-confined user asking for another branch → 403 BRANCH_NOT_AUTHORIZED', async () => {
    const confined = { ...ctx, role: 'MANAGER', authz: { scope: 'BRANCH', branchIds: [B] } };
    expect(await code(repo.activity(confined, { branch: B3 }))).toBe('BRANCH_NOT_AUTHORIZED');
    expect(await code(repo.activity(confined, { branch: B }))).toBe('ok');
  });
});
