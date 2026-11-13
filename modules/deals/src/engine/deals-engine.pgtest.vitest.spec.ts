// deals-engine.pgtest — BUILD_PLAN Phase 5 on the real schema: the ticket-offer service and the ledger end to end.
//   • apply by id / code / wallet coupon; every reason when not; the code is looked up hashed and rate-limited
//   • applied → redeemed at PAYMENT (deal.redeemed / coupon.redeemed), never before
//   • void / full refund → reversed, the place + the code's use + the budget come back
//   • a line refund reverses only the offers on those lines (partially_reversed keeps the place)
//   • the lifecycle job: activation, expiry, sold out, stale holds, cancelled appointments, missed payments
//   • coupons: generated once (only hashes stored), wallet coupons only for their customer, revocation
//   • the panel: eligible with value, not eligible with WHY, the best combination
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyDealsRepository } from '../deals/deals.kysely.repository';
import { DealsService } from '../deals/deals.service';
import { DealsCheckoutService } from './deals-checkout.service';
import { runDealsLifecycle, aggregateDealDay, alertUpcomingDealChanges } from './deals-lifecycle.scheduler';
import { businessDate } from '@aipowersalon/date-time';
import { hashCode, LOOKUP_FAILURES_PER_ACTOR, walletQrPayload } from './coupons';

const T = 'e5000000-0000-4000-8000-000000000001', B = 'e5000000-0000-4000-8000-0000000000b1', CAT = 'e5000000-0000-4000-8000-0000000000c0';
const GEL = 'e5000000-0000-4000-8000-0000000000a1', PEDI = 'e5000000-0000-4000-8000-0000000000a2';
const ctx: any = { tenantId: T, branchId: B, userId: 'e5000000-0000-4000-8000-0000000000f1', role: 'RECEPTION', permissions: [] };
let db: any; let svc: DealsService; let co: DealsCheckoutService; let repo: KyselyDealsRepository;

async function customer(visits = 0): Promise<string> {
  const id = randomUUID();
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${id}, ${T}, ${B}, 'C', 'X', 'C X')`.execute(db);
  for (let i = 0; i < visits; i++) await sql`insert into tickets (tenant_id, branch_id, customer_id, status, payment_status, paid_at) values (${T}, ${B}, ${id}, 'paid', 'paid', now())`.execute(db);
  return id;
}
async function ticket(customerId: string, lines: [string, number][] = [[GEL, 5000], [PEDI, 3000]]): Promise<{ id: string; lines: string[] }> {
  const id = randomUUID(); const ids: string[] = [];
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values (${id}, ${T}, ${B}, ${customerId}, 'ready_checkout', 8000, 8000)`.execute(db);
  for (const [svcId, cents] of lines) {
    const r = (await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
                         values (${T}, ${B}, ${id}, ${svcId}, 'S', ${cents}, 30, ${cents}) returning id`.execute(db)).rows[0] as any;
    ids.push(String(r.id));
  }
  return { id, lines: ids };
}
async function deal(over: Record<string, any> = {}): Promise<string> {
  const id = randomUUID();
  const o = { kind: 'deal', type: 'percent', pct: 20, cents: null, max: null, perCust: null, budget: null, stackable: false, status: 'active', requiresCode: false, services: [] as string[], newOnly: false, ...over };
  await sql`insert into deals (id, tenant_id, owner_type, kind, title, discount_type, discount_percent, discount_cents, status, max_redemptions, max_per_customer, budget_cents, stackable, requires_code, new_customers_only, starts_at, ends_at)
            values (${id}, ${T}, 'salon', ${o.kind}, ${'Deal ' + id.slice(0, 4)}, ${o.type}, ${o.type === 'percent' ? o.pct : null}, ${o.type === 'percent' ? null : o.cents}, ${o.status}, ${o.max}, ${o.perCust}, ${o.budget},
                    ${o.stackable}, ${o.requiresCode}, ${o.newOnly}, ${o.startsAt ?? null}, ${o.endsAt ?? null})`.execute(db);
  for (const s of o.services) await sql`insert into deal_services (deal_id, service_id, tenant_id) values (${id}, ${s}, ${T})`.execute(db);
  return id;
}
/** apply the way checkout does: candidate → the engine's amount → reserve */
async function apply(ticketId: string, req: any, cents = 1000) {
  const c = await co.candidate(ctx, ticketId, req);
  return co.reserve(ctx, ticketId, c, { id: c.offer.id, category: c.offer.category, description: '', appliedCents: cents, lines: [{ lineId: 'x', cents }] });
}
const status = async (redemptionId: string) => ((await sql`select status from deal_redemptions where id = ${redemptionId}`.execute(db)).rows[0] as any).status;
const holdOf = async (redemptionId: string) => ((await sql`select h.status from deal_redemptions r join deal_redemption_holds h on h.id = r.hold_id where r.id = ${redemptionId}`.execute(db)).rows[0] as any)?.status;
const events = async (type: string) => Number(((await sql`select count(*)::int as n from outbox_events where tenant_id = ${T} and event_type = ${type}`.execute(db)).rows[0] as any).n);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'E', 'Engine Salon', 'engine', 'ENG01', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${GEL}, ${T}, ${B}, ${CAT}, 'Gel', 45, 5000), (${PEDI}, ${T}, ${B}, ${CAT}, 'Pedi', 45, 3000)`.execute(db);
  repo = new KyselyDealsRepository(db, new OutboxWriter());
  svc = new DealsService(repo);
  co = new DealsCheckoutService(svc, repo.ledger);
});

