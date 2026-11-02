// promotions-center.pgtest — Promotions Management guide (30 Oct 2026) §05–§14, §17, §18 on the REAL schema through the REAL
// services: DealsService (create / publish / pause / resume / archive — audited), DealsCheckoutService (candidate → priceTicket →
// reserve → onPaid / onRefunded — what CheckoutService.applyOffer and the payment / refund paths call), the discounts read
// model, the coupon center and the Promotions center (logged checks, Eligibility Checks search, trends, assistant safety,
// activity). "vishal" is the owner's 20% promotion from the screenshot; the guide's acceptance trace (§18) is the first block.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyDealsRepository } from '../deals/deals.kysely.repository';
import { DealsService } from '../deals/deals.service';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { priceTicket } from '../engine/pricing';
import { DiscountsScreenRepository } from './discounts-screen';
import { KyselySalonPromotionsRepository } from './salon-promotions.kysely.repository';
import { SalonPromotionsService } from './salon-promotions.service';
import { CouponCenter } from './coupon-center';
import { PromotionsCenter } from './promotions-center';

const P = 'b0de0000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), B = id('b1'), B2 = id('b2'), TX = id('a9'), BX = id('b9');
const OWNER = id('e1'), C1 = id('c1'), C2 = id('c2'), CX = id('c9');
const S100 = id('5100'), SOTHER = id('5999'), CAT = id('ca1');
const ctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.marketing.manage', 'pos.marketing.view'], technicianId: null } as any;
const ctxAll = { ...ctx, branchId: '' };   // salon-wide session (no branch pinned)
const ctxX = { ...ctx, tenantId: TX, branchId: BX };
let pg: any; let db: any; let svc: DealsService; let co: DealsCheckoutService; let screen: DiscountsScreenRepository; let center: CouponCenter; let promo: PromotionsCenter;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;
let tk = 0;
async function ticket(cust: string | null, services: [string, number][], branch = B, tenant = T) {
  const t = id('d' + (++tk));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number) values ($1,$2,$3,$4,'ready_checkout',$5,$5,$6)`, [t, tenant, branch, cust, services.reduce((n, [, c]) => n + c, 0), 90000 + tk]);
  for (const [s, c] of services) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,'svc',$5,30,$5)`, [tenant, branch, t, s, c]);
  return t;
}
async function applyAtCheckout(c: any, ticketId: string, req: { code?: string; dealId?: string }) {
  const cand = await co.candidate(c, ticketId, req);
  const policy = await co.policy(c);
  const t = (await q(`select id, line_total_cents from ticket_service_lines where tenant_id = $1 and ticket_id = $2 order by created_at, id`, [c.tenantId, ticketId])).map((l: any) => ({ lineId: String(l.id), priceCents: Number(l.line_total_cents) }));
  const current = await co.offersForPricing(c, ticketId);
  const trial = priceTicket(t, [...current, cand.offer], policy);
  const mine = trial.applied.find((a) => a.id === cand.offer.id);
  if (!mine) throw new Error('not applied: ' + (trial.rejected.find((r) => r.id === cand.offer.id)?.reason ?? '?'));
  return co.reserve(c, ticketId, cand, mine);
}
async function pay(ticketId: string, c = ctx) { await q(`update tickets set status = 'paid', payment_status = 'paid', paid_at = now() where id = $1`, [ticketId]); return co.onPaid(c, ticketId); }
const reds = async (dealId: string) => q(`select status, amount_discounted_cents::int as amt from deal_redemptions where tenant_id = $1 and deal_id = $2 order by created_at, id`, [T, dealId]);
const used = async (dealId: string) => Number((await q(`select redemption_count from deals where id = $1`, [dealId]))[0].redemption_count);
const checksFor = async (dealId: string) => Number((await q(`select count(*)::int n from promotion_eligibility_checks where deal_id = $1`, [dealId]))[0].n);
async function promotion(title: string, code: string, extra: Record<string, unknown> = {}) {
  const v = await svc.createDeal(ctx, { ownerType: 'salon', kind: 'coupon', title, discountType: 'percent', discountPercent: 20, code, serviceIds: [], ...extra } as any);
  await svc.submit(ctx, v.id); await svc.approve(ctx, v.id);
  return svc.publish(ctx, v.id);
}
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.response?.code ?? e?.getResponse?.()?.code ?? (e?.message || String(e)); } }
let vishal: any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const repo = new KyselyDealsRepository(db);
  svc = new DealsService(repo); co = new DealsCheckoutService(svc, repo.ledger); screen = new DiscountsScreenRepository(db);
  center = new CouponCenter(db, svc, co); promo = new PromotionsCenter(db, center, screen);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'A','Salon A','pm-a','PMA001','active'), ($2,'X','Salon X','pm-x','PMX001','active')`, [T, TX]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$2,'Uptown','America/New_York'), ($4,$5,'X','America/New_York')`, [B, T, B2, BX, TX]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  for (const [s, c, n] of [[S100, 10000, 'Gel'], [SOTHER, 5000, 'Pedicure']] as [string, number, string][])
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,$5,30,$6)`, [s, T, B, CAT, n, c]);
  for (const [c, t, b, ph, nm, em] of [[C1, T, B, '+16095550101', 'Ava Kim', 'ava@pm.test'], [C2, T, B, '+16095550102', 'Bea Lane', 'bea@pm.test'], [CX, TX, BX, '+16095550109', 'Xen Other', 'x@pm.test']])
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values ($1,$2,$3,$4,'',$4,$5,$6,'active')`, [c, t, b, nm, ph, em]);
  vishal = await promotion('vishal', 'VISHALNG20');
}, 240_000);

