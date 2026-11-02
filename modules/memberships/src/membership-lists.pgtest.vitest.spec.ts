// membership-lists.pgtest — Membership Overview mandate (Oct 29 2026), against the REAL schema: the five KPIs (Expiring
// Soon = the next 7 days only, Canceled This Month in the salon's month, both spellings of "canceled"), the analytics
// denominators the panels print, the View All lists (newest enrolment / event first, filters, search, page clamping), the
// Revenue click-through (this month's succeeded payments only), Plan Performance and Manage Discounts — and no row of
// another salon in any of them.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MembershipListsRepository } from './membership-lists';
import { KyselyMembershipsRepository } from './memberships.kysely.repository';

const P = 'c5e83000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2');
const PL1 = id('f1'), PL2 = id('f2'), V1 = id('e1'), V2 = id('e2'), PLX = id('f9'), VX = id('e9');
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.memberships.view'] };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let lists: MembershipListsRepository; let ov: KyselyMembershipsRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Club LLC','Club','mo-club','MOC001','active'), ($2,'Other LLC','Other','mo-other','MOC002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into membership_plans (id, tenant_id, name, status, created_at) values ($1,$3,'VIP Nail Club','active', now() - interval '60 days'), ($2,$3,'Basic Glow','active', now() - interval '10 days')`, [PL1, PL2, T]);
  await q(`insert into membership_plans (id, tenant_id, name, status) values ($1,$2,'Other Club','active')`, [PLX, T2]);
  await q(`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, billing_interval, price_cents, is_custom_pricing) values ($1,$2,$3,1,'month',0,true), ($4,$5,$3,1,'month',3900,false)`, [V1, PL1, T, V2, PL2]);
  await q(`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, billing_interval, price_cents) values ($1,$2,$3,1,'month',1000)`, [VX, PLX, T2]);
  await q(`update membership_plans set current_version_id = case id when $1 then $2::uuid when $3 then $4::uuid when $5 then $6::uuid end where id in ($1,$3,$5)`, [PL1, V1, PL2, V2, PLX, VX]);
  await q(`insert into membership_benefits (plan_version_id, tenant_id, benefit_type, label, percent) values ($1,$2,'percent_discount','Member discount',15)`, [V1, T]);
  const names = ['Mai Le', 'mai le', 'Tina Vo', 'Ana Ho', 'Kim Do', 'Lan Ng', 'Rosa Ty'];
  for (let i = 0; i < names.length; i++) {
    const [f, l] = names[i]!.split(' ');
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,$4,$5,$6,$7)`, [id('c0' + i), T, B, f, l, names[i], '+1215555010' + i]);
  }
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Xena','Other','Xena Other')`, [id('c99'), T2, B2]);
  const cm = (n: number, plan: string, ver: string, status: string, startedDaysAgo: number, extra = '') =>
    q(`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, started_at, next_billing_at ${extra ? ', ' + extra.split('=')[0] : ''})
       values ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(days => $8), now() + interval '20 days' ${extra ? ', ' + extra.split('=')[1] : ''})`, [id('d0' + n), T, B, id('c0' + n), plan, ver, status, startedDaysAgo]);
  await cm(0, PL1, V1, 'active', 50);                                                          // Mai Le
  await cm(1, PL1, V1, 'active', 40);                                                          // mai le — a DIFFERENT person (never merged)
  await cm(2, PL2, V2, 'active', 5, 'term_end_at=now() + interval \'3 days\'');                // expiring in 3 days
  await cm(3, PL2, V2, 'active', 4, 'term_end_at=now() + interval \'9 days\'');                // ends in 9 days: NOT expiring soon
  await cm(4, PL2, V2, 'canceled', 30, 'canceled_at=now() - interval \'1 minute\'');           // canceled this month
  await cm(5, PL1, V1, 'cancelled', 90, 'canceled_at=now() - interval \'2 minutes\'');         // the other spelling
  await cm(6, PL2, V2, 'paused', 3);
  await q(`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, started_at) values ($1,$2,$3,$4,$5,$6,'active', now())`, [id('d99'), T2, B2, id('c99'), PLX, VX]);
  // payments: two succeeded this month ($39 + $39), one failed, one refunded, one last month — and the other salon's
  const pay = (n: string, m: string, c: string, status: string, cents: number, at: string) =>
    q(`insert into membership_payments (id, tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, status, idempotency_key, created_at, settled_at) values ($1::uuid,$2,$3,$4,$5,'renewal',$6,$7,$1::text, ${at}, ${at})`, [id(n), T, B, id(m), id(c), cents, status]);
  await pay('aa1', 'd02', 'c02', 'succeeded', 3900, 'now()'); await pay('aa2', 'd03', 'c03', 'succeeded', 3900, "now() - interval '1 minute'");
  await pay('aa3', 'd06', 'c06', 'failed', 3900, 'now()'); await pay('aa4', 'd04', 'c04', 'refunded', 3900, 'now()');
  await pay('aa5', 'd02', 'c02', 'succeeded', 3900, "date_trunc('month', now()) - interval '5 days'");
  await q(`insert into membership_payments (id, tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, status, idempotency_key, settled_at) values ($1::uuid,$2,$3,$4,$5,'renewal',99900,'succeeded',$1::text, now())`, [id('aa9'), T2, B2, id('d99'), id('c99')]);
  await q(`insert into membership_activity (tenant_id, activity_type, customer_id, customer_name_snapshot, plan_name_snapshot, occurred_at) values
      ($1,'purchased',$2,'Mai Le','VIP Nail Club', now() - interval '3 hours'), ($1,'canceled',$3,'Kim Do','Basic Glow', now() - interval '1 minute'), ($1,'renewed',$4,'Ana Ho','Basic Glow', now() - interval '2 hours')`, [T, id('c00'), id('c04'), id('c03')]);
  await q(`insert into membership_activity (tenant_id, activity_type, customer_name_snapshot, occurred_at) values ($1,'purchased','Xena Other', now())`, [T2]);
  await q(`update customers set email = 'tina.vo@example.test' where id = $1`, [id('c02')]);
  await q(`update customer_memberships set member_number = 'M-1001' where id = $1`, [id('d03')]);
  await q(`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, started_at) values ($1,$2,$3,$4,$5,$6,'expired', now() - interval '400 days')`, [id('d07'), T, B, id('c06'), PL2, V2]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number) values ($1,$2,$3,$4, 4242)`, [id('cc1'), T, B, id('c00')]);
  const BEN = (await q(`select id from membership_benefits where plan_version_id = $1`, [V1])).rows[0].id;
  await q(`insert into membership_redemptions (tenant_id, branch_id, customer_membership_id, ticket_id, benefit_id, standard_value_cents, allocated_value_cents) values ($1,$2,$3,$4,$5,4500,3825)`, [T, B, id('d00'), id('cc1'), BEN]);
  await q(`insert into membership_audit (tenant_id, customer_membership_id, action, prev_state, new_state, reason) values ($1,$2,'pause','active','paused','vacation'), ($3,$4,'pause','active','paused','x')`, [T, id('d00'), T2, id('d99')]);
  const db = kyselyFor(pg); lists = new MembershipListsRepository(db as never); ov = new KyselyMembershipsRepository(db as never);
}, 180_000);

describe('Membership Overview — KPIs and analytics', () => {
  it('counts this salon only, with the 7-day window and both cancel spellings', async () => {
    const o: any = await ov.overview(ctx as never, {} as never);
    expect(o.kpis.totalMembers).toBe(5);          // not canceled / cancelled
    expect(o.kpis.activeMembers).toBe(4);
    expect(o.kpis.expiringSoon).toBe(1);          // 3 days yes, 9 days no
    expect(o.kpis.canceledThisMonth).toBe(2);     // canceled + cancelled
    expect(o.kpis.membershipRevenueCents).toBe(7800);
    expect(o.kpis.membershipPaymentsThisMonth).toBe(2);
    expect(o.statusTotal).toBe(8);                // every membership, every status (the expired one too): the status chart's denominator
    expect(o.statusBreakdown.reduce((a: number, s: any) => a + s.count, 0)).toBe(8);
    expect(o.distributionTotal).toBe(o.planDistribution.reduce((a: number, d: any) => a + d.count, 0));
    expect(o.plans.map((p: any) => p.name)).not.toContain('Other Club');
  });
});

describe('Membership Overview — View All lists', () => {
  it('members: newest enrolment first, filters, search (two "Mai Le"s stay two people), clamped pages', async () => {
    const all = await lists.members(ctx, { filter: 'all', page: 1, pageSize: 10 });
    expect(all.totalItems).toBe(5);
    expect(all.items.map((m) => m.customerId)).toEqual([id('c06'), id('c03'), id('c02'), id('c01'), id('c00')]);
    expect((await lists.members(ctx, { filter: 'expiring', page: 1, pageSize: 10 })).items.map((m) => m.customerId)).toEqual([id('c02')]);
    expect((await lists.members(ctx, { filter: 'canceled_this_month', page: 1, pageSize: 10 })).items.map((m) => m.customerId).sort()).toEqual([id('c04'), id('c05')].sort());
    const mai = await lists.members(ctx, { filter: 'all', q: 'mai', page: 1, pageSize: 10 });
    expect(mai.items.map((m) => m.membershipId).sort()).toEqual([id('d00'), id('d01')].sort());
    const last = await lists.members(ctx, { filter: 'all', page: 99, pageSize: 2 });
    expect(last.page).toBe(3); expect(last.items).toHaveLength(1);
    const e = (await lists.members(ctx, { filter: 'expiring', page: 1, pageSize: 10 })).items[0]!;
    expect(e.nextDateKind).toBe('ends');
    expect((await lists.members(ctx, { filter: 'all', planId: PL1, page: 1, pageSize: 10 })).totalItems).toBe(2);
    expect((await lists.members(ctx2, { filter: 'all', page: 1, pageSize: 10 })).items.map((m) => m.customerName)).toEqual(['Xena Other']);
  });

  it('activity: newest first with type counts; payments: this month, succeeded by default', async () => {
    const a = await lists.activity(ctx, { page: 1, pageSize: 10 });
    expect(a.items.map((x) => x.activityType)).toEqual(['canceled', 'renewed', 'purchased']);
    expect(a.types.find((t) => t.type === 'purchased')!.count).toBe(1);
    expect((await lists.activity(ctx, { type: 'renewed', page: 1, pageSize: 10 })).totalItems).toBe(1);
    const p = await lists.payments(ctx, { page: 1, pageSize: 10 });
    expect(p.items.map((x) => x.id)).toEqual([id('aa1'), id('aa2')]);
    expect((await lists.payments(ctx, { status: 'failed', page: 1, pageSize: 10 })).totalItems).toBe(1);
  });

  it('plan performance and discounts are per plan, this salon only', async () => {
    const pp = await lists.planPerformance(ctx);
    expect(pp.plans.map((p) => p.name)).toEqual(['Basic Glow', 'VIP Nail Club']);
    const basic = pp.plans.find((p) => p.planId === PL2)!;
    expect(basic.revenueThisMonthCents).toBe(7800); expect(basic.revenueLastMonthCents).toBe(3900); expect(basic.failedPaymentsThisMonth).toBe(1);
    expect(pp.notTracked.length).toBeGreaterThan(0);
    const d = await lists.discounts(ctx);
    expect(d.items).toHaveLength(1); expect(d.items[0]!.percent).toBe(15); expect(d.items[0]!.planId).toBe(PL1);
    expect((await lists.discounts(ctx2)).items).toHaveLength(0);
  });
});

describe('Membership Overview — search, periods, tabs and Member Details (Oct 29 2026)', () => {
  it('one search box: phone in any format, email, member number, membership id, plan — exact matches first', async () => {
    const byPhone = await lists.members(ctx, { filter: 'all', q: '(215) 555-0102', page: 1, pageSize: 10 });
    expect(byPhone.items.map((m) => m.customerId)).toEqual([id('c02')]);
    expect((await lists.members(ctx, { filter: 'all', q: '+1 215 555 0102', page: 1, pageSize: 10 })).items.map((m) => m.customerId)).toEqual([id('c02')]);
    expect((await lists.members(ctx, { filter: 'all', q: '0103', page: 1, pageSize: 10 })).items.map((m) => m.customerId)).toEqual([id('c03')]);
    expect((await lists.members(ctx, { filter: 'all', q: 'tina.vo@', page: 1, pageSize: 10 })).items.map((m) => m.customerId)).toEqual([id('c02')]);
    expect((await lists.members(ctx, { filter: 'all', q: 'm-1001', page: 1, pageSize: 10 })).items.map((m) => m.membershipId)).toEqual([id('d03')]);
    expect((await lists.members(ctx, { filter: 'all', q: id('d02'), page: 1, pageSize: 10 })).items.map((m) => m.membershipId)).toEqual([id('d02')]);
    expect((await lists.members(ctx, { filter: 'all', q: 'basic glow', page: 1, pageSize: 10 })).totalItems).toBe(3);
    expect((await lists.members(ctx2, { filter: 'all', q: '0102', page: 1, pageSize: 10 })).totalItems).toBe(0);
  });

  it('periods filter the chosen date field; canceled / expired filters; last payment status', async () => {
    const wk = await lists.members(ctx, { filter: 'all', preset: 'custom', from: '2000-01-01', to: '2000-01-02', page: 1, pageSize: 10 });
    expect(wk.totalItems).toBe(0);
    const recent = await lists.members(ctx, { filter: 'all', preset: 'year', dateField: 'enrolled', page: 1, pageSize: 10 });
    expect(recent.period.from).toMatch(/^\d{4}-01-01$/);
    expect((await lists.members(ctx, { filter: 'canceled', page: 1, pageSize: 10 })).totalItems).toBe(2);
    expect((await lists.members(ctx, { filter: 'expired', page: 1, pageSize: 10 })).items.map((m) => m.membershipId)).toEqual([id('d07')]);
    // canceled minutes ago: yesterday..today in the salon's days (robust when the test runs just after midnight)
    const { today } = await lists.period(ctx, {}); const y = new Date(Date.parse(today + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10);
    expect((await lists.members(ctx, { filter: 'canceled', dateField: 'canceled', preset: 'custom', from: y, to: today, page: 1, pageSize: 10 })).totalItems).toBe(2);
    expect((await lists.members(ctx, { filter: 'canceled', dateField: 'canceled', preset: 'custom', from: '2001-01-01', to: '2001-01-02', page: 1, pageSize: 10 })).totalItems).toBe(0);
    const paused = (await lists.members(ctx, { filter: 'paused', page: 1, pageSize: 10 })).items[0]!;
    expect(paused.lastPaymentStatus).toBe('failed');
    await expect(lists.members(ctx, { preset: 'custom', from: '2026-05-02', to: '2026-05-01' })).rejects.toThrow(/start date/);
  });

  it('payments: every status with totals, searchable; redemptions and the plan list', async () => {
    const all = await lists.payments(ctx, { status: 'all', page: 1, pageSize: 10 });
    expect(all.totalItems).toBe(4);                                     // this month: 2 succeeded + failed + refunded
    expect(all.totals).toEqual({ collectedCents: 7800, refundedCents: 3900, netCents: 3900, failed: 1 });
    expect((await lists.payments(ctx, { status: 'all', preset: 'all', page: 1, pageSize: 10 })).totalItems).toBe(5);
    expect((await lists.payments(ctx, { status: 'all', q: 'kim', page: 1, pageSize: 10 })).items.map((x) => x.status)).toEqual(['refunded']);
    const r = await lists.redemptions(ctx, { page: 1, pageSize: 10 });
    expect(r.items).toHaveLength(1); expect(r.items[0]!.ticketNumber).toBe('4242'); expect(r.items[0]!.benefit).toBe('Member discount');
    expect((await lists.redemptions(ctx, { q: '4242', page: 1, pageSize: 10 })).totalItems).toBe(1);
    expect((await lists.redemptions(ctx2, { page: 1, pageSize: 10 })).totalItems).toBe(0);
    const pl = await lists.planList(ctx, { page: 1, pageSize: 10 });
    expect(pl.items.map((p) => p.name)).toEqual(['Basic Glow', 'VIP Nail Club']);
    expect(pl.items[0]!.priceCents).toBe(3900); expect(pl.items[0]!.revenueThisMonthCents).toBe(7800);
    expect(pl.items[1]!.isCustomPricing).toBe(true); expect(pl.items[1]!.benefits).toBe(1);
  });

  it('Member Details: identity, lifecycle, billing, benefits used / remaining, audit — never another salon', async () => {
    const d = await lists.memberDetail(ctx, id('d00'));
    expect(d.member.customerName).toBe('Mai Le'); expect(d.member.maskedPhone).toBe('••• 0100'); expect(d.member.planName).toBe('VIP Nail Club');
    expect(d.benefits).toHaveLength(1); expect(d.benefits[0]!.usedTotal).toBe(1);
    expect(d.audit.map((a) => a.action)).toEqual(['pause']);
    const tina = await lists.memberDetail(ctx, id('d02'));
    expect(tina.billing.paidCents).toBe(7800); expect(tina.lifecycle.endsAt).not.toBeNull();
    expect((await lists.memberDetail(ctx, id('d06'))).otherMemberships.map((o) => o.membershipId)).toEqual([id('d07')]);
    await expect(lists.memberDetail(ctx, id('d99'))).rejects.toThrow(/could not be found/);
    await expect(lists.memberDetail(ctx, 'nope')).rejects.toThrow(/could not be found/);
  });
});