describe('apply → paid → reversed (bug 4)', () => {
  it('applied on the ticket, redeemed only when paid (one deal.redeemed), and the count moves then', async () => {
    const d = await deal(); const t = await ticket(await customer());
    const app = await apply(t.id, { dealId: d });
    expect(await status(app.redemptionId)).toBe('applied');
    expect(Number(((await sql`select redemption_count from deals where id = ${d}`.execute(db)).rows[0] as any).redemption_count)).toBe(0);
    expect(await events('deal.applied')).toBeGreaterThanOrEqual(1);
    const before = await events('deal.redeemed');
    await co.onPaid(ctx, t.id); await co.onPaid(ctx, t.id);
    expect(await status(app.redemptionId)).toBe('redeemed');
    expect(await holdOf(app.redemptionId)).toBe('redeemed');
    expect(await events('deal.redeemed')).toBe(before + 1);
    expect(Number(((await sql`select redemption_count from deals where id = ${d}`.execute(db)).rows[0] as any).redemption_count)).toBe(1);
  });
  it('a full refund / void reverses it: the place comes back (a capped deal is usable again), the count goes down', async () => {
    const d = await deal({ max: 1 }); const t = await ticket(await customer());
    const app = await apply(t.id, { dealId: d });
    await co.onPaid(ctx, t.id);
    const t2 = await ticket(await customer());
    await expect(apply(t2.id, { dealId: d })).rejects.toMatchObject({ status: 409 });   // sold out
    const r = await co.onRefunded(ctx, t.id, null, 'customer unhappy');
    expect(r).toMatchObject({ reversed: 1 });
    expect(await status(app.redemptionId)).toBe('reversed');
    expect(await holdOf(app.redemptionId)).toBe('released');
    expect(Number(((await sql`select redemption_count from deals where id = ${d}`.execute(db)).rows[0] as any).redemption_count)).toBe(0);
    expect(await events('deal.redemption_reversed')).toBeGreaterThanOrEqual(1);
    await expect(apply(t2.id, { dealId: d })).resolves.toMatchObject({ dealId: d });   // the place is back
  });
  it('a line refund reverses only the offer on that line; an offer on both lines is partially reversed and keeps its place', async () => {
    const onGel = await deal({ services: [GEL], stackable: true }); const both = await deal({ type: 'fixed', cents: 800, stackable: true });
    const t = await ticket(await customer());
    const c1 = await co.candidate(ctx, t.id, { dealId: onGel });
    const a1 = await co.reserve(ctx, t.id, c1, { id: c1.offer.id, category: 'deal', description: '', appliedCents: 1000, lines: [{ lineId: t.lines[0], cents: 1000 }] });
    const c2 = await co.candidate(ctx, t.id, { dealId: both });
    const a2 = await co.reserve(ctx, t.id, c2, { id: c2.offer.id, category: 'deal', description: '', appliedCents: 800, lines: [{ lineId: t.lines[0], cents: 500 }, { lineId: t.lines[1], cents: 300 }] });
    await co.onPaid(ctx, t.id);
    const r = await co.onRefunded(ctx, t.id, [t.lines[0]], 'gel chipped');
    expect(r).toMatchObject({ reversed: 1, partial: 1, reversedCents: 1500 });
    expect(await status(a1.redemptionId)).toBe('reversed');
    expect(await status(a2.redemptionId)).toBe('partially_reversed');
    expect(await holdOf(a2.redemptionId)).toBe('redeemed');
  });
  it('removing it before payment releases everything (place, budget, code use)', async () => {
    const d = await deal({ budget: 5000 }); const t = await ticket(await customer());
    const app = await apply(t.id, { dealId: d }, 1200);
    expect(Number(((await sql`select budget_reserved_cents from deals where id = ${d}`.execute(db)).rows[0] as any).budget_reserved_cents)).toBe(1200);
    await co.release(ctx, [app.redemptionId], 'removed');
    expect(await status(app.redemptionId)).toBe('released');
    expect(Number(((await sql`select budget_reserved_cents from deals where id = ${d}`.execute(db)).rows[0] as any).budget_reserved_cents)).toBe(0);
  });
});