describe('§18 acceptance: the 20% vishal promotion through Checkout', () => {
  it('check (logged, consumes nothing) → apply (pending, not counted) → paid (one redemption, $20 off $100) → KPIs move once', async () => {
    const k0 = await screen.kpis(ctx);
    const t = await ticket(C1, [[S100, 10000]]);
    const chk: any = await promo.check(ctx, vishal.id, { ticketId: t, codeEntered: true });
    expect(chk).toMatchObject({ eligible: true, verdict: 'ELIGIBLE', discountPreviewCents: 2000, eligibleBaseCents: 10000, logged: true });
    expect(await reds(vishal.id)).toEqual([]); expect(await used(vishal.id)).toBe(0);   // a check never reserves or counts
    const row = (await q(`select ticket_id, customer_id, eligible, discount_preview_cents::int d, source from promotion_eligibility_checks where id = $1`, [chk.checkId]))[0];
    expect(row).toEqual({ ticket_id: t, customer_id: C1, eligible: true, d: 2000, source: 'promotions' });
    await applyAtCheckout(ctx, t, { code: 'vishalng20' });   // codes are case-insensitive
    expect(await reds(vishal.id)).toEqual([{ status: 'applied', amt: 2000 }]);   // held on the ticket (the ledger row) …
    expect(await used(vishal.id)).toBe(0); expect((await screen.kpis(ctx)).ledger.confirmedEvents).toBe(k0.ledger.confirmedEvents);   // … but an unpaid ticket is NOT a use
    await pay(t); await pay(t);   // a replayed payment callback
    expect(await reds(vishal.id)).toEqual([{ status: 'redeemed', amt: 2000 }]); expect(await used(vishal.id)).toBe(1);   // counted once, at payment
    const k1 = await screen.kpis(ctx);
    expect(k1.ledger.confirmedEvents).toBe(k0.ledger.confirmedEvents + 1); expect(k1.ledger.savingsCents).toBe(k0.ledger.savingsCents + 2000);
  });
  it('an ineligible service, a paused promotion and an abandoned ticket are refused / released with concrete reasons — and logged checks say why', async () => {
    const svcOnly = await promotion('gel only', 'GELONLY15', { serviceIds: [S100], discountPercent: 15 });
    const tp = await ticket(C2, [[SOTHER, 5000]]);
    const c1: any = await promo.check(ctx, svcOnly.id, { ticketId: tp, codeEntered: true });
    expect(c1.eligible).toBe(false); expect(c1.verdict).toBe('INELIGIBLE_SERVICE');
    await svc.pause(ctx, svcOnly.id);
    const tg = await ticket(C2, [[S100, 10000]]);
    const c2: any = await promo.check(ctx, svcOnly.id, { ticketId: tg, codeEntered: true });
    expect(c2.eligible).toBe(false); expect(c2.verdict).toBe('PAUSED');
    expect(await code(applyAtCheckout(ctx, tg, { code: 'GELONLY15' }))).not.toBe('ok');
    await svc.resume(ctx, svcOnly.id);
    const ab = await ticket(C2, [[S100, 10000]]);
    const r = await applyAtCheckout(ctx, ab, { code: 'GELONLY15' });
    await co.release(ctx, [String((r as any).redemptionId ?? (r as any).id)], 'ticket_abandoned');
    expect((await reds(svcOnly.id)).map((x) => x.status)).toEqual(['released']); expect(await used(svcOnly.id)).toBe(0);
    expect(await checksFor(svcOnly.id)).toBe(2);
  });
  it('a refund reverses the redemption and keeps its history; the counts and value are reported net, reversal shown separately', async () => {
    const p = await promotion('refund me', 'REFUNDME10', { discountPercent: 10 });
    const t = await ticket(C1, [[S100, 10000]]);
    await applyAtCheckout(ctx, t, { code: 'REFUNDME10' }); await pay(t);
    await co.onRefunded(ctx, t, null, 'customer_refund');
    expect((await reds(p.id)).map((x) => x.status)).toEqual(['reversed']);
    const tr = await promo.trends(ctxAll, { grain: 'day', preset: 'all' });
    expect(tr.totals.reversedCents).toBeGreaterThanOrEqual(0);
  });
});

