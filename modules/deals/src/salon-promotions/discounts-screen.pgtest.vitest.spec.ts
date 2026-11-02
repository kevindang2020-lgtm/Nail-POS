// discounts-screen.pgtest — Services → Discounts rebuild (Oct 29 2026) against the REAL schema: the five cards (current state,
// the 7-day window, confirmed redemptions only), the Live & Scheduled list (lifecycle from status + dates + cap, the
// illustrative $100 figure with min purchase and cap, newest first, numbered pages, masked codes), the one search box (exact
// code hashed, last four, name, applicable service, a redeeming customer by name or any phone format), the confirmed
// Redemption History (pending / released / reversed kept apart), performance and details — and no other salon's rows.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DiscountsScreenRepository } from './discounts-screen';
import { hashCode, codeHint } from '../engine/coupons';

const P = 'd15c0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), CAT = id('c9');
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.marketing.view'] };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let repo: DiscountsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

async function coupon(n: string, tenant: string, code: string, f: { title: string; type?: 'percent' | 'fixed'; pct?: number; cents?: number; min?: number; status?: string; starts?: string; ends?: string; max?: number; count?: number; cap?: number; createdDaysAgo?: number; branch?: string | null }) {
  await q(`insert into deals (id, tenant_id, branch_id, owner_type, kind, title, discount_type, discount_percent, discount_cents, min_spend_cents, status, starts_at, ends_at, max_redemptions, redemption_count, max_discount_cents, requires_code, created_at)
    values ($1,$2,$3,'salon','coupon',$4,$5,$6,$7,$8,$9, ${f.starts ?? 'null'}, ${f.ends ?? 'null'}, $10, $11, $12, true, now() - make_interval(days => $13))`,
  [id(n), tenant, f.branch === undefined ? null : f.branch, f.title, f.type ?? 'percent', f.type === 'fixed' ? null : f.pct ?? 20, f.type === 'fixed' ? f.cents ?? 500 : null, f.min ?? null, f.status ?? 'active', f.max ?? null, f.count ?? 0, f.cap ?? null, f.createdDaysAgo ?? 1]);
  await q(`insert into deal_coupon_codes (tenant_id, deal_id, code_hash, code_hint, status) values ($1,$2,$3,$4,'active')`, [tenant, id(n), hashCode(tenant, code), codeHint(code)]);
}

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Disc LLC','Disc','ds-a','DSA001','active'), ($2,'Other LLC','Other','ds-b','DSB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]).catch(() => undefined);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Manicure',45,4500)`, [id('5e1'), T, B, CAT]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values
    ($1,$3,$4,'Mai','Le','Mai Le','+18565551234','(856) 555-1234'), ($2,$3,$4,'Ana','Ho','Ana Ho','+12155550000','(215) 555-0000')`, [id('c1'), id('c2'), T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Mai','Other','Mai Other','+18565551234')`, [id('c9'), T2, B2]);
  // the screenshot's coupon: ••••NG20, 20 % off, $10 minimum, no end date — and the rest of the lifecycles
  await coupon('d1', T, 'SPRING20', { title: 'Spring Glow', pct: 20, min: 1000, count: 2, createdDaysAgo: 3 });
  await coupon('d2', T, 'FIVEOFF', { title: 'Five Off', type: 'fixed', cents: 500, starts: "now() + interval '2 days'", createdDaysAgo: 2 });           // scheduled
  await coupon('d3', T, 'PAUSE10', { title: 'Paused Ten', pct: 10, status: 'paused', createdDaysAgo: 5 });
  await coupon('d4', T, 'OLD15', { title: 'Old Fifteen', pct: 15, ends: "now() - interval '1 day'", createdDaysAgo: 40 });                             // expired by date
  await coupon('d5', T, 'ONCE50', { title: 'Once Fifty', pct: 50, max: 1, count: 1, cap: 2500, createdDaysAgo: 6 });                                    // exhausted; cap $25
  await coupon('d6', T, 'SOON25', { title: 'Soon Twenty-Five', pct: 25, ends: "now() + interval '3 days'", createdDaysAgo: 7 });                         // expiring soon
  await coupon('d7', T, 'BIG200', { title: 'Big Spend', type: 'fixed', cents: 2000, min: 20000, createdDaysAgo: 8 });                                    // $100 misses the $200 minimum
  await coupon('d8', T, 'GONE', { title: 'Archived', status: 'archived', createdDaysAgo: 9 });
  await coupon('d9', T2, 'SPRING20', { title: 'Other Spring', pct: 20 });
  await q(`insert into deal_services (deal_id, service_id, tenant_id) values ($1,$2,$3)`, [id('d6'), id('5e1'), T]);
  for (const [n, c, num] of [['7a1', 'c1', 101], ['7a2', 'c2', 102], ['7a3', 'c1', 103], ['7a4', 'c2', 104]] as const)
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, subtotal_cents, total_cents, status) values ($1,$2,$3,$4,$5,10000,8000,'paid')`, [id(n), T, B, id(c), num]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, ticket_number, subtotal_cents, total_cents, status) values ($1,$2,$3,$4,101,9000,9000,'paid')`, [id('7a9'), T2, B2, id('c9')]);
  const red = (n: string, deal: string, cust: string, tk: string, status: string, cents: number, at: string, tenant = T, br = B) =>
    q(`insert into deal_redemptions (id, deal_id, tenant_id, branch_id, customer_id, ticket_id, amount_discounted_cents, deal_version, status, kind, applied_at, redeemed_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,1,$8,'coupon', ${at}, ${status === 'redeemed' || status === 'reversed' ? at : 'null'}, ${at})`, [id(n), id(deal), tenant, br, id(cust), id(tk), cents, status]);
  await red('ae1', 'd1', 'c1', '7a1', 'redeemed', 2000, "now() - interval '2 hours'");
  await red('ae2', 'd1', 'c2', '7a2', 'redeemed', 2000, "now() - interval '1 hour'");
  await red('ae3', 'd6', 'c1', '7a3', 'applied', 2500, "now() - interval '10 minutes'");          // on an unpaid ticket: pending, never counted
  await red('ae4', 'd5', 'c2', '7a4', 'reversed', 2500, "now() - interval '30 days'");
  await red('ae9', 'd9', 'c9', '7a9', 'redeemed', 1800, 'now()', T2, B2);
  repo = new DiscountsScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Discounts — the five cards', () => {
  it('current state, this salon only: active / percent / fixed / redemptions / expiring in 7 days', async () => {
    const k = await repo.kpis(ctx);
    expect(k.activeDiscounts).toBe(3);                 // Spring Glow, Soon Twenty-Five, Big Spend (scheduled, paused, expired, exhausted, archived are not)
    expect(k.percentOff).toBe(3);                      // live & scheduled list: Spring, Paused, Soon
    expect(k.fixedAmount).toBe(2);                     // Five Off (scheduled), Big Spend
    expect(k.redemptions).toBe(3);                     // the coupons' confirmed use counters
    expect(k.expiringSoon).toBe(1);                    // Soon (3 days); no end date / already ended never count
    expect(k.split).toEqual({ scheduled: 1, paused: 1, draft: 0, expired: 1, exhausted: 1, archived: 1 });   // + archived (Coupons guide, Oct 30 2026)
    expect(k.ledger.confirmedEvents).toBe(2); expect(k.ledger.pendingAtCheckout).toBe(1); expect(k.ledger.savingsCents).toBe(4000);
    expect((await repo.kpis(ctx2)).activeDiscounts).toBe(1);
  });
});