describe('codes and wallet coupons', () => {
  it('a code is found by its hash; it applies once (single use); a second ticket is refused; a revoked code is refused', async () => {
    const d = await deal({ kind: 'coupon', requiresCode: true, stackable: true });
    const g = await svc.generateCodes(ctx, d, { quantity: 3, prefix: 'VIP' });
    expect(g.codes).toHaveLength(3);
    const stored = (await sql`select code_hash, code_hint from deal_coupon_codes where deal_id = ${d}`.execute(db)).rows as any[];
    expect(stored.map((x) => x.code_hash)).toContain(hashCode(T, g.codes[0]));
    expect(JSON.stringify(stored)).not.toContain(g.codes[0].replace(/-/g, ''));   // never the code itself
    const t1 = await ticket(await customer()); const t2 = await ticket(await customer());
    await apply(t1.id, { code: g.codes[0].toLowerCase() });
    await expect(apply(t2.id, { code: g.codes[0] })).rejects.toMatchObject({ status: 409, message: /already been used/ });
    const codes = await svc.listCodes(ctx, d);
    await svc.revokeCode(ctx, d, codes.find((x: any) => x.status === 'active')!.id, 'leaked online');
    const revokedHint = (await svc.listCodes(ctx, d)).find((x: any) => x.status === 'revoked')!.hint;
    const revokedCode = g.codes.find((c) => c.replace(/-/g, '').endsWith(revokedHint))!;
    await expect(apply(t2.id, { code: revokedCode })).rejects.toMatchObject({ message: /cancelled/ });
  });
  it('a code-only coupon is never applied without its code; a coupon code for a deal needs eligibility too', async () => {
    const d = await deal({ kind: 'coupon', requiresCode: true, newOnly: true });
    await expect(apply((await ticket(await customer())).id, { dealId: d })).rejects.toMatchObject({ message: /Enter the coupon code/ });
    const g = await svc.generateCodes(ctx, d, { quantity: 1 });
    await expect(apply((await ticket(await customer(2))).id, { code: g.codes[0] })).rejects.toMatchObject({ status: 400, message: /new customers/i });
  });
  it(`wrong codes are rate-limited (${LOOKUP_FAILURES_PER_ACTOR} misses → 429) — and the failures never store the code`, async () => {
    const t = await ticket(await customer());
    const me: any = { ...ctx, userId: 'e5000000-0000-4000-8000-0000000000f9' };
    for (let i = 0; i < LOOKUP_FAILURES_PER_ACTOR; i++) await expect(co.candidate(me, t.id, { code: 'GUESS' + i + 'XX' })).rejects.toMatchObject({ status: 400 });
    await expect(co.candidate(me, t.id, { code: 'GUESS99XX' })).rejects.toMatchObject({ status: 429 });
    const rows = (await sql`select * from deal_code_lookup_failures where tenant_id = ${T}`.execute(db)).rows;
    expect(JSON.stringify(rows)).not.toContain('GUESS');
  });
  it('a wallet coupon (issued to a customer) works only on that customer’s ticket, also from its QR', async () => {
    const d = await deal({ kind: 'coupon', requiresCode: true, type: 'fixed', cents: 700 });
    const mine = await customer(); const other = await customer();
    await svc.generateCodes(ctx, d, { customerIds: [mine], purpose: 'marketing' });
    const coupon = ((await sql`select id from deal_coupon_codes where deal_id = ${d}`.execute(db)).rows[0] as any).id;
    await expect(apply((await ticket(other)).id, { couponId: coupon })).rejects.toMatchObject({ message: /another customer/ });
    await expect(apply((await ticket(mine)).id, { code: walletQrPayload(coupon) })).resolves.toMatchObject({ dealId: d });
  });
});