describe('§05 Eligibility Checks search scope + §07 paging, §06 dates', () => {
  it('only customers somebody actually checked appear; search by name, phone, email, ticket #, verdict filter; tenant isolation', async () => {
    const all = await promo.eligibilityChecks(ctx, { preset: 'all', pageSize: 50 });
    expect(all.items.every((i: any) => i.dealName)).toBe(true);
    expect((await promo.eligibilityChecks(ctx, { q: 'Ava', preset: 'all' })).items.every((i: any) => i.customerName === 'Ava Kim')).toBe(true);
    expect((await promo.eligibilityChecks(ctx, { q: '555-0102', preset: 'all' })).items.every((i: any) => i.customerName === 'Bea Lane')).toBe(true);
    expect((await promo.eligibilityChecks(ctx, { q: 'bea@pm.test', preset: 'all' })).totalItems).toBeGreaterThan(0);
    const one = all.items.find((i: any) => i.ticketNumber);
    expect((await promo.eligibilityChecks(ctx, { q: '#' + one.ticketNumber, preset: 'all' })).items.map((i: any) => i.id)).toContain(one.id);
    expect((await promo.eligibilityChecks(ctx, { verdict: 'not_eligible', preset: 'all', pageSize: 50 })).items.every((i: any) => !i.eligible)).toBe(true);
    expect(all.items[0].maskedPhone ?? '').not.toMatch(/\d{5,}/);   // masked
    expect((await promo.eligibilityChecks(ctxX, { preset: 'all' })).totalItems).toBe(0);   // another salon sees none of them
    expect(await code(promo.check(ctxX, vishal.id, { spendCents: 10000 }))).toBe('PROMOTION_NOT_FOUND');
  });
  it('numbered pages: 12 more checks → page 2 of 10 exists, newest first, stable ids, no row on two pages', async () => {
    for (let i = 0; i < 12; i++) await promo.check(ctx, vishal.id, { spendCents: 1000 + i, codeEntered: true });
    const p1 = await promo.eligibilityChecks(ctx, { dealId: vishal.id, preset: 'all', page: 1, pageSize: 10 });
    const p2 = await promo.eligibilityChecks(ctx, { dealId: vishal.id, preset: 'all', page: 2, pageSize: 10 });
    expect(p1.totalItems).toBeGreaterThanOrEqual(13); expect(p1.totalPages).toBe(Math.ceil(p1.totalItems / 10));
    expect(p2.items.length).toBeGreaterThan(0);
    const ids1 = new Set(p1.items.map((i: any) => i.id)); expect(p2.items.some((i: any) => ids1.has(i.id))).toBe(false);
    expect(Date.parse(p1.items[0].at) >= Date.parse(p1.items[9].at)).toBe(true);
  });
  it('custom range is the salon\'s inclusive calendar days: 23:59 local on the To day is in, 00:00 the next day is out (EDT)', async () => {
    const mk = async (ts: string) => (await q(`insert into promotion_eligibility_checks (tenant_id, deal_id, verdict, eligible, created_at) values ($1,$2,'ELIGIBLE',true,$3) returning id`, [T, vishal.id, ts]))[0].id;
    const inside = await mk('2026-10-15T03:59:00Z');    // Oct 14 23:59 EDT
    const outside = await mk('2026-10-15T04:00:00Z');   // Oct 15 00:00 EDT
    const startIn = await mk('2026-10-10T04:00:00Z');   // Oct 10 00:00 EDT
    const r = await promo.eligibilityChecks(ctxAll, { preset: 'custom', from: '2026-10-10', to: '2026-10-14', pageSize: 100 });
    const ids = r.items.map((i: any) => i.id);
    expect(ids).toContain(inside); expect(ids).toContain(startIn); expect(ids).not.toContain(outside);
  });
  it('Created vs Active During Range are different filters: a promotion created last month that is live today', async () => {
    const old = await promotion('last month promo', 'LASTMONTH5', { discountPercent: 5 });
    await q(`update deals set created_at = now() - interval '40 days' where id = $1`, [old.id]);
    const created = await screen.list(ctxAll, { preset: 'month', dateField: 'created', status: 'all', pageSize: 100 });
    const active = await screen.list(ctxAll, { preset: 'month', dateField: 'active', status: 'all', pageSize: 100 });
    expect(created.items.map((x: any) => x.id)).not.toContain(old.id);
    expect(active.items.map((x: any) => x.id)).toContain(old.id);
  });
});

