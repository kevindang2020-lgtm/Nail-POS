// coupon-center.pgtest — Coupons & Promotions Management Center guide (30 Oct 2026) §04, §06, §07, §09–§13, §16, §19,
// §21 on the REAL schema through the REAL services: DealsService (create / publish / pause / resume / duplicate),
// DealsCheckoutService (candidate → priceTicket → reserve → onPaid / onRefunded — exactly what CheckoutService.applyOffer
// and the payment / refund paths call), the discounts read model (KPIs, list, redemptions) and the coupon center
// (check, campaigns, health, assistant). "vishal" is the owner's 20% coupon from the screenshot.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyDealsRepository } from '../deals/deals.kysely.repository';
import { DealsService } from '../deals/deals.service';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { priceTicket } from '../engine/pricing';
import { DiscountsScreenRepository } from './discounts-screen';
import { KyselySalonPromotionsRepository } from './salon-promotions.kysely.repository';
import { CouponCenter } from './coupon-center';

const P = 'c0de0000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), B = id('b1'), TX = id('a9'), BX = id('b9');
const OWNER = id('e1'), C1 = id('c1'), C2 = id('c2'), CX = id('c9');
const S100 = id('5100'), S10 = id('5010'), S3335 = id('53335'), SOTHER = id('5999'), CAT = id('ca1');
const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.marketing.manage', 'pos.marketing.view'], technicianId: null } as any;
const ctxX = { ...ctx, tenantId: TX, branchId: BX };
let pg: any; let db: any; let svc: DealsService; let co: DealsCheckoutService; let screen: DiscountsScreenRepository; let center: CouponCenter;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;
let tk = 0;
async function ticket(cust: string | null, services: [string, number][], tenant = T, branch = B) {
  const t = id('d' + (++tk));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values ($1,$2,$3,$4,'ready_checkout',$5,$5)`, [t, tenant, branch, cust, services.reduce((n, [, c]) => n + c, 0)]);
  for (const [s, c] of services) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'svc',$5,30,$5)`, [tenant, branch, t, s, c]);
  return t;
}
/** CheckoutService.applyOffer's deal path: judge (candidate) → price with what is on the ticket → reserve */
async function applyAtCheckout(ticketId: string, req: { code?: string; dealId?: string }) {
  const cand = await co.candidate(ctx, ticketId, req);
  const policy = await co.policy(ctx);
  const t = (await q(`select id, line_total_cents from ticket_service_lines where tenant_id = $1 and ticket_id = $2 order by created_at, id`, [T, ticketId])).map((l: any) => ({ lineId: String(l.id), priceCents: Number(l.line_total_cents) }));
  const current = await co.offersForPricing(ctx, ticketId);
  const trial = priceTicket(t, [...current, cand.offer], policy);
  const mine = trial.applied.find((a) => a.id === cand.offer.id);
  if (!mine) throw new Error('not applied: ' + (trial.rejected.find((r) => r.id === cand.offer.id)?.reason ?? '?'));
  return co.reserve(ctx, ticketId, cand, mine);
}
async function pay(ticketId: string) { await q(`update tickets set status = 'paid', payment_status = 'paid', paid_at = now() where id = $1`, [ticketId]); return co.onPaid(ctx, ticketId); }
const redemptions = async (dealId: string) => q(`select status, amount_discounted_cents::int as amt, coalesce(reversed_cents,0)::int as rev from deal_redemptions where tenant_id = $1 and deal_id = $2 order by created_at, id`, [T, dealId]);
const count = async (dealId: string) => Number((await q(`select redemption_count from deals where id = $1`, [dealId]))[0].redemption_count);
async function coupon(title: string, code: string, extra: Record<string, unknown> = {}) {
  const v = await svc.createDeal(ctx, { ownerType: 'salon', kind: 'coupon', title, discountType: 'percent', discountPercent: 20, code, serviceIds: [], ...extra } as any);
  if (extra.__draft) return v;
  await svc.submit(ctx, v.id); await svc.approve(ctx, v.id);   // the salon's own lifecycle: draft → submit → approve → publish
  return svc.publish(ctx, v.id);
}
let vishal: any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const repo = new KyselyDealsRepository(db);
  svc = new DealsService(repo); co = new DealsCheckoutService(svc, repo.ledger); screen = new DiscountsScreenRepository(db); center = new CouponCenter(db, svc, co);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','cp-a','CPA001','active'), ($2,'X','Salon X','cp-x','CPX001','active')`, [T, TX]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$4,'X','America/New_York')`, [B, T, BX, TX]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  for (const [s, c, n] of [[S100, 10000, 'Gel'], [S10, 1000, 'Polish'], [S3335, 3335, 'Mani'], [SOTHER, 5000, 'Pedicure']] as [string, number, string][])
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,$5,30,$6)`, [s, T, B, CAT, n, c]);
  for (const [c, t, b, ph] of [[C1, T, B, '+16095550101'], [C2, T, B, '+16095550102'], [CX, TX, BX, '+16095550109']])
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Ava','Kim','Ava Kim',$4,'active')`, [c, t, b, ph]);
  vishal = await coupon('vishal', 'VISHALNG20');
}, 240_000);