describe('eligibility at the register and the panel', () => {
  it('a deal on another service is not eligible, with the reason; the panel shows WHY', async () => {
    const pediOnly = await deal({ services: [PEDI], title: 'x' });
    const t = await ticket(await customer(), [[GEL, 5000]]);
    await expect(apply(t.id, { dealId: pediOnly })).rejects.toMatchObject({ status: 400, reasons: [expect.objectContaining({ code: 'no_eligible_service' })] });
    const panel = await co.panel(ctx, t.id, []);
    expect(panel.notEligible.find((x) => x.dealId === pediOnly)?.reasons[0].code).toBe('no_eligible_service');
  });
  it('the panel lists eligible deals with their value on THIS ticket and the best combination', async () => {
    const t = await ticket(await customer(), [[GEL, 5000]]);
    const panel = await co.panel(ctx, t.id, []);
    expect(panel.eligible.length).toBeGreaterThan(0);
    expect(panel.eligible[0].estimatedCents).toBeGreaterThan(0);
    expect(panel.best.better).toBe(true);
    expect(panel.best.add.length).toBeGreaterThanOrEqual(1);
  });
});

describe('the lifecycle job (bug 6 + bug 12 safety net)', () => {
  it('activates scheduled deals at their start, expires ended ones, marks sold-out, expires stale holds', async () => {
    const sched = await deal({ status: 'scheduled', startsAt: new Date(Date.now() - 60_000).toISOString() });
    const ended = await deal({ endsAt: new Date(Date.now() - 60_000).toISOString() });
    const full = await deal({ max: 1 });
    await sql`update deals set redemption_count = 1 where id = ${full}`.execute(db);
    await sql`insert into deal_redemption_holds (deal_id, tenant_id, customer_id, idempotency_key, status, expires_at) values (${full}, ${T}, null, 'stale', 'held', now() - interval '1 minute')`.execute(db);
    const r = await runDealsLifecycle(db, new OutboxWriter());
    const st = async (id: string) => ((await sql`select status from deals where id = ${id}`.execute(db)).rows[0] as any).status;
    expect(await st(sched)).toBe('active');
    expect(await st(ended)).toBe('expired');
    expect(await st(full)).toBe('sold_out');
    expect(r.holdsExpired).toBeGreaterThanOrEqual(1);
    expect(await events('deal.expired')).toBeGreaterThanOrEqual(1);
  });
  it('a cancelled appointment still holding a place is released; an application on a PAID ticket is reconciled to redeemed', async () => {
    const d = await deal(); const c = await customer();
    const appt = randomUUID();
    const tech = randomUUID();
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${tech}, ${T}, ${B}, 'T', 'T', 'T T')`.execute(db);
    await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status) values (${appt}, ${T}, ${B}, ${tech}, ${c}, 'C', '2030-01-02', '10:00', '11:00', 'cancelled')`.execute(db);
    await sql`insert into deal_redemption_holds (deal_id, tenant_id, customer_id, idempotency_key, status, expires_at, appointment_id) values (${d}, ${T}, ${c}, 'appt-k', 'consumed', now(), ${appt})`.execute(db);
    const t = await ticket(c); const app = await apply(t.id, { dealId: d });
    await sql`update tickets set status = 'paid', payment_status = 'paid' where id = ${t.id}`.execute(db);
    const r = await runDealsLifecycle(db, new OutboxWriter());
    expect(r.appointmentPlacesReleased).toBeGreaterThanOrEqual(1);
    expect(r.reconciledPaid).toBeGreaterThanOrEqual(1);
    expect(await status(app.redemptionId)).toBe('redeemed');
  });
  it('daily aggregation is recomputed from the facts (idempotent)', async () => {
    const day = businessDate('America/New_York');   // the salon's day, not the UTC day
    await aggregateDealDay(db, day); await aggregateDealDay(db, day);
    const s = (await sql`select coalesce(sum(redemptions),0)::int as r, coalesce(sum(applications),0)::int as a from deal_daily_stats where tenant_id = ${T} and day = ${day}`.execute(db)).rows[0] as any;
    expect(s.r).toBeGreaterThanOrEqual(1);
    expect(s.a).toBeGreaterThanOrEqual(1);
    const dash = await svc.dashboard(ctx, 7);
    expect(dash.totals.redemptions).toBeGreaterThanOrEqual(1);
  });
  it('a day is the SALON’s day: 10:30 pm in New York on Mar 10 is Mar 10, not the UTC Mar 11', async () => {
    const d = await deal(); const t = await ticket(await customer());
    const app = await apply(t.id, { dealId: d }, 900);
    await co.onPaid(ctx, t.id);
    await sql`update deal_redemptions set redeemed_at = '2026-03-11T02:30:00Z' where id = ${app.redemptionId}`.execute(db);
    await aggregateDealDay(db, '2026-03-10'); await aggregateDealDay(db, '2026-03-11');
    const rows = (await sql`select to_char(day, 'YYYY-MM-DD') as day, redemptions, discounted_cents from deal_daily_stats where deal_id = ${d} order by day`.execute(db)).rows as any[];
    expect(rows.filter((r) => Number(r.redemptions) > 0)).toEqual([{ day: '2026-03-10', redemptions: 1, discounted_cents: 900 }].map((r) => expect.objectContaining({ day: r.day, redemptions: r.redemptions })));
  });
});