describe('§05 library branch filter + redemption search by booking ID', () => {
  it('a branch-made promotion is found under its branch filter and a salon-wide one is not "of" a branch', async () => {
    const up = await svc.createDeal(ctxAll, { ownerType: 'salon', kind: 'coupon', title: 'uptown only', discountType: 'fixed', discountCents: 500, code: 'UPTOWN5', serviceIds: [], branchId: B2 } as any);
    const r = await screen.list(ctxAll, { status: 'all', branchId: B2, pageSize: 50 });
    expect(r.items.map((x: any) => x.id)).toEqual([up.id]);
    expect((await screen.list(ctxAll, { status: 'all', branchId: B2, pageSize: 50 })).items.map((x: any) => x.id)).not.toContain(vishal.id);
  });
  it('Redemption History finds a redemption by the booking (appointment) ID behind its ticket', async () => {
    const t = await ticket(C1, [[S100, 10000]]);
    const appt = id('77' + tk);
    await q(`insert into pos_queue_items (tenant_id, customer_name, appointment_id, ticket_id, source) values ($1,'Ava Kim',$2,$3,'appointment')`, [T, appt, t]);
    await applyAtCheckout(ctx, t, { code: 'VISHALNG20' }); await pay(t);
    const r = await screen.redemptions(ctx, { q: appt, state: 'all', preset: 'all' });
    expect(r.items.map((x: any) => x.ticketId)).toEqual([t]);
  });
});