describe('§04 / §14 one canonical record', () => {
  it('"vishal" is ONE deals row (kind coupon) with one hashed code; Promotions, Coupons/Discounts and Deals all read that row', async () => {
    expect(vishal.status).toBe('active');
    expect((await q(`select count(*)::int n from deals where tenant_id = $1 and title = 'vishal'`, [T]))[0].n).toBe(1);
    const codes = await q(`select code_hint, code_hash from deal_coupon_codes where deal_id = $1`, [vishal.id]);
    expect(codes.length).toBe(1); expect(codes[0].code_hint).toBe('NG20'); expect(codes[0].code_hash).not.toContain('VISHAL');   // stored hashed
    const promos = await new KyselySalonPromotionsRepository(db).list({ ...ctx });
    expect(promos.filter((p: any) => p.name === 'vishal').map((p: any) => p.id)).toEqual([vishal.id]);
    expect((await screen.list(ctx, { q: 'vishal' })).items.map((x: any) => x.id)).toEqual([vishal.id]);
    expect((await svc.listDeals(ctx, { kind: 'coupon' })).filter((d) => d.title === 'vishal').map((d) => d.id)).toEqual([vishal.id]);
  });
});

describe('§13 Checkout — the pricing acceptance examples, one redemption, abandoned / duplicate / refund', () => {
  it('$100 → $20 off, $10 → $2 off, $33.35 → $6.67 off (engine rounding: down to the cent)', async () => {
    for (const [s, c, want] of [[S100, 10000, 2000], [S10, 1000, 200], [S3335, 3335, 667]] as [string, number, number][]) {
      const t = await ticket(C1, [[s, c]]);
      const app = await applyAtCheckout(t, { code: 'vishalng20' });   // code is case-insensitive
      expect(app.discountCents).toBe(want);
      await co.onRefunded(ctx, t, null, 'test_cleanup');   // unpaid → released (nothing counted)
    }
    expect(await count(vishal.id)).toBe(0);
    expect((await redemptions(vishal.id)).map((r: any) => r.status)).toEqual(['released', 'released', 'released']);
  });
  it('applied on an unpaid ticket is PENDING (not counted); applying twice is one application; paid → exactly one redemption; a repeated payment callback adds nothing', async () => {
    const before = await screen.kpis(ctx);
    const t = await ticket(C1, [[S100, 10000]]);
    const a1 = await applyAtCheckout(t, { code: 'VISHALNG20' });
    // the ledger's own idempotency (a retried "apply" from a second register / a double tap): the same coupon on the
    // same ticket stays ONE application — no second row, no second code use
    const cand = await co.candidate(ctx, t, { code: 'VISHALNG20' });
    const again = await co.reserve(ctx, t, cand, { id: cand.offer.id, category: 'coupon', description: '', appliedCents: 2000, lines: [] } as any);
    expect(again.redemptionId).toBe(a1.redemptionId);
    expect((await q(`select count(*)::int n from deal_redemptions where ticket_id = $1`, [t]))[0].n).toBe(1);
    expect((await screen.kpis(ctx)).redemptions).toBe(before.redemptions);
    expect((await screen.kpis(ctx)).ledger.pendingAtCheckout).toBe(before.ledger.pendingAtCheckout + 1);
    expect(await pay(t)).toEqual({ redeemed: 1, released: 0 });
    expect(await co.onPaid(ctx, t)).toEqual({ redeemed: 0, released: 0 });   // duplicate callback
    expect(await count(vishal.id)).toBe(1);
    const k = await screen.kpis(ctx);
    expect(k.redemptions).toBe(1); expect(k.ledger.confirmedEvents).toBe(1); expect(k.ledger.savingsCents).toBe(2000);
    expect((await q(`select count(*)::int n from deal_redemptions where ticket_id = $1 and status = 'redeemed'`, [t]))[0].n).toBe(1);
  });
  it('a full refund reverses it (count back, history kept, value shown gross and reversed separately)', async () => {
    const t = (await q(`select ticket_id from deal_redemptions where deal_id = $1 and status = 'redeemed'`, [vishal.id]))[0].ticket_id;
    await q(`update tickets set status = 'refunded' where id = $1`, [t]);
    expect(await co.onRefunded(ctx, t, null, 'refund')).toMatchObject({ reversed: 1, reversedCents: 2000 });
    expect(await co.onRefunded(ctx, t, null, 'refund')).toMatchObject({ reversed: 0 });   // repeated refund: nothing twice
    expect(await count(vishal.id)).toBe(0);
    const k = await screen.kpis(ctx);
    expect(k.ledger.savingsCents).toBe(0); expect(k.ledger.grossDiscountCents).toBe(2000); expect(k.ledger.reversedCents).toBe(2000);
    const hist = await screen.redemptions(ctx, { state: 'reversed' });
    expect(hist.items.map((i: any) => [i.status, i.discountCents, i.reversedCents])).toEqual([['reversed', 2000, 2000]]);
  });
});