describe('per-salon gating and plan limits', () => {
  it('a plan capping live deals at the current count refuses publishing one more; lifting it allows it', async () => {
    const live = Number(((await sql`select count(*)::int as n from deals where tenant_id = ${T} and status in ('active','scheduled')`.execute(db)).rows[0] as any).n);
    const plan = ((await sql`insert into subscription_plans (code, name) values ('pro-deals', 'Pro') returning id`.execute(db)).rows[0] as any).id;
    await sql`insert into plan_limits (plan_id, metric, limit_value) values (${plan}, 'active_deals', ${live})`.execute(db);
    await sql`insert into tenant_subscriptions (tenant_id, plan, status) values (${T}, 'pro-deals', 'active')`.execute(db);
    const d = await svc.createDeal(ctx, { ownerType: 'salon', title: 'One more', discountType: 'percent', discountPercent: 10, serviceIds: [GEL] });
    await svc.submit(ctx, d.id); await svc.approve(ctx, d.id);
    await expect(svc.publish(ctx, d.id)).rejects.toMatchObject({ name: 'DealConflictError', message: new RegExp(`allows ${live} live deal`) });
    expect((await svc.getSettings(ctx)).platformMaxActiveDeals).toBe(live);
    await sql`insert into tenant_plan_limit_overrides (tenant_id, metric, limit_value, reason) values (${T}, 'active_deals', ${live + 5}, 'promo month')`.execute(db);
    await expect(svc.publish(ctx, d.id)).resolves.toMatchObject({ status: 'active' });
  });
  it('a plan without deals switches them off: nothing reserves or applies, the reason says why', async () => {
    await sql`insert into tenant_feature_overrides (tenant_id, feature_key, state) values (${T}, 'deals.engine', 'unavailable')`.execute(db);
    const d = await deal(); const t = await ticket(await customer());
    await expect(apply(t.id, { dealId: d })).rejects.toMatchObject({ status: 409, message: /not part of this salon’s plan/ });
    expect((await svc.getSettings(ctx)).platformDisabled).toBe(true);
    await sql`delete from tenant_feature_overrides where tenant_id = ${T}`.execute(db);
  });
  it('reports/exports: the CSV lists each use with what it took off, gave back, net — and is formula-safe', async () => {
    const d = await deal();
    await sql`update deals set title = '=HYPERLINK("x")' where id = ${d}`.execute(db);
    const t = await ticket(await customer());
    const app = await apply(t.id, { dealId: d }, 1400);
    await co.onPaid(ctx, t.id);
    await co.onRefunded(ctx, t.id, null, 'redo');
    const csv = await svc.exportCsv(ctx, 30);
    const header = csv.split('\n')[0];
    expect(header).toBe('applied_at,redeemed_at,deal,kind,ticket_id,customer_id,status,discount,reversed,net,reversal_reason,code_last4');
    const row = csv.split('\n').find((l) => l.includes(t.id))!;
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);          // a formula is neutralised
    expect(row).toContain(',reversed,14.00,14.00,0.00,redo,');
    expect(await status(app.redemptionId)).toBe('reversed');
  });
  it('channels: the phone receptionist hears only phone-channel deals; the customer app only its own', async () => {
    const phone = await deal(); const app = await deal(); const pos = await deal();
    await sql`update deals set channels = ${['ai_receptionist']} where id = ${phone}`.execute(db);
    await sql`update deals set channels = ${['customer_app']} where id = ${app}`.execute(db);
    await sql`update deals set channels = ${['pos']} where id = ${pos}`.execute(db);
    const ai = (await svc.salonDealsForCustomers(ctx, 'ai_receptionist')).map((d) => d.id);
    const cust = (await svc.salonDealsForCustomers(ctx, 'customer_app')).map((d) => d.id);
    expect(ai).toContain(phone); expect(ai).not.toContain(app); expect(ai).not.toContain(pos);
    expect(cust).toContain(app); expect(cust).not.toContain(phone); expect(cust).not.toContain(pos);
    await sql`update deals set status = 'canceled' where id in (${phone}, ${app}, ${pos})`.execute(db);
  });
  it('the platform switch (Super Admin) turns a salon’s deals off with a reason, audited', async () => {
    await expect(svc.setTenantPlatform(T, { disabled: true, reason: 'short' }, { userId: null })).rejects.toMatchObject({ name: 'DealValidationError' });
    await svc.setTenantPlatform(T, { disabled: true, reason: 'Chargeback investigation' }, { userId: null });
    const d = await deal(); const t = await ticket(await customer());
    await expect(apply(t.id, { dealId: d })).rejects.toMatchObject({ message: /Chargeback investigation/ });
    expect((await svc.salonDealsForCustomers(ctx))).toEqual([]);
    await svc.setTenantPlatform(T, { disabled: false }, { userId: null });
    expect(((await sql`select count(*)::int as n from audit_logs where tenant_id = ${T} and action_type = 'deals_platform_settings_changed'`.execute(db)).rows[0] as any).n).toBe(2);
  });
});