describe('Discounts — Live & Scheduled list', () => {
  it('newest first, the seven columns, masked codes, the illustrative $100 figure (minimum + cap)', async () => {
    const l = await repo.list(ctx, { page: 1, pageSize: 10 });
    expect(l.items.map((x) => x.name)).toEqual(['Five Off', 'Spring Glow', 'Paused Ten', 'Soon Twenty-Five', 'Big Spend']);
    const spring = l.items.find((x) => x.name === 'Spring Glow')!;
    expect(spring.code).toBe('••••NG20'); expect(spring.sampleSavingsCents).toBe(2000); expect(spring.minPurchaseCents).toBe(1000); expect(spring.endsAt).toBeNull();
    expect(spring.used).toBe(2); expect(spring.maxRedemptions).toBeNull(); expect(spring.lifecycle).toBe('active');
    expect(l.items.find((x) => x.name === 'Five Off')!.lifecycle).toBe('scheduled');
    expect(l.items.find((x) => x.name === 'Big Spend')!.sampleSavingsCents).toBe(0);
    const once = (await repo.list(ctx, { status: 'exhausted', page: 1, pageSize: 10 })).items[0]!;
    expect(once.name).toBe('Once Fifty'); expect(once.sampleSavingsCents).toBe(2500); expect(once.remaining).toBe(0);
    expect(JSON.stringify(l)).not.toContain('SPRING20');
    const p2 = await repo.list(ctx, { status: 'all', page: 2, pageSize: 3 });
    expect(p2.totalItems).toBe(8); expect(p2.totalPages).toBe(3); expect(p2.items).toHaveLength(3);
    expect((await repo.list(ctx, { status: 'all', page: 99, pageSize: 3 })).page).toBe(3);
    expect((await repo.list(ctx, { type: 'fixed', page: 1, pageSize: 10 })).items.map((x) => x.name)).toEqual(['Five Off', 'Big Spend']);
  });

  it('one search box: exact code (hashed, any case / spacing), last four, name, service, customer name or phone', async () => {
    const exact = await repo.list(ctx, { q: 'spring-20', status: 'all', page: 1, pageSize: 10 });
    expect(exact.items.map((x) => x.name)).toEqual(['Spring Glow']); expect(exact.items[0]!.matchedVia).toBe('code_exact');
    expect((await repo.list(ctx, { q: 'NG20', page: 1, pageSize: 10 })).items.map((x) => x.name)).toEqual(['Spring Glow']);
    expect((await repo.list(ctx, { q: 'glow', page: 1, pageSize: 10 })).items[0]!.matchedVia).toBe('name');
    const svc = await repo.list(ctx, { q: 'gel manicure', page: 1, pageSize: 10 });
    expect(svc.items.map((x) => x.name)).toEqual(['Soon Twenty-Five']); expect(svc.items[0]!.matchedVia).toBe('service');
    for (const phone of ['(856) 555-1234', '8565551234', '856-555-1234', '+1 856 555 1234'])
      expect((await repo.list(ctx, { q: phone, status: 'all', page: 1, pageSize: 10 })).items.map((x) => x.name).sort()).toEqual(['Soon Twenty-Five', 'Spring Glow']);
    expect((await repo.list(ctx2, { q: '8565551234', page: 1, pageSize: 10 })).items.map((x) => x.name)).toEqual(['Other Spring']);
    expect((await repo.list(ctx2, { q: 'ana ho', page: 1, pageSize: 10 })).totalItems).toBe(0);
  });

  it('date field + period; an invalid range is refused', async () => {
    const wk = await repo.list(ctx, { preset: 'custom', from: '2001-01-01', to: '2001-01-31', page: 1, pageSize: 10 });
    expect(wk.totalItems).toBe(0);
    expect((await repo.list(ctx, { dateField: 'ends', preset: 'year', status: 'all', page: 1, pageSize: 10 })).items.every((x) => x.endsAt)).toBe(true);
    await expect(repo.list(ctx, { preset: 'custom', from: '2026-05-02', to: '2026-05-01' })).rejects.toThrow(/start date/);
  });
});