describe('§12 the read-only checker uses Checkout\'s engine', () => {
  const snapshot = async () => (await q(`select (select count(*) from deal_redemptions)::int r, (select count(*) from deal_redemption_holds)::int h, (select coalesce(sum(use_count),0) from deal_coupon_codes)::int u,
      (select count(*) from deal_code_lookup_failures)::int f, (select redemption_count from deals where id = $1)::int c`, [vishal.id]))[0];
  it('ELIGIBLE with the exact discount on a real ticket — and writes nothing at all', async () => {
    const t = await ticket(C2, [[S3335, 3335]]);
    const s0 = await snapshot();
    const v = await center.check(ctx, vishal.id, { ticketId: t, codeEntered: true });
    expect(v).toMatchObject({ verdict: 'ELIGIBLE', eligible: true, discountPreviewCents: 667, eligibleBaseCents: 3335 });
    expect(await snapshot()).toEqual(s0);
  });
  it('without the code → NEEDS_CODE; below a minimum spend → MIN_SPEND; outside its services → INELIGIBLE_SERVICE; hypothetical facts work without a ticket', async () => {
    expect((await center.check(ctx, vishal.id, { spendCents: 1000 })).verdict).toBe('NEEDS_CODE');
    const min = await coupon('min50', 'MINFIFTY50', { minSpendCents: 5000 });
    expect((await center.check(ctx, min.id, { spendCents: 1000, codeEntered: true })).verdict).toBe('MIN_SPEND');
    expect((await center.check(ctx, min.id, { spendCents: 6000, codeEntered: true })).discountPreviewCents).toBe(1200);
    const gel = await coupon('gel only', 'GELONLY20', { serviceIds: [S100] });
    expect((await center.check(ctx, gel.id, { serviceIds: [S10], spendCents: 1000, codeEntered: true })).verdict).toBe('INELIGIBLE_SERVICE');
    expect((await center.check(ctx, gel.id, { serviceIds: [S100], spendCents: 10000, codeEntered: true })).verdict).toBe('ELIGIBLE');
  });
  it('paused → PAUSED, draft → REQUIRES_APPROVAL, future start → NOT_YET_ACTIVE, cap used → LIMIT_REACHED, per customer used → ALREADY_USED', async () => {
    const p = await coupon('pausable', 'PAUSE20X'); await svc.pause(ctx, p.id);
    expect((await center.check(ctx, p.id, { spendCents: 1000, codeEntered: true })).verdict).toBe('PAUSED');
    const d = await coupon('drafty', 'DRAFT20X', { __draft: true });
    expect((await center.check(ctx, d.id, { spendCents: 1000, codeEntered: true })).verdict).toBe('REQUIRES_APPROVAL');
    const f = await coupon('future', 'FUTURE20X', { startsAt: new Date(Date.now() + 5 * 86400000).toISOString() });
    expect((await center.check(ctx, f.id, { spendCents: 1000, codeEntered: true })).verdict).toBe('NOT_YET_ACTIVE');
    const one = await coupon('one per customer', 'ONEEACH20', { maxPerCustomer: 1 });
    const t = await ticket(C2, [[S10, 1000]]); await applyAtCheckout(t, { code: 'ONEEACH20' }); await pay(t);
    expect((await center.check(ctx, one.id, { customerId: C2, spendCents: 1000, codeEntered: true })).verdict).toBe('ALREADY_USED');
    expect((await center.check(ctx, one.id, { customerId: C1, spendCents: 1000, codeEntered: true })).verdict).toBe('ELIGIBLE');
    const cap = await coupon('cap one', 'CAPONE20', { maxRedemptions: 1 });
    const t2 = await ticket(C1, [[S10, 1000]]); await applyAtCheckout(t2, { code: 'CAPONE20' }); await pay(t2);
    expect((await center.check(ctx, cap.id, { customerId: C2, spendCents: 1000, codeEntered: true })).verdict).toBe('LIMIT_REACHED');
  });
  it('NOT_COMBINABLE when a better non-stackable offer is already on the ticket (salon policy best_single)', async () => {
    const big = await coupon('big 50', 'BIGFIFTY50', { discountPercent: 50 });
    const t = await ticket(C1, [[SOTHER, 5000]]);
    await applyAtCheckout(t, { code: 'BIGFIFTY50' });
    const v = await center.check(ctx, vishal.id, { ticketId: t, codeEntered: true });
    expect(v.verdict).toBe('NOT_COMBINABLE'); expect(v.discountPreviewCents).toBe(0); expect(v.context.onTicket).toBe(1);
    // Extras · Coupons 06: the stacking inspector explains it from the salon's stored policy (best_single → one offer per ticket)
    expect(v.stacking.mode).toBe('best_single');
    expect(v.stacking.rows.find((r) => r.benefit === 'other_offer')).toMatchObject({ combines: 'no', reason: 'policy_one_offer' });
    expect(v.stacking.rows.find((r) => r.benefit === 'gift_card_tender')).toMatchObject({ combines: 'yes', reason: 'payment_not_discount' });
    expect(v.stacking.rows.map((r) => r.benefit)).toEqual(['other_offer', 'membership_discount', 'membership_credit', 'loyalty_reward', 'gift_card_tender', 'price_floor', 'discount_cap']);
    await co.onRefunded(ctx, t, null, 'cleanup'); void big;
  });
  it('another salon cannot check, list or link this salon\'s coupon; another salon\'s customer is never judged', async () => {
    await expect(center.check(ctxX, vishal.id, { spendCents: 1000 })).rejects.toMatchObject({ status: 404 });
    await expect(center.campaigns(ctxX, vishal.id)).rejects.toMatchObject({ status: 404 });
    expect((await screen.list(ctxX, { q: 'vishal' })).totalItems).toBe(0);
    const v = await center.check(ctx, vishal.id, { customerId: CX, spendCents: 1000, codeEntered: true });
    expect(v.context.customerId).toBeNull();
  });
});