// Extras · Deals & Offers 08 — "Preview vs Paid Comparison": the discount first priced is kept once (estimate_snapshot,
// migration 871); after the ticket is edited and paid, the redemption history compares the two and explains the change.
describe('Deals & Offers 08 — preview vs paid', () => {
  it('keeps the first-priced estimate once, then explains a removed line and a price change against the paid discount', async () => {
    const { DiscountsScreenRepository } = await import('../salon-promotions/discounts-screen');
    const d = await deal({ pct: 20 }); const t = await ticket(await customer());
    // the engine priced 20% of $50 + $30 = $16.00 (allocated 1000 + 600)
    const c = await co.candidate(ctx, t.id, { dealId: d });
    const app = await co.reserve(ctx, t.id, c, { id: c.offer.id, category: c.offer.category, description: '', appliedCents: 1600, lines: [{ lineId: t.lines[0], cents: 1000 }, { lineId: t.lines[1], cents: 600 }] });
    const snap = ((await sql`select estimate_snapshot from deal_redemptions where id = ${app.redemptionId}`.execute(db)).rows[0] as any).estimate_snapshot;
    expect(snap).toEqual({ discountCents: 1600, allocations: [{ lineId: t.lines[0], cents: 1000 }, { lineId: t.lines[1], cents: 600 }], lines: [{ lineId: t.lines[0], priceCents: 5000 }, { lineId: t.lines[1], priceCents: 3000 }] });
    // the ticket is edited: the pedicure comes off, the gel goes to $60 → checkout re-prices the application to $12.00
    await sql`update ticket_service_lines set removed_at = now() where id = ${t.lines[1]}`.execute(db);
    await sql`update ticket_service_lines set line_total_cents = 6000 where id = ${t.lines[0]}`.execute(db);
    await co.syncAmounts(ctx, [{ id: c.offer.id, category: c.offer.category, description: '', appliedCents: 1200, lines: [{ lineId: t.lines[0], cents: 1200 }], redemptionId: app.redemptionId } as any], []);
    await co.onPaid(ctx, t.id);
    // the estimate is never rewritten (the trigger refuses it)
    await expect(sql`update deal_redemptions set estimate_snapshot = '{"discountCents":1}'::jsonb where id = ${app.redemptionId}`.execute(db)).rejects.toThrow(/written once/);
    const screen = new DiscountsScreenRepository(db, 'all');
    const row = (await screen.redemptions({ tenantId: T, branchId: B, userId: ctx.userId, role: 'OWNER', permissions: ['pos.marketing.view'] } as never, { dealId: d, state: 'all', preset: 'all', page: 1, pageSize: 10 })).items.find((x: any) => x.id === app.redemptionId)!;
    expect(row.discountCents).toBe(1200);
    expect(row.previewVsPaid).toEqual({ estimateCents: 1600, paidCents: 1200, changeCents: -400, unchanged: false, changes: [
      { code: 'price_changed', lineId: t.lines[0], beforeCents: 5000, afterCents: 6000, discountBeforeCents: 1000, discountAfterCents: 1200 },
      { code: 'line_removed', lineId: t.lines[1], beforeCents: 3000, afterCents: null, discountBeforeCents: 600, discountAfterCents: null },
    ] });
  });

  it('same lines, different amount → the other offers / limits decided it; no estimate recorded → null, never a guess', async () => {
    const { comparePreviewToPaid, readEstimateSnapshot } = await import('./preview-vs-paid');
    const snap = readEstimateSnapshot({ discountCents: 1000, allocations: [{ lineId: 'a', cents: 1000 }], lines: [{ lineId: 'a', priceCents: 5000 }] });
    expect(comparePreviewToPaid(snap, { discountCents: 700, allocations: [{ lineId: 'a', cents: 700 }], lines: [{ lineId: 'a', priceCents: 5000 }] }))
      .toEqual({ estimateCents: 1000, paidCents: 700, changeCents: -300, unchanged: false, changes: [{ code: 'other_offers_or_limits', lineId: null, beforeCents: null, afterCents: null, discountBeforeCents: null, discountAfterCents: -300 }] });
    expect(comparePreviewToPaid(snap, { discountCents: 1000, allocations: [{ lineId: 'a', cents: 1000 }], lines: [{ lineId: 'a', priceCents: 5000 }] })!.unchanged).toBe(true);
    expect(comparePreviewToPaid(readEstimateSnapshot(null), { discountCents: 1, allocations: [], lines: [] })).toBeNull();
    expect(readEstimateSnapshot({ nope: 1 })).toBeNull();
  });
});