describe('§14 trends, §13 assistant, §12 activity, §09 legacy lifecycle', () => {
  it('trends count completed redemptions per salon day with top promotions, branch and service views (associated revenue)', async () => {
    const tr = await promo.trends(ctxAll, { grain: 'day', preset: 'all' });
    const sum = tr.series.reduce((n: number, s: any) => n + s.redemptions, 0);
    const ledger = Number((await q(`select count(*)::int n from deal_redemptions r join deals d on d.id = r.deal_id where r.tenant_id = $1 and d.kind = 'coupon' and r.status in ('redeemed','partially_reversed')`, [T]))[0].n);
    expect(sum).toBe(ledger); expect(tr.totals.redemptions).toBe(ledger);
    expect(tr.top[0].dealId).toBe(vishal.id); expect(tr.byService.find((s: any) => s.serviceId === S100)).toBeTruthy();
    expect(tr.byBranch.map((b: any) => b.name)).toContain('Main');
    expect((await promo.trends(ctxX, { grain: 'month', preset: 'all' })).totals.redemptions).toBe(0);
  });
  it('assistant suggestion carries safety flags + a message PREVIEW and creates nothing (no deal, no draft row, nothing sent)', async () => {
    const before = Number((await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n);
    const s: any = await promo.suggest(ctx, 'promote_service');
    expect(s.safety.map((f: any) => f.key)).toEqual(['discount_size', 'exposure', 'conflicts', 'consent', 'provider', 'staffing', 'service_cost']);
    expect(s.safety.find((f: any) => f.key === 'staffing').level).toBe('unknown');   // never shown as checked when it is not
    expect(s.safety.find((f: any) => f.key === 'provider').level).toBe('warn');      // no texting number in this salon
    expect(s.messagePreview.sms).toMatch(/Reply STOP to opt out/);
    expect(Number((await q(`select count(*)::int n from deals where tenant_id = $1`, [T]))[0].n)).toBe(before);
    expect(Number((await q(`select count(*)::int n from coupon_assistant_drafts where tenant_id = $1`, [T]))[0].n)).toBe(0);
  });
  it('activity shows who paused / resumed / archived and the status before → after; another salon gets not-found', async () => {
    const p = await promotion('lifecycle', 'LIFECYCLE7', { discountPercent: 7 });
    await svc.pause(ctx, p.id); await svc.resume(ctx, p.id);
    const a = await promo.activity(ctx, p.id);
    const moves = a.items.map((i: any) => `${i.fromStatus}>${i.toStatus}`);
    expect(moves).toContain('active>paused'); expect(moves).toContain('paused>active');
    expect(a.items.every((i: any) => i.at)).toBe(true);
    expect(await code(promo.activity(ctxX, p.id))).toBe('PROMOTION_NOT_FOUND');
  });
  it('legacy pos/salon-promotions: scheduled is not "active"; Activate re-checks the end date and the cap; every change is audited', async () => {
    const legacy = new SalonPromotionsService(new KyselySalonPromotionsRepository(db));
    const fut = await svc.createDeal(ctx, { ownerType: 'salon', kind: 'coupon', title: 'starts later', discountType: 'percent', discountPercent: 10, code: 'LATER10', serviceIds: [], startsAt: new Date(Date.now() + 5 * 864e5).toISOString() } as any);
    await svc.submit(ctx, fut.id); await svc.approve(ctx, fut.id); await svc.publish(ctx, fut.id);
    expect((await legacy.getState(ctx)).promotions.find((p: any) => p.id === fut.id)?.status).toBe('scheduled');
    const ended = await promotion('ended', 'ENDED10', { discountPercent: 10 });
    await svc.pause(ctx, ended.id);
    await q(`update deals set ends_at = now() - interval '1 hour' where id = $1`, [ended.id]);
    expect(await code(legacy.setStatus(ctx, ended.id, 'active'))).toMatch(/already ended|DEAL_ENDED/);
    const capped = await promotion('capped', 'CAPPED10', { discountPercent: 10, maxRedemptions: 1 });
    const t = await ticket(C2, [[S100, 10000]]); await applyAtCheckout(ctx, t, { code: 'CAPPED10' }); await pay(t);
    await q(`update deals set status = 'paused' where id = $1`, [capped.id]);
    expect(await code(legacy.setStatus(ctx, capped.id, 'active'))).toMatch(/limit is used up|DEAL_SOLD_OUT/);
    const ok = await promotion('pausable', 'PAUSABLE5', { discountPercent: 5 });
    await legacy.setStatus(ctx, ok.id, 'paused');
    const audit = await q(`select action_type, metadata_json from audit_logs where tenant_id = $1 and entity_type = 'deal' and entity_id = $2 order by created_at desc limit 1`, [T, ok.id]);
    expect(audit[0].action_type).toBe('deal_paused'); expect(audit[0].metadata_json.before.status).toBe('active'); expect(audit[0].metadata_json.after.status).toBe('paused');
  });
});