describe('§10 lifecycle: resume rechecks limits; duplicate makes a clean draft', () => {
  it('a paused coupon whose cap is used up is NOT resumed (DEAL_SOLD_OUT); raising the cap lets it resume', async () => {
    const c = await coupon('cap resume', 'CAPRES20', { maxRedemptions: 1 });
    const t = await ticket(C1, [[S10, 1000]]); await applyAtCheckout(t, { code: 'CAPRES20' }); await pay(t);
    await svc.pause(ctx, c.id);
    await expect(svc.resume(ctx, c.id)).rejects.toMatchObject({ message: expect.stringContaining('limit') });
    await svc.updateDeal(ctx, c.id, { maxRedemptions: 5 });
    expect((await svc.resume(ctx, c.id)).status).toBe('active');
  });
  it('duplicate: new id, draft, "(copy)", same terms, zero uses, no code copied, original untouched', async () => {
    const before = await count(vishal.id);
    const d = await svc.duplicateDeal(ctx, vishal.id);
    expect(d.id).not.toBe(vishal.id); expect(d.status).toBe('draft'); expect(d.title).toBe('vishal (copy)'); expect(d.discountPercent).toBe(20); expect(d.redemptionCount).toBe(0);
    expect((await q(`select count(*)::int n from deal_coupon_codes where deal_id = $1`, [d.id]))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from deal_redemptions where deal_id = $1`, [d.id]))[0].n).toBe(0);
    expect(await count(vishal.id)).toBe(before);
    const withCode = await svc.duplicateDeal(ctx, vishal.id, { title: 'vishal autumn', code: 'AUTUMN20X' });
    expect((await q(`select code_hint from deal_coupon_codes where deal_id = $1`, [withCode.id]))[0].code_hint).toBe('N20X');   // the last four characters are all that is ever shown
  });
});

describe('§06 / §07 / §09 cards, search beyond page 1, newest first, date basis', () => {
  it('Total counts every coupon incl. archived (shown separately); archiving moves it from live to archived', async () => {
    const k0 = await screen.kpis(ctx);
    const a = await coupon('to archive', 'ARCH20XX'); await svc.pause(ctx, a.id); await svc.cancel(ctx, a.id); await svc.archive(ctx, a.id);
    const k1 = await screen.kpis(ctx);
    expect(k1.total).toBe(k0.total + 1); expect(k1.split.archived).toBe(k0.split.archived + 1);
  });
  it('12 more coupons: page 1 of 10 shows the newest first; an exact code finds one that sits beyond page 1', async () => {
    for (let i = 1; i <= 12; i++) await coupon(`bulk ${String(i).padStart(2, '0')}`, `BULKCODE${String(i).padStart(2, '0')}`);
    const p1 = await screen.list(ctx, { status: 'all', page: 1, pageSize: 10 });
    expect(p1.items[0].name).toBe('bulk 12'); expect(p1.totalPages).toBeGreaterThan(1);
    const all = [...p1.items, ...(await screen.list(ctx, { status: 'all', page: 2, pageSize: 10 })).items, ...(await screen.list(ctx, { status: 'all', page: 3, pageSize: 10 })).items];
    expect(all.findIndex((x: any) => x.name === 'bulk 01')).toBeGreaterThanOrEqual(10);
    const hit = await screen.list(ctx, { status: 'all', q: 'BULKCODE01' });
    expect(hit.items.map((x: any) => [x.name, x.matchedVia])).toEqual([['bulk 01', 'code_exact']]);
  });
  it('date basis "active during range" and the service filter', async () => {
    const gelOnly = (await screen.list(ctx, { status: 'all', serviceId: S100 })).items.map((x: any) => x.name);
    expect(gelOnly).toEqual(['gel only']);
    const fut = await screen.list(ctx, { status: 'all', q: 'future', dateField: 'active', preset: 'custom', from: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), to: new Date(Date.now() + 11 * 86400000).toISOString().slice(0, 10) });
    expect(fut.items.map((x: any) => x.name)).toEqual(['future']);   // starts in 5 days, no end → active then
    const past = await screen.list(ctx, { status: 'all', q: 'future', dateField: 'active', preset: 'custom', from: '2026-01-01', to: '2026-01-31' });
    expect(past.totalItems).toBe(0);   // not yet started in January
  });
});

describe('§11 related campaigns, §19 health, §16 assistant (draft only)', () => {
  it('a campaign linked through a code batch is listed; a coupon with none says so', async () => {
    const camp = id('fa1');
    await q(`insert into campaigns (id, tenant_id, name, channel, status) values ($1,$2,'Fall SMS','sms','draft')`, [camp, T]);
    await q(`insert into deal_coupon_batches (tenant_id, deal_id, quantity, single_use, purpose, campaign_id) values ($1,$2,25,true,'marketing',$3)`, [T, vishal.id, camp]);
    expect((await center.campaigns(ctx, vishal.id)).items).toEqual([expect.objectContaining({ campaignId: camp, name: 'Fall SMS', codes: 25 })]);
  });
  it('health is ready from verified checks; a drifted counter and a payment that never marked its coupon are flagged — nothing is auto-fixed', async () => {
    const h0 = await center.health(ctx);
    expect(h0.checks.map((c) => [c.key, c.status])).toEqual([['counters', 'ready'], ['paid_not_marked', 'ready'], ['stuck_holds', 'ready'], ['confirmed_unpaid', 'ready'], ['expiry_lag', 'ready'], ['cap_exceeded', 'ready'], ['ticket_repeat_use', 'ready'], ['version_not_frozen', 'ready'], ['repeat_accounts', 'ready'], ['stacking_overlap', 'ready']]);
    await q(`update deals set redemption_count = redemption_count + 3 where id = $1`, [vishal.id]);
    const t = await ticket(C1, [[S10, 1000]]); await applyAtCheckout(t, { code: 'VISHALNG20' });
    await q(`update tickets set status = 'paid' where id = $1`, [t]);   // paid, but onPaid never ran
    const h1 = await center.health(ctx);
    expect(h1.overall).toBe('attention');
    expect(h1.checks.find((c) => c.key === 'counters')).toMatchObject({ status: 'attention', count: 1, sample: [vishal.id] });
    expect(h1.checks.find((c) => c.key === 'paid_not_marked')).toMatchObject({ status: 'attention', count: 1 });
    expect(await count(vishal.id)).toBe(3);   // flagged, not rewritten
    await co.onPaid(ctx, t); await q(`update deals set redemption_count = (select count(*) from deal_redemptions r where r.deal_id = deals.id and r.status in ('redeemed','partially_reversed')) where id = $1`, [vishal.id]);
    expect((await center.health(ctx)).overall).toBe('ready');
  });
  it('assistant: a suggestion from this salon\'s tickets (slowest days), saved as a DRAFT with the owner\'s edits recorded; nothing live, nothing sent', async () => {
    for (const [dow, n] of [[1, 5], [2, 1], [3, 6], [4, 2], [5, 7], [6, 8], [0, 3]] as [number, number][]) for (let i = 0; i < n; i++) {
      const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7) - 7); d.setUTCHours(17, 0, 0, 0);
      await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, paid_at, created_at) values ($1,$2,$3,'paid',4000,4000,$4,$4)`, [T, B, C1, d.toISOString()]);
    }
    const s = await center.suggest(ctx, 'slow_weekdays');
    console.log('DBG', JSON.stringify(s.basis));
    // the two days with the fewest paid tickets (Tuesday 1 and Thursday 2 seeded; other tests' tickets are paid TODAY, so on a
    // Tuesday or Thursday that weekday has more — the expectation is computed from the counts the assistant reports)
    const by = s.basis.ticketsByDay as Record<string, number>;
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const fewest = [0, 1, 2, 3, 4, 5, 6].filter((d) => by[DAYS[d]] > 0).sort((a, b) => by[DAYS[a]] - by[DAYS[b]] || a - b).slice(0, 2).sort((a, b) => a - b);
    expect(s.terms.daysOfWeek).toEqual(fewest);
    expect(by.Tuesday).toBeGreaterThanOrEqual(1); expect(by.Thursday).toBeGreaterThanOrEqual(2); expect(by.Saturday).toBeGreaterThanOrEqual(8);
    expect(s.method).toBe('rules-v1'); expect(s.exposure?.visitsInBasis).toBeGreaterThanOrEqual(3);
    const campaignsBefore = (await q(`select count(*)::int n from campaigns where tenant_id = $1`, [T]))[0].n;
    const out = await center.draft(ctx, { goal: 'slow_weekdays', discountPercent: 10, code: 'SLOWDAYS10' });
    expect(out.status).toBe('draft'); expect(out.editedFields).toEqual(['discountPercent']);
    const row = (await q(`select goal, method, edited_fields, suggested_json->>'discountPercent' as sp, final_json->>'discountPercent' as fp from coupon_assistant_drafts where deal_id = $1`, [out.deal.id]))[0];
    expect(row).toMatchObject({ goal: 'slow_weekdays', method: 'rules-v1', sp: '15', fp: '10' }); expect(row.edited_fields).toEqual(['discountPercent']);
    expect((await q(`select status from deals where id = $1`, [out.deal.id]))[0].status).toBe('draft');
    expect((await q(`select count(*)::int n from campaigns where tenant_id = $1`, [T]))[0].n).toBe(campaignsBefore);
    expect((await center.check(ctx, out.deal.id, { spendCents: 1000, codeEntered: true })).verdict).toBe('REQUIRES_APPROVAL');
    await expect(center.suggest(ctx, 'make_money')).rejects.toMatchObject({ status: 400 });
  });
  it('reconnect_inactive counts only customers WITH a past visit beyond the salon\'s At Risk days (never-visited excluded)', async () => {
    const s = await center.suggest(ctx, 'reconnect_inactive');
    expect(s.basis).toMatchObject({ atRiskDays: 60 });
    expect(s.terms.rules).toEqual({ all: [{ type: 'lapsed', days: 60 }, { type: 'min_visits', count: 1 }] });
    expect(s.eligibleCustomers).toBe(0);   // C1 visited recently; C2 visited recently; nobody else has visits
  });
});