describe('round 10 — Deals & Offers 06: upcoming start / end / few-left alerts for managers', () => {
  it('one alert per offer and kind in the salon alert feed; a second sweep adds nothing; deals themselves are untouched', async () => {
    const soon = await deal({ status: 'scheduled', startsAt: new Date(Date.now() + 3 * 3600_000).toISOString() });
    const ending = await deal({ endsAt: new Date(Date.now() + 20 * 3600_000).toISOString() });
    const few = await deal({ max: 10 });
    await sql`update deals set redemption_count = 9 where id = ${few}`.execute(db);
    const later = await deal({ endsAt: new Date(Date.now() + 10 * 86400_000).toISOString(), max: 100 });   // nothing to say yet
    const before = (await sql`select id, status, version from deals where id = any(${[soon, ending, few, later]}::uuid[]) order by id`.execute(db)).rows;
    await alertUpcomingDealChanges(db);
    const alerts = async () => (await sql`select metadata->>'dealId' as d, metadata->>'kind' as k, audience, status, title from owner_alerts where tenant_id = ${T} and category = 'deal_schedule' order by 2, 1`.execute(db)).rows as any[];
    const a1 = await alerts();
    const kinds = Object.fromEntries(a1.map((x) => [x.d, x.k]));
    expect(kinds[soon]).toBe('starting_soon'); expect(kinds[ending]).toBe('ending_soon'); expect(kinds[few]).toBe('few_left'); expect(kinds[later]).toBeUndefined();
    expect(a1.every((x) => x.audience === 'all' && x.status === 'new')).toBe(true);
    expect(a1.find((x) => x.d === few).title).toMatch(/^Few uses left: /);
    await alertUpcomingDealChanges(db);
    expect((await alerts()).length).toBe(a1.length);              // deduped
    // moving the end date is a new fact → one new alert
    await sql`update deals set ends_at = now() + interval '30 hours' where id = ${ending}`.execute(db);
    await alertUpcomingDealChanges(db);
    expect((await alerts()).filter((x) => x.d === ending)).toHaveLength(2);
    const after = (await sql`select id, status, version from deals where id = any(${[soon, few, later]}::uuid[]) order by id`.execute(db)).rows;
    expect(after).toEqual(before.filter((r: any) => r.id !== ending));
  });
});
