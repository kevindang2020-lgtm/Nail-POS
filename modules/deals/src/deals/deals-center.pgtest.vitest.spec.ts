// deals-center.pgtest — Deals & Offers guide (30 Oct 2026) §2, §5–§12, §14, §17, §18 on the REAL schema through the REAL
// services: DealsService (create / submit / approve / reject / request changes / publish / pause / resume / edit),
// DealsCheckoutService (candidate → priceTicket → reserve → onPaid / onRefunded — what CheckoutService runs), and the
// Deals & Offers center (library, approvals, redemptions, details, checker, health, assistant).
// The owner's screenshot: "Spring time" 5% ($10.00 → $9.50), "vishal" 20%, technician deals ON with manager approval, 10% cap.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyDealsRepository } from './deals.kysely.repository';
import { DealsService, widenedTerms } from './deals.service';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { priceTicket } from '../engine/pricing';
import { DiscountsScreenRepository } from '../salon-promotions/discounts-screen';
import { CouponCenter } from '../salon-promotions/coupon-center';
import { DealsCenter } from './deals-center';

const P = 'de0f0000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), B = id('b1'), TX = id('a9'), BX = id('b9');
const OWNER = id('e1'), MGR = id('e2'), TECHUSER = id('e3'), TECH = id('7e1'), TECH2 = id('7e2');
const C1 = id('c1'), C2 = id('c2'), CX = id('c9');
const S10 = id('5010'), S100 = id('5100'), SPED = id('5200'), CAT = id('ca1');
const perms = ['pos.marketing.manage', 'pos.marketing.view'];
const owner = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: perms, technicianId: null } as any;
const mgr = { ...owner, userId: MGR, role: 'MANAGER' };
const tech = { ...owner, userId: TECHUSER, role: 'TECHNICIAN', technicianId: TECH };
const ownerX = { ...owner, tenantId: TX, branchId: BX };
let pg: any; let db: any; let svc: DealsService; let co: DealsCheckoutService; let center: DealsCenter;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.apiCode ?? e?.response?.code ?? e?.name + ':' + e?.message; } }
let tk = 0;
async function ticket(cust: string | null, lines: [string, number][]) {
  const t = id('d' + (++tk));
  const sum = lines.reduce((n, [, c]) => n + c, 0);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values ($1,$2,$3,$4,'ready_checkout',$5,$5)`, [t, T, B, cust, sum]);
  for (const [s, c] of lines) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'svc',$5,30,$5)`, [T, B, t, s, c]);
  return t;
}
/** CheckoutService.applyOffer's deal path: judge → price with what is already on the ticket → reserve */
async function applyAtCheckout(ticketId: string, dealId: string) {
  const cand = await co.candidate(owner, ticketId, { dealId });
  const policy = await co.policy(owner);
  const lines = (await q(`select id, line_total_cents from ticket_service_lines where tenant_id = $1 and ticket_id = $2 order by created_at, id`, [T, ticketId])).map((l: any) => ({ lineId: String(l.id), priceCents: Number(l.line_total_cents) }));
  const trial = priceTicket(lines, [...(await co.offersForPricing(owner, ticketId)), cand.offer], policy);
  const mine = trial.applied.find((a) => a.id === cand.offer.id);
  if (!mine) throw new Error('not applied: ' + (trial.rejected.find((r) => r.id === cand.offer.id)?.reason ?? '?'));
  await co.reserve(owner, ticketId, cand, mine);
  return mine;
}
async function pay(ticketId: string) { await q(`update tickets set status = 'paid', payment_status = 'paid', paid_at = now() where id = $1`, [ticketId]); return co.onPaid(owner, ticketId); }
async function salonDeal(title: string, pct: number, serviceIds: string[], extra: Record<string, unknown> = {}) {
  const v = await svc.createDeal(owner, { ownerType: 'salon', kind: 'deal', title, discountType: 'percent', discountPercent: pct, serviceIds, ...extra } as any);
  await svc.submit(owner, v.id); await svc.approve(owner, v.id);
  return svc.publish(owner, v.id);
}
let spring: any; let vishal: any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const repo = new KyselyDealsRepository(db);
  svc = new DealsService(repo); co = new DealsCheckoutService(svc, repo.ledger);
  center = new DealsCenter(db, new DiscountsScreenRepository(db, 'all'), new CouponCenter(db, svc, co, 'all'), svc);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','do-a','DOA001','active'), ($2,'X','Salon X','do-x','DOX001','active')`, [T, TX]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$4,'X','America/New_York')`, [B, T, BX, TX]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  for (const [s, c, n] of [[S10, 1000, 'Polish change'], [S100, 10000, 'Gel full set'], [SPED, 5000, 'Spa pedicure']] as [string, number, string][])
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,$5,30,$6)`, [s, T, B, CAT, n, c]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Lisa','Tran','Lisa Tran'), ($4,$2,$3,'Minh','Le','Minh Le')`, [TECH, T, B, TECH2]);
  for (const [c, t, b, ph, em] of [[C1, T, B, '+16095550101', 'ava.kim@example.test'], [C2, T, B, '+16095550102', 'bo.ng@example.test'], [CX, TX, BX, '+16095550109', 'x@example.test']])
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1,$2,$3,'Ava','Kim','Ava Kim',$4,$5,'active')`, [c, t, b, ph, em]);
  // the screenshot's settings: technician deals ON with manager approval, 10% max
  await svc.updateSettings(owner, { allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 10 } as any);
  spring = await salonDeal('Spring time', 5, [S10]);
  vishal = await salonDeal('vishal', 20, [S100]);
}, 240_000);

describe('§2 / §12 top acceptance gate: Spring time and vishal at Checkout', () => {
  it('Spring time 5% on the $10.00 service: stored $10.00 → $9.50; Checkout takes $0.50 and records ONE redemption on payment', async () => {
    expect({ status: spring.status, original: spring.originalPriceCents, final: spring.finalPriceCents }).toEqual({ status: 'active', original: 1000, final: 950 });
    const lib = await center.library(owner, { q: 'Spring time' });
    expect(lib.items.map((x: any) => [x.name, x.originalPriceCents, x.finalPriceCents, x.ownerType])).toEqual([['Spring time', 1000, 950, 'salon']]);
    const t = await ticket(C1, [[S10, 1000]]);
    const mine = await applyAtCheckout(t, spring.id);
    expect(mine.appliedCents).toBe(50);
    // applied to an unpaid ticket: pending, never counted
    expect((await q(`select status from deal_redemptions where deal_id = $1`, [spring.id])).map((r: any) => r.status)).toEqual(['applied']);
    expect((await center.kpis(owner)).ledger.confirmedEvents).toBe(0);
    await pay(t); await pay(t);   // a duplicate paid callback
    expect(await q(`select status, amount_discounted_cents::int amt from deal_redemptions where deal_id = $1`, [spring.id])).toEqual([{ status: 'redeemed', amt: 50 }]);
    expect(Number((await q(`select redemption_count from deals where id = $1`, [spring.id]))[0].redemption_count)).toBe(1);
  });
  it('vishal 20% (owner-made salon deal) is NOT blocked by the 10% technician cap and takes $20.00 off an eligible $100 line only', async () => {
    expect(vishal.status).toBe('active');
    const t = await ticket(C2, [[S100, 10000], [SPED, 5000]]);   // the pedicure is not one of its services
    const mine = await applyAtCheckout(t, vishal.id);
    expect(mine.appliedCents).toBe(2000);
    await pay(t);
    expect(await q(`select status, amount_discounted_cents::int amt from deal_redemptions where deal_id = $1`, [vishal.id])).toEqual([{ status: 'redeemed', amt: 2000 }]);
  });
  it('a refund appends a reversal (history kept) and the value used is net of it; a second refund reverses nothing', async () => {
    const t = (await q(`select ticket_id from deal_redemptions where deal_id = $1`, [vishal.id]))[0].ticket_id;
    expect(await co.onRefunded(owner, t, null, 'refund')).toMatchObject({ reversed: 1, reversedCents: 2000 });
    expect(await co.onRefunded(owner, t, null, 'refund')).toMatchObject({ reversed: 0 });
    const k = await center.kpis(owner);
    expect({ gross: k.ledger.grossDiscountCents, reversed: k.ledger.reversedCents, net: k.ledger.savingsCents }).toEqual({ gross: 2050, reversed: 2000, net: 50 });
    expect((await q(`select count(*)::int n from deal_redemptions where deal_id = $1`, [vishal.id]))[0].n).toBe(1);   // reversed, not deleted
  });
});

describe('§9 technician deals: 10% cap and manager approval (server-side)', () => {
  let p8: any;
  it('an 8% technician proposal waits as Pending Approval (not redeemable); 15% is REFUSED with the reason, never capped to 10%', async () => {
    p8 = await svc.createDeal(tech, { ownerType: 'technician', title: 'Lisa 8% polish', discountType: 'percent', discountPercent: 8, serviceIds: [S10] } as any);
    expect(p8.status).toBe('pending_approval');
    expect((await center.check(owner, p8.id, { spendCents: 1000, serviceIds: [S10] })).verdict).toBe('REQUIRES_APPROVAL');
    const before = Number((await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n);
    const e = await svc.createDeal(tech, { ownerType: 'technician', title: 'Lisa 15%', discountType: 'percent', discountPercent: 15, serviceIds: [S10] } as any).catch((x) => x);
    expect(e.apiCode).toBe('TECH_DEAL_OVER_POLICY'); expect(e.message).toMatch(/10% cap/);
    expect(Number((await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n)).toBe(before);
  });
  it('the proposing technician / the person who filed it cannot decide it (even holding the manage key); another manager can', async () => {
    expect(await code(svc.approve(tech, p8.id))).toBe('DEAL_SELF_APPROVAL');
    expect(await code(svc.reject(tech, p8.id, 'no'))).toBe('DEAL_SELF_APPROVAL');
    expect(await code(svc.requestChanges(tech, p8.id, 'mine'))).toBe('DEAL_SELF_APPROVAL');
    expect((await svc.getDeal(owner, p8.id)).status).toBe('pending_approval');
    const ap = await center.approvals(owner, {});
    const row = ap.items.find((x: any) => x.id === p8.id)!;
    expect(row.policy).toMatchObject({ maxDiscountPercent: 10, withinPolicy: true }); expect(row.technicianName).toBe('Lisa Tran');
    expect(row.exposure).toMatchObject({ perUseCents: 80, maxUses: null, maxTotalCents: null });
    expect((await center.approvals(tech, {})).items.find((x: any) => x.id === p8.id)!.ownProposal).toBe(true);
  });
  it('Request Changes sends it back as a draft with the note (audited); the technician fixes and resubmits; a manager approves', async () => {
    const v = await svc.requestChanges(mgr, p8.id, 'Please end it by month end');
    expect(v.status).toBe('draft');
    expect((await q(`select decision, reason, approver_user_id from deal_approvals where deal_id = $1`, [p8.id]))).toEqual([{ decision: 'changes_requested', reason: 'Please end it by month end', approver_user_id: MGR }]);
    expect(await code(svc.requestChanges(mgr, p8.id, 'again'))).toBe('DEAL_NOT_PENDING');
    await svc.updateDeal(tech, p8.id, { endsAt: new Date(Date.now() + 20 * 86400000).toISOString() } as any);
    expect((await svc.submit(tech, p8.id)).status).toBe('pending_approval');
    const ok = await svc.approve(mgr, p8.id);
    expect(ok.status).toBe('approved'); expect(ok.approvedByUserId).toBe(MGR);
    expect((await svc.publish(mgr, p8.id)).status).toBe('active');
  });
  it('after approval: widening (8% → 9%, more services, later end) needs a new review; narrowing is allowed; a draft over the cap is refused', async () => {
    expect(await code(svc.updateDeal(tech, p8.id, { discountPercent: 9 } as any))).toBe('DEAL_REREVIEW_REQUIRED');
    expect(await code(svc.updateDeal(tech, p8.id, { serviceIds: [S10, SPED] } as any))).toBe('DEAL_REREVIEW_REQUIRED');
    expect((await svc.getDeal(owner, p8.id)).discountPercent).toBe(8);
    expect((await svc.updateDeal(tech, p8.id, { title: 'Lisa 8% polish (Oct)' } as any)).title).toBe('Lisa 8% polish (Oct)');
    const d = await svc.createDeal(tech, { ownerType: 'technician', title: 'Lisa draft', discountType: 'percent', discountPercent: 6, serviceIds: [S10] } as any);
    await svc.requestChanges(mgr, d.id, 'tweak');
    expect(await code(svc.updateDeal(tech, d.id, { discountPercent: 15 } as any))).toBe('TECH_DEAL_OVER_POLICY');
  });
  it('the cap lowered after submission: approving is refused (runtime rules re-checked) and health flags it; a salon 20% deal is unaffected', async () => {
    const p = await svc.createDeal({ ...tech, technicianId: TECH2, userId: id('e4') }, { ownerType: 'technician', title: 'Minh 9%', discountType: 'percent', discountPercent: 9, serviceIds: [S10] } as any);
    await svc.updateSettings(owner, { maxDiscountPercent: 5 } as any);
    expect(await code(svc.approve(mgr, p.id))).toBe('TECH_DEAL_OVER_POLICY');
    const h = await center.health(owner);
    expect(h.checks.find((c: any) => c.key === 'tech_policy')).toMatchObject({ status: 'attention' });
    expect((await center.check(owner, vishal.id, { spendCents: 10000, serviceIds: [S100] })).verdict).toBe('ELIGIBLE');
    await svc.updateSettings(owner, { maxDiscountPercent: 10 } as any);
    expect((await svc.approve(mgr, p.id)).status).toBe('approved');
  });
  it('Nov 3 audit — the health check also applies the min-price, redemption-cap, new-customer and duration rules', async () => {
    const before = (await center.health(owner)).checks.find((c: any) => c.key === 'tech_policy');
    expect(before).toMatchObject({ status: 'ready' });
    await svc.updateSettings(owner, { minServicePriceCents: 1_000_000 } as any);   // every live technician deal's service is now "too cheap"
    expect((await center.health(owner)).checks.find((c: any) => c.key === 'tech_policy')).toMatchObject({ status: 'attention' });
    await svc.updateSettings(owner, { minServicePriceCents: null } as any);
    expect((await center.health(owner)).checks.find((c: any) => c.key === 'tech_policy')).toMatchObject({ status: 'ready' });
  });
  it('Nov 3 audit: the active-deal cap counts the technician\'s OTHER deals — in the inbox and at approval', async () => {
    const t2 = { ...tech, technicianId: TECH2, userId: id('e4') };
    await svc.updateSettings(owner, { maxActiveDealsPerTech: 3 } as any);
    const a = await svc.createDeal(t2, { ownerType: 'technician', title: 'Minh cap A', discountType: 'percent', discountPercent: 5, serviceIds: [S10] } as any);
    const b = await svc.createDeal(t2, { ownerType: 'technician', title: 'Minh cap B', discountType: 'percent', discountPercent: 5, serviceIds: [S10] } as any);
    // cap 3: Minh has two OTHER live-or-pending deals besides A, so A is within the cap (it was refused — it counted itself)
    expect((await center.approvals(owner, { pageSize: 50 } as any)).items.find((i: any) => i.id === a.id).policy.withinPolicy).toBe(true);
    expect((await svc.approve(mgr, a.id)).status).toBe('approved');
    await svc.updateSettings(owner, { maxActiveDealsPerTech: 2 } as any);
    expect((await center.approvals(owner, { pageSize: 50 } as any)).items.find((i: any) => i.id === b.id).policy.withinPolicy).toBe(false);   // was "within policy"
    expect(await code(svc.approve(mgr, b.id))).toBe('TECH_DEAL_OVER_POLICY');
    await svc.updateSettings(owner, { maxActiveDealsPerTech: null } as any);
  });
  it('technician deals turned OFF: no technician deal can be created, approved or activated — including resume — salon deals still go live', async () => {
    const p = await svc.createDeal(tech, { ownerType: 'technician', title: 'Lisa 5%', discountType: 'percent', discountPercent: 5, serviceIds: [S10] } as any);
    await svc.pause(mgr, p8.id);
    await svc.updateSettings(owner, { allowTechnicianDeals: 'off' } as any);
    expect(await code(svc.createDeal(tech, { ownerType: 'technician', title: 'x', discountType: 'percent', discountPercent: 5, serviceIds: [S10] } as any))).toBe('TECH_DEALS_OFF');
    expect(await code(svc.approve(mgr, p.id))).toBe('TECH_DEALS_OFF');
    expect(await code(svc.resume(mgr, p8.id))).toBe('TECH_DEALS_OFF');
    expect((await salonDeal('Salon 12%', 12, [SPED])).status).toBe('active');
    await svc.updateSettings(owner, { allowTechnicianDeals: 'on_with_approval' } as any);
    expect((await svc.resume(mgr, p8.id)).status).toBe('active');
  });
  it('widenedTerms: what counts as widening', () => {
    const b: any = { discountType: 'percent', discountPercent: 8, discountCents: null, serviceIds: ['a'], branchId: 'b', maxRedemptions: 10, maxPerCustomer: 1, minSpendCents: 1000, newCustomersOnly: true, memberOnly: false,
      startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z', daysOfWeek: [1, 2], rules: null, stackable: false, budgetCents: null, maxDiscountCents: null };
    const w = (p: any) => widenedTerms(b, { ...b, ...p }, p);
    expect(w({ discountPercent: 7, maxRedemptions: 5, minSpendCents: 2000, endsAt: '2026-11-20T00:00:00Z', title: 'x' })).toEqual([]);
    expect(w({ discountPercent: 9 })).toEqual(['discountPercent']);
    expect(w({ maxRedemptions: null })).toEqual(['maxRedemptions']);
    expect(w({ newCustomersOnly: false, daysOfWeek: [1, 2, 3], endsAt: null })).toEqual(['newCustomersOnly', 'endsAt', 'daysOfWeek']);
    expect(w({ serviceIds: ['a', 'c'], branchId: null, minSpendCents: 0 })).toEqual(['serviceIds', 'branchId', 'minSpendCents']);
  });
});

describe('§11 Smart Deal Eligibility Checker (read-only)', () => {
  it('Spring time on $10.00 → ELIGIBLE, $0.50; an ineligible service → INELIGIBLE_SERVICE; nothing is reserved, counted or posted', async () => {
    const before = await q(`select (select count(*) from deal_redemptions where tenant_id = $1)::int r, (select count(*) from deal_redemption_holds where tenant_id = $1)::int h,
      (select redemption_count from deals where id = $2)::int c`, [T, spring.id]);
    const ok = await center.check(owner, spring.id, { spendCents: 1000, serviceIds: [S10] });
    expect({ v: ok.verdict, d: (ok as any).discountPreviewCents }).toEqual({ v: 'ELIGIBLE', d: 50 });
    expect((await center.check(owner, spring.id, { spendCents: 5000, serviceIds: [SPED] })).verdict).toBe('INELIGIBLE_SERVICE');
    const t = await ticket(C1, [[S10, 1000]]);
    expect((await center.check(owner, spring.id, { ticketId: t })).verdict).toBe('ELIGIBLE');
    expect(await q(`select (select count(*) from deal_redemptions where tenant_id = $1)::int r, (select count(*) from deal_redemption_holds where tenant_id = $1)::int h,
      (select redemption_count from deals where id = $2)::int c`, [T, spring.id])).toEqual(before);
  });
});

describe('§5–§7 library: search, filters, date basis, pages', () => {
  it('searches name, technician and service across the whole salon; filters owner / kind / status; newest created first', async () => {
    expect((await center.library(owner, { q: 'lisa tran', status: 'all' })).items.every((x: any) => x.technicianName === 'Lisa Tran')).toBe(true);
    expect((await center.library(owner, { q: 'lisa tran', status: 'all' })).items[0].matchedVia).toBe('technician');
    expect((await center.library(owner, { q: 'Spa pedicure', status: 'all' })).items.map((x: any) => x.name)).toContain('Salon 12%');
    expect((await center.library(owner, { ownerType: 'technician', status: 'all' })).items.every((x: any) => x.ownerType === 'technician')).toBe(true);
    expect((await center.library(owner, { status: 'pending' })).items.every((x: any) => x.dealStatus === 'pending_approval')).toBe(true);
    const all = (await center.library(owner, { status: 'all', pageSize: 50 })).items;
    const created = all.map((x: any) => x.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
  });
  it('a new matching deal is first on Page 1; page 2 of size 2 continues without overlap; the server reports exact totals', async () => {
    const n = await svc.createDeal(owner, { ownerType: 'salon', kind: 'deal', title: 'Zz newest', discountType: 'percent', discountPercent: 5, serviceIds: [SPED] } as any);
    const p1 = await center.library(owner, { status: 'all', page: 1, pageSize: 2 });
    expect(p1.items[0].id).toBe(n.id);
    const p2 = await center.library(owner, { status: 'all', page: 2, pageSize: 2 });
    expect(p2.items.some((x: any) => p1.items.some((y: any) => y.id === x.id))).toBe(false);
    expect(p1.totalItems).toBe(Number((await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n));
    expect(p1.totalPages).toBe(Math.ceil(p1.totalItems / 2));
  });
  it('date bases are not interchangeable: Approved and Redeemed use their own records on salon-local days; a reversed range is refused', async () => {
    const today = (await center.library(owner, { preset: 'today' })).period.today;
    const red = await center.library(owner, { status: 'all', dateField: 'redeemed', preset: 'custom', from: today, to: today, pageSize: 50 });
    expect(red.items.map((x: any) => x.name).sort()).toEqual(['Spring time']);   // vishal's only redemption was reversed
    const apr = await center.library(owner, { status: 'all', dateField: 'approved', preset: 'custom', from: today, to: today, pageSize: 50 });
    expect(apr.items.map((x: any) => x.name)).toEqual(expect.arrayContaining(['Spring time', 'vishal', 'Lisa 8% polish (Oct)']));
    expect(apr.items.map((x: any) => x.name)).not.toContain('Zz newest');
    expect((await center.library(owner, { status: 'all', dateField: 'approved', preset: 'custom', from: '2025-01-01', to: '2025-01-31' })).totalItems).toBe(0);
    expect(await code(center.library(owner, { preset: 'custom', from: '2026-11-02', to: '2026-11-01' }))).toBe('DATE_RANGE_INVALID');
  });
});

describe('§9 approval inbox order, §14 redemption history, §4 KPIs', () => {
  it('approvals: oldest waiting first by default (not the library order); "newest" only when asked', async () => {
    await svc.createDeal(tech, { ownerType: 'technician', title: 'Lisa later 4%', discountType: 'percent', discountPercent: 4, serviceIds: [S10] } as any);
    const oldest = (await center.approvals(owner, {})).items.map((x: any) => x.requestedAt);
    expect([...oldest].sort()).toEqual(oldest);
    const newest = (await center.approvals(owner, { order: 'newest' })).items.map((x: any) => x.requestedAt);
    expect([...newest].sort().reverse()).toEqual(newest);
  });
  it('redemption history searches the ACTUAL users of a deal: email, customer id, deal id, ticket — never every customer', async () => {
    expect((await center.redemptions(owner, { q: 'ava.kim@example.test', state: 'all' })).items.map((x: any) => x.dealName)).toEqual(['Spring time']);
    expect((await center.redemptions(owner, { q: C2, state: 'all' })).items.map((x: any) => x.dealName)).toEqual(['vishal']);
    expect((await center.redemptions(owner, { q: spring.id, state: 'all' })).totalItems).toBe(1);
    expect((await center.redemptions(owner, { q: 'bo.ng@example.test' })).totalItems).toBe(0);   // her only one was reversed (confirmed view)
    const r = (await center.redemptions(owner, { q: 'ava.kim@example.test', state: 'all' })).items[0];
    expect(r.maskedPhone).toBe('••• 0101'); expect(r.discountCents).toBe(50);
  });
  it('KPIs come from source records: pending approvals are live workflow rows; technician policy shown as configured', async () => {
    const k = await center.kpis(owner);
    expect(k.pendingApproval).toBe(Number((await q(`select count(*)::int n from deals where tenant_id = $1 and status = 'pending_approval'`, [T]))[0].n));
    expect(k.techPolicy).toEqual({ allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 10, maxFixedDiscountCents: null, approvalRequired: true });
    expect(k.total).toBe(Number((await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n));
  });
});

describe('§10 details, §15 assistant, §17 tenant isolation', () => {
  it('details carry the approval history, the policy comparison and performance net of reversals', async () => {
    const d = await center.detail(owner, (await q(`select id from deals where tenant_id = $1 and title = 'Lisa 8% polish (Oct)'`, [T]))[0].id);
    expect(d.owner).toMatchObject({ ownerType: 'technician', technicianName: 'Lisa Tran' });
    expect(d.approvals.map((a: any) => a.decision)).toEqual(['approved', 'changes_requested']);
    expect(d.policy).toMatchObject({ maxDiscountPercent: 10, withinPolicy: true });
    const v = await center.detail(owner, vishal.id);
    expect(v.performance).toMatchObject({ completed: 0, grossDiscountCents: 2000, reversedCents: 2000, netDiscountCents: 0 });
    expect(v.policy).toBeNull();
  });
  it('the assistant saves a salon DEAL as a draft (never live, nothing sent); activating it is the separate lifecycle', async () => {
    const r: any = await center.draft(owner, { goal: 'promote_service', title: 'Pedicure push' });
    expect({ kind: r.deal.kind, status: r.deal.status, owner: r.deal.ownerType }).toEqual({ kind: 'deal', status: 'draft', owner: 'salon' });
    expect((await q(`select count(*)::int n from coupon_assistant_drafts where deal_id = $1`, [r.deal.id]))[0].n).toBe(1);
  });
  it('another salon sees none of it: library, approvals, redemptions, details, checker', async () => {
    expect((await center.library(ownerX, { status: 'all' })).totalItems).toBe(0);
    expect((await center.approvals(ownerX, {})).totalItems).toBe(0);
    expect((await center.redemptions(ownerX, { state: 'all' })).totalItems).toBe(0);
    expect(await code(center.detail(ownerX, spring.id))).toBe('PROMOTION_NOT_FOUND');
    expect(await code(center.check(ownerX, spring.id, { spendCents: 1000 }))).toBe('PROMOTION_NOT_FOUND');
    expect((await center.kpis(ownerX)).pendingApproval).toBe(0);
  });
});

// Deals guide (Nov 4 2026): the approval inbox filters by location (salon-wide requests stay visible) and searches by title
describe('Deals center — approvals location filter and search', () => {
  it('a location filter keeps that location\'s and salon-wide requests; another location\'s disappear', async () => {
    const salon = { ...owner, branchId: undefined } as any;   // an owner viewing the whole salon (a branch session only ever sees its own)
    const B3 = id('b3');
    await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Third') on conflict do nothing`, [B3, T]);
    const all = await center.approvals(owner, { pageSize: 50 } as any);
    expect(all.totalItems).toBeGreaterThan(0);
    const pick = all.items[0]!;
    await q(`update deals set branch_id = $1 where id = $2`, [B3, pick.id]);
    expect((await center.approvals(salon, { pageSize: 50, branchId: B } as any)).items.map((x: any) => x.id)).not.toContain(pick.id);
    expect((await center.approvals(salon, { pageSize: 50, branchId: B3 } as any)).items.map((x: any) => x.id)).toContain(pick.id);
    expect((await center.approvals(salon, { pageSize: 50, q: pick.title } as any)).items.map((x: any) => x.id)).toContain(pick.id);
  });
});

describe('Deals center — approvals requested-date range', () => {
  it('a requested-date range in salon days narrows the inbox; a reversed range is refused', async () => {
    const salon = { ...owner, branchId: undefined } as any;
    const all = await center.approvals(salon, { pageSize: 50 } as any);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    expect((await center.approvals(salon, { pageSize: 50, from: today, to: today } as any)).totalItems).toBe(all.totalItems);   // every request in this fixture was made today
    expect((await center.approvals(salon, { pageSize: 50, from: '2020-01-01', to: '2020-01-31' } as any)).totalItems).toBe(0);
    await expect(center.approvals(salon, { from: '2026-02-01', to: '2026-01-01' } as any)).rejects.toThrow(/start date/);
  });
});