describe('Discounts — Redemption History, performance, details', () => {
  it('confirmed only by default (newest first); pending / reversed apart; searchable by phone, ticket, code, id', async () => {
    const h = await repo.redemptions(ctx, { page: 1, pageSize: 10 });
    expect(h.items.map((x) => x.id)).toEqual([id('ae2'), id('ae1')]);
    expect(h.items[0]).toMatchObject({ customerName: 'Ana Ho', maskedPhone: '••• 0000', code: '••••NG20', ticketNumber: '102', eligibleSubtotalCents: 10000, discountCents: 2000, finalCents: 8000 });
    expect(h.totals).toEqual({ savingsCents: 4000, uniqueCustomers: 2 });
    expect((await repo.redemptions(ctx, { state: 'pending', page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual([id('ae3')]);
    expect((await repo.redemptions(ctx, { state: 'reversed', page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual([id('ae4')]);
    expect((await repo.redemptions(ctx, { state: 'all', page: 1, pageSize: 10 })).totalItems).toBe(4);
    expect((await repo.redemptions(ctx, { q: '+1 856 555 1234', page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual([id('ae1')]);
    expect((await repo.redemptions(ctx, { q: '#102', page: 1, pageSize: 10 })).items.map((x) => x.id)).toEqual([id('ae2')]);
    expect((await repo.redemptions(ctx, { q: 'spring20', page: 1, pageSize: 10 })).totalItems).toBe(2);
    expect((await repo.redemptions(ctx, { q: id('ae1'), page: 1, pageSize: 10 })).totalItems).toBe(1);
    expect((await repo.redemptions(ctx, { preset: 'custom', from: '2001-01-01', to: '2001-01-02', page: 1, pageSize: 10 })).totalItems).toBe(0);
    expect((await repo.redemptions(ctx2, { page: 1, pageSize: 10 })).items.map((x) => x.customerName)).toEqual(['Mai Other']);
  });

  it('performance per coupon over the period; details with usage, services and history — 404 for another salon', async () => {
    const p = await repo.performance(ctx, { preset: 'all', page: 1, pageSize: 10 });
    expect(p.items[0]).toMatchObject({ name: 'Spring Glow', periodRedemptions: 2, periodCustomers: 2, periodSavingsCents: 4000, linkedTicketSalesCents: 16000, avgDiscountCents: 2000 });
    expect(p.totals).toEqual({ redemptions: 2, uniqueCustomers: 2, savingsCents: 4000 });
    const d = await repo.detail(ctx, id('d6'));
    expect(d.services.map((s) => s.name)).toEqual(['Gel Manicure']); expect(d.usage).toMatchObject({ confirmed: 0, pendingAtCheckout: 1 }); expect(d.code).toBe('••••ON25');
    await expect(repo.detail(ctx, id('d9'))).rejects.toThrow(/not found/i);
    await expect(repo.detail(ctx, 'x')).rejects.toThrow(/not found/i);
    const csv = await repo.exportRedemptions(ctx, { state: 'all' });
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(5); expect(csv).not.toContain('555-1234'); expect(csv).not.toContain('SPRING20');
  });
});