// Promotions backlog · 07 Code Conflict Finder: two live coupons both marked combinable on the same service and dates are
// flagged (sample = the earlier one); different services, a non-combinable partner or non-overlapping dates are not; nothing changes
describe('Coupons — stacking conflict check', () => {
  it('flags only combinable live coupons that overlap on service and dates, and edits nothing', async () => {
    const key = async () => (await center.health(ctx)).checks.find((c) => c.key === 'stacking_overlap')!;
    expect((await key()).status).toBe('ready');
    const a = await coupon('Gel A', 'GELSTACKA', { stackable: true, serviceIds: [S100] });
    const other = await coupon('Pedi', 'PEDISTACK', { stackable: true, serviceIds: [SOTHER] });   // a different service: no conflict
    const solo = await coupon('Gel solo', 'GELSOLO', { stackable: false, serviceIds: [S100] });   // not combinable: no conflict
    expect((await key()).status).toBe('ready');
    const later = new Date(Date.now() + 400 * 86400_000).toISOString(); const later2 = new Date(Date.now() + 430 * 86400_000).toISOString();
    const future = await coupon('Gel next year', 'GELNEXTYR', { stackable: true, serviceIds: [S100], startsAt: later, endsAt: later2 });
    const aEnds = new Date(Date.now() + 30 * 86400_000).toISOString();
    await q(`update deals set ends_at = $2 where id = $1`, [a.id, aEnds]);   // a ends long before the scheduled one starts
    expect((await key()).status).toBe('ready');
    const b = await coupon('All services', 'ALLSTACK', { stackable: true, serviceIds: [] });   // every service, overlaps a AND other
    const k = await key();
    expect(k.status).toBe('attention'); expect(k.count).toBe(3);   // pairs a+b, other+b, future+b (b never ends) → the earlier of each
    expect(k.sample).toEqual([a.id, other.id, future.id]);
    expect(k.sample).not.toContain(solo.id);
    expect((await q(`select status from deals where id = any($1::uuid[])`, [[a.id, b.id, other.id, future.id]])).map((r: any) => r.status).sort()).toEqual(['active', 'active', 'active', 'scheduled']);
    for (const d of [a, b, other, future, solo]) await svc.pause(ctx, d.id).catch(async () => q(`update deals set status = 'paused' where id = $1`, [d.id]));
    expect((await key()).status).toBe('ready');
  });
  it('No-Double-Use: more completed uses than the per-customer or total limit is flagged from the ledger; nothing is changed', async () => {
    const key = async () => (await center.health(ctx)).checks.find((c) => c.key === 'cap_exceeded')!;
    expect((await key()).status).toBe('ready');
    const once = await coupon('Once each', 'ONCEEACH', { maxPerCustomer: 1, maxRedemptions: 5 });
    const ins = (cust: string, st = 'redeemed') => q(`insert into deal_redemptions (deal_id, tenant_id, branch_id, customer_id, deal_version, status, amount_discounted_cents) values ($1,$2,$3,$4,1,$5,100)`, [once.id, T, B, cust, st]);
    await ins(C1); await ins(C2); await ins(C1, 'reversed');   // a reversed use does not count
    expect((await key()).status).toBe('ready');
    await ins(C1);                                             // the race: C1 used it twice
    const k = await key();
    expect(k).toMatchObject({ status: 'attention', count: 1, sample: [once.id] });
    expect((await redemptions(once.id)).length).toBe(4);       // flagged, not rewritten
    await q(`update deal_redemptions set status = 'reversed' where deal_id = $1 and customer_id = $2 and status = 'redeemed' and id = (select id from deal_redemptions where deal_id = $1 and customer_id = $2 and status = 'redeemed' order by created_at desc, id desc limit 1)`, [once.id, C1]);
    expect((await key()).status).toBe('ready');
    await q(`update deals set max_per_customer = null, max_redemptions = 1 where id = $1`, [once.id]);   // total cap 1, two completed uses
    expect((await key())).toMatchObject({ status: 'attention', sample: [once.id] });
    await q(`update deals set max_redemptions = null where id = $1`, [once.id]);
  });
  it('Fraud/Abuse (repeat accounts): two customer records with ONE phone both completing the same offer is a signal; nothing is changed', async () => {
    const key = async () => (await center.health(ctx)).checks.find((c) => c.key === 'repeat_accounts')!;
    const before = await key();
    const twin = id('c3');
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values ($1,$2,$3,'Ava','K','Ava K','+16095550101','active')`, [twin, T, B]);   // C1's phone
    const promo = await coupon('Welcome', 'WELCOMEONE', { maxPerCustomer: 1 });
    const ins = (cust: string, st = 'redeemed') => q(`insert into deal_redemptions (deal_id, tenant_id, branch_id, customer_id, deal_version, status, amount_discounted_cents) values ($1,$2,$3,$4,1,$5,100)`, [promo.id, T, B, cust, st]);
    await ins(C1); await ins(C2);                          // two people, two phones: fine
    expect((await key()).sample).not.toContain(promo.id);
    await ins(twin, 'released');                           // a released hold is not a completed use
    expect((await key()).sample).not.toContain(promo.id);
    await ins(twin);                                       // same phone as C1, completed
    const k = await key();
    expect(k.status).toBe('attention'); expect(k.sample).toContain(promo.id); expect(k.count).toBe((before.count ?? 0) + 1);
    expect((await q(`select count(*)::int n from customers where id = any($1::uuid[]) and status = 'active'`, [[C1, twin]]))[0].n).toBe(2);   // nobody merged or blocked
    expect((await redemptions(promo.id)).filter((r: any) => r.status === 'redeemed').length).toBe(3);
  });
});

// audit B2 (Nov 3): the assistant draft and its provenance row belong together — when the provenance row cannot be written the
// just-created draft (with its code) is taken back; nothing half-made is left behind
describe('Coupons — assistant draft is all-or-nothing', () => {
  it('a failed provenance write leaves no coupon, no code', async () => {
    const before = (await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n;
    const codesBefore = (await q(`select count(*)::int n from deal_coupon_codes where tenant_id = $1`, [T]))[0].n;
    await q(`alter table coupon_assistant_drafts rename to coupon_assistant_drafts_off`);
    try { await expect(center.draft(ctx, { goal: 'slow_weekdays', discountPercent: 12, code: 'HALFMADE12' })).rejects.toThrow(); }
    finally { await q(`alter table coupon_assistant_drafts_off rename to coupon_assistant_drafts`); }
    expect((await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n).toBe(before);
    expect((await q(`select count(*)::int n from deal_coupon_codes where tenant_id = $1`, [T]))[0].n).toBe(codesBefore);
    const ok = await center.draft(ctx, { goal: 'slow_weekdays', discountPercent: 12, code: 'HALFMADE12' });   // the same code is free again
    expect(ok.status).toBe('draft');
  });
});

// audit B1–B4 (Nov 4 2026): a "Run check" is recorded (who, when, what it found) and listed newest first; the checks stay read-only
describe('Coupons — recorded health runs', () => {
  it('records each run and lists them newest first with who ran it', async () => {
    const dealsBefore = (await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n;
    const a = await center.runHealth(ctx); const b = await center.runHealth(ctx);
    expect(a.runId).not.toBe(b.runId);
    const runs = await center.healthRuns(ctx, { page: 1, pageSize: 10 });
    expect(runs.items[0]!.id).toBe(b.runId); expect(runs.items[1]!.id).toBe(a.runId);
    expect(runs.items[0]).toMatchObject({ overall: b.overall, checks: expect.any(Array) });
    expect((await q(`select area from marketing_health_runs where id = $1`, [a.runId]))[0].area).toBe('coupons');
    expect((await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n).toBe(dealsBefore);   // nothing else changed
  });
});

describe('round 10 — Deals 05 · Coupons 04: one offer completed twice on one ticket (the gap the live-use index leaves)', () => {
  it('a partly reversed use plus a new completed use of the same offer on the same ticket is flagged; separate tickets are not; nothing is changed', async () => {
    const key = async () => (await center.health(ctx)).checks.find((c) => c.key === 'ticket_repeat_use')!;
    expect((await key()).status).toBe('ready');
    const off = await coupon('Repeat check', 'REPEATCHK');
    const t1 = await ticket(C1, [[S10, 1000]]); const t2 = await ticket(C2, [[S10, 1000]]);
    const ins = (tk: string, st: string, cust = C1) => q(`insert into deal_redemptions (deal_id, tenant_id, branch_id, customer_id, ticket_id, deal_version, status, amount_discounted_cents) values ($1,$2,$3,$4,$5,1,$6,100)`, [off.id, T, B, cust, tk, st]);
    await ins(t1, 'partially_reversed'); await ins(t2, 'redeemed', C2);
    expect((await key()).status).toBe('ready');
    await ins(t1, 'redeemed');                                    // allowed by uq_deal_redemption_ticket_live (partially_reversed is not "live")
    const k = await key();
    expect(k).toMatchObject({ status: 'attention', count: 1, sample: [off.id] });
    expect((await redemptions(off.id)).length).toBe(3);           // flagged, not rewritten
    await q(`update deal_redemptions set status = 'reversed' where deal_id = $1`, [off.id]);
    expect((await key()).status).toBe('ready');
  });
});

describe('round 10 — Deals 09: a completed use whose terms at payment time are not on record is flagged', () => {
  it('no terms snapshot and no saved version for its version → version_not_frozen; a snapshot fixes it; nothing is rewritten', async () => {
    const key = async () => (await center.health(ctx)).checks.find((c) => c.key === 'version_not_frozen')!;
    const off = await coupon('Frozen check', 'FROZENCHK');
    const before = (await key()).count ?? 0;
    const rid = (await q(`insert into deal_redemptions (deal_id, tenant_id, branch_id, customer_id, deal_version, status, amount_discounted_cents) values ($1,$2,$3,$4,77,'redeemed',100) returning id`, [off.id, T, B, C1]))[0].id;
    const k = await key();
    expect(k.status).toBe('attention'); expect(k.count).toBe(before + 1); expect(k.sample).toContain(off.id);
    await q(`update deal_redemptions set terms_snapshot = '{"discountPercent":10}'::jsonb where id = $1`, [rid]);
    expect((await key()).count).toBe(before);
    await q(`update deal_redemptions set status = 'reversed' where id = $1`, [rid]);
  });
});

describe('round 10 — Coupons 07: the eligibility preview can be judged "as at" another location of this salon', () => {
  it('a coupon limited to Main is eligible at Main and not at the second location (wrong_branch); another salon\'s location is refused; nothing is consumed', async () => {
    const B2 = id('b2');
    await q(`insert into branches (id, tenant_id, name, timezone, status) values ($1,$2,'Second','America/New_York','active') on conflict do nothing`, [B2, T]);
    const off = await coupon('Main only', 'MAINONLY', { branchId: B });
    await q(`update deals set branch_id = $2 where id = $1`, [off.id, B]);
    const uses = await count(off.id);
    const here: any = await center.check(ctx, off.id, { spendCents: 5000, codeEntered: true, branchId: B });
    const there: any = await center.check(ctx, off.id, { spendCents: 5000, codeEntered: true, branchId: B2 });
    expect(here.verdict).toBe('ELIGIBLE');
    expect(there.verdict).not.toBe('ELIGIBLE');
    expect(JSON.stringify(there)).toMatch(/wrong_branch|location/i);
    await expect(center.check(ctx, off.id, { spendCents: 5000, branchId: BX })).rejects.toMatchObject({ status: 404 });
    expect(await count(off.id)).toBe(uses);
    expect((await redemptions(off.id)).length).toBe(0);
  });
});
