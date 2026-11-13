// team-tips.pgtest — Team → Tips spec (Nov 13 2026) against the REAL schema, on the ONE canonical tip read model the Team
// Tips page now shares with Payments → Tips & Gratuity (tips-screen.repository; nothing duplicated):
//   · KPI cards and the technician leaderboard reconcile (collected = allocated + unallocated; Σ technicians = allocated)
//   · collected / allocated / payable / paid are distinct (payroll states: approved = payable, paid = paid, open = accrued)
//   · a declined card attempt carrying a tip is NOT a collected tip; failed/pending tips are only counted by the accuracy check
//   · search: technician names accent-insensitive (vi_fold), a technician's phone / id only for a contact role, customer
//     name / phone only with customer access; tenant + branch scope before counting and paging
//   · the branch's own time zone decides the calendar days; Custom From > To refused
//   · transactions newest first, numbered server pages at 10 / 25 / 50 / 100 (never more than 100)
//   · the read-only Tip Accuracy check (source coverage, period match, allocation reconciliation, duplicates, …) writes nothing
//   · technicians (no pos.reports.view) are refused by the routes
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TipsScreenRepository, tipsPageReq, allocationBasis } from './tips-screen.repository';
import { TipsScreenController } from './tips-screen.controller';
import { FinanceError } from './finance-scope';

const P = 'a9004b00-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), BX = id('b9'), U = id('e1');
const THAO = id('f1'), DANG = id('f2'), MAI = id('f3'), OTHER = id('f9');
const TZ = 'America/New_York', TZ2 = 'Pacific/Honolulu';
const owner = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.reports.view', 'pos.customers.view', 'tips.adjust', 'technicians.edit'] } as any;
const desk = { ...owner, role: 'FRONT_DESK', permissions: ['pos.reports.view'] };
const otherSalon = { ...owner, tenantId: T2, branchId: BX };
const hawaii = { ...owner, branchId: B2 };
let pg: any; let r: TipsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const ymdAgo = (d: number, tz = TZ) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - d * 86_400_000));
const recent = async (ctx = owner, extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'custom', from: ymdAgo(10), to: ymdAgo(0) }), extra);
let n = 0;
async function ticket(o: { tip: number; subtotal?: number; tech: string; num: string; daysAgo?: number; tenant?: string; branch?: string; customer?: string | null }) {
  const tid = id('c' + String(++n).padStart(4, '0')); const sub = o.subtotal ?? 4000;
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, chosen_payment_method, paid_at, created_at)
    values ($1,$2,$3,$4,$5,'paid',$6,0,0,$7,$8,$9,'card', now() - make_interval(days => $10), now() - make_interval(days => $10, mins => 20))`,
    [tid, o.tenant ?? T, o.branch ?? B, o.customer === undefined ? id('91') : o.customer, o.tech, sub, sub + o.tip, o.tip, o.num, o.daysAgo ?? 1]);
  return tid;
}
const pay = (tid: string, method: string, amount: number, tip: number, status = 'approved', ref: string | null = null, minsAgo = 60 * 24, tenant = T, branch = B) =>
  q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8, now() - make_interval(mins => $9))`, [tenant, branch, tid, method, amount, tip, status, ref, minsAgo]);
const alloc = (tid: string, tech: string, cents: number, source = 'legacy', tenant = T, branch = B) => q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents, source) values ($1,$2,$3,$4,$5,$6)`, [tenant, branch, tid, tech, cents, source]);
let single = '', pair = '', chosen = '', declined = '', straddle = '', dupA = '', over = '';

beforeAll(async () => {
  pg = await migratedPglite();
  r = new TipsScreenRepository(kyselyFor(pg));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'TT LLC','TT','tt-team-tips','TTTEAM01','active'), ($2,'Other LLC','Other','tt-other-tips','TTTEAM02','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone, created_at) values ($1,$2,'Main','active',$3, now() - interval '2 days'), ($4,$2,'Maui','active',$5, now() - interval '1 day'), ($6,$7,'Elsewhere','active',$3, now())`, [B, T, TZ, B2, TZ2, BX, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@tt.test','Pat Owner','OWNER','active')`, [U, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values
    ($1,$5,$6,'Thảo','Nguyễn','Thảo Nguyễn','+16095550101','active'), ($2,$5,$6,'Đặng','Văn','Đặng Văn','+16095550102','active'), ($3,$5,$6,'Mai','Lê','Mai Lê','+16095550103','active'), ($4,$7,$8,'Thảo','Other','Thảo Other','+16095550109','active')`,
    [THAO, DANG, MAI, OTHER, T, B, T2, BX]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Linh','Trần','Linh Trần','+18565557777'), ($4,$5,$6,'Linh','Trần','Linh Trần','+18565557777')`, [id('91'), T, B, id('99'), T2, BX]);
  // one $9.60 tip, one technician — exactly $9.60 (never $19.20)
  single = await ticket({ tip: 960, tech: THAO, num: '2001' }); await pay(single, 'card', 4960, 960, 'approved', 'FX1001'); await alloc(single, THAO, 960);
  // $12.01 between two technicians, no explicit split — the engine's exact-cent 601 / 600
  pair = await ticket({ tip: 1201, tech: DANG, num: '2002', daysAgo: 2 }); await pay(pair, 'card', 5201, 1201, 'approved', 'FX1002'); await alloc(pair, DANG, 601); await alloc(pair, MAI, 600);
  // the customer chose an uneven split on the display (700 / 300)
  chosen = await ticket({ tip: 1000, tech: MAI, num: '2003', daysAgo: 3 }); await pay(chosen, 'cash', 5000, 1000); await alloc(chosen, MAI, 700, 'customer_display'); await alloc(chosen, THAO, 300, 'customer_display');
  // a declined card attempt with a $5 tip, then paid in cash WITHOUT a tip: the $5 was never collected
  declined = await ticket({ tip: 0, tech: DANG, num: '2004', daysAgo: 2 }); await pay(declined, 'card', 4500, 500, 'declined', 'FX1004'); await pay(declined, 'cash', 4000, 0);
  // a ticket collected 1 day ago whose first leg was taken 12 days ago — outside "recent" (the straddle the accuracy check names)
  straddle = await ticket({ tip: 400, tech: THAO, num: '2005' }); await pay(straddle, 'cash', 2000, 0, 'approved', null, 12 * 24 * 60); await pay(straddle, 'card', 2400, 400, 'approved', 'FX1005'); await alloc(straddle, THAO, 400);
  // the same provider reference on two settled rows (a replayed capture) and an over-allocated ticket
  dupA = await ticket({ tip: 200, tech: MAI, num: '2006', daysAgo: 4 }); await pay(dupA, 'card', 2200, 200, 'approved', 'FXDUP'); await alloc(dupA, MAI, 200);
  const dupB = await ticket({ tip: 0, tech: MAI, num: '2007', daysAgo: 4 }); await pay(dupB, 'card', 2000, 0, 'approved', 'FXDUP');
  over = await ticket({ tip: 300, tech: DANG, num: '2008', daysAgo: 5 }); await pay(over, 'card', 2300, 300, 'approved', 'FX1008'); await alloc(over, DANG, 400);
  // payroll: the pair's day falls in an APPROVED period (payable); the chosen ticket's day in a PAID period
  await q(`insert into payroll_periods (tenant_id, branch_id, label, period_start, period_end, status, payout_status) values ($1,$2,'P-finalized', $3::date, $3::date, 'finalized', 'unpaid')`, [T, B, ymdAgo(2)]);
  await q(`insert into payroll_periods (tenant_id, branch_id, label, period_start, period_end, status, payout_status, paid_at) values ($1,$2,'P-paid', $3::date, $3::date, 'paid', 'paid', now())`, [T, B, ymdAgo(3)]);
  // another salon: same customer name / phone, a technician named Thảo — must never appear
  const ot = await ticket({ tip: 999, tech: OTHER, num: '2001', tenant: T2, branch: BX, customer: id('99') }); await pay(ot, 'card', 4999, 999, 'approved', 'FX1001', 60 * 24, T2, BX); await alloc(ot, OTHER, 999, 'legacy', T2, BX);
}, 180_000);

describe('Team Tips — one grain: KPIs, leaderboard and reconciliation agree', () => {
  it('collected counts each tip once (declined attempt excluded); allocated + unallocated = collected; Σ technicians = allocated', async () => {
    const f = await recent();
    const s = await r.summary(owner, f);
    // 960 + 1201 + 1000 + 0 (declined $5 never collected) + 400 + 200 + 0 + 300
    expect(s.kpis.totalTipsCents).toBe(4061);
    expect(s.kpis.cardTipsCents + s.kpis.cashTipsCents).toBe(s.kpis.totalTipsCents);
    expect(s.kpis.cashTipsCents).toBe(1000);
    const d = await r.distribution(owner, f, { page: 1, pageSize: 25 });
    expect(d.totals.allocatedCents).toBe(s.reconciliation.allocatedCents);
    expect(d.items.reduce((a, x) => a + x.allocatedCents, 0)).toBe(d.totals.allocatedCents);
    // leaderboard by total, highest first
    expect(d.items.map((x) => x.allocatedCents)).toEqual([...d.items.map((x) => x.allocatedCents)].sort((a, b) => b - a));
    expect(d.items.find((x) => x.technicianId === THAO)!.allocatedCents).toBe(960 + 300 + 400);
    // the over-allocated ticket shows as allocated 400 against 300 collected — reported, never silently trimmed
    expect(s.reconciliation.allocatedCents).toBe(960 + 1201 + 1000 + 400 + 200 + 400);
  });
  it('payable (approved period), paid (paid period) and accrued (open / none) are distinct and add up to allocated', async () => {
    const s = await r.summary(owner, await recent());
    const rec = s.reconciliation as any;
    expect(rec.payableCents).toBe(1201);
    expect(rec.paidOutCents).toBe(1000);
    expect(rec.paidOutCents + rec.payableCents + rec.accruedCents).toBe(rec.allocatedCents);
  });
  it('the technician overlay: per ticket method, allocation basis (customer choice / salon policy / single), payroll state', async () => {
    const e = await r.technicianEarnings(owner, await recent(), THAO, { page: 1, pageSize: 25 });
    const byNum = new Map(e.items.map((x) => [x.ticketNumber, x]));
    expect(byNum.get('2001')).toMatchObject({ allocatedCents: 960, method: 'card', allocationBasis: 'single', corrected: false });
    expect(byNum.get('2003')).toMatchObject({ allocatedCents: 300, method: 'cash', allocationBasis: 'customer_selected', payoutState: 'paid' });
    const m = await r.technicianEarnings(owner, await recent(), MAI, { page: 1, pageSize: 25 });
    expect(m.items.find((x) => x.ticketNumber === '2002')).toMatchObject({ allocatedCents: 600, allocationBasis: 'salon_policy', payoutState: 'approved', sharedWith: 1 });
    expect(allocationBasis('legacy,staff', 2)).toBe('staff_directed');
    expect(allocationBasis('', 1)).toBe('single');
  });
});

describe('Team Tips — scoped search', () => {
  const find = async (ctx: any, s: string) => (await r.transactions(ctx, await recent(ctx, { search: s }), { page: 1, pageSize: 25 })).items.map((x) => x.ticketNumber).sort();
  it('technician names match case- and accent-insensitively', async () => {
    expect(await find(owner, 'thao')).toEqual(['2001', '2003', '2005']);
    expect(await find(owner, 'THẢO NGUYỄN')).toEqual(['2001', '2003', '2005']);
    expect(await find(owner, 'dang van')).toEqual(['2002', '2004', '2008']);   // 2004: Đặng is its technician (no tip, still an eligible ticket)
  });
  it('a technician phone / id only for a contact role; the customer only with customer access', async () => {
    expect(await find(owner, '609-555-0101')).toEqual(['2001', '2003', '2005']);
    expect(await find(desk, '609-555-0101')).toEqual([]);
    expect(await find(owner, THAO)).toEqual(['2001', '2003', '2005']);
    expect(await find(desk, THAO)).toEqual([]);
    expect((await find(owner, 'linh tran')).length).toBeGreaterThan(0);
    expect(await find(desk, 'linh tran')).toEqual([]);
    expect(await find(desk, '(856) 555-7777')).toEqual([]);
    // the desk sees the customer masked: "Linh T." and the last four digits only
    const row = (await r.transactions(desk, await recent(desk), { page: 1, pageSize: 25 })).items.find((x) => x.ticketNumber === '2001')!;
    expect(row.customer).toMatchObject({ name: 'Linh T.', phone: '(•••) •••-7777' });
    expect((await r.summary(desk, await recent(desk))).permissions).toMatchObject({ customer: false, technicianContact: false });
    // the reference search still works for every role
    expect(await find(desk, '#2002')).toEqual(['2002']);
    expect(await find(desk, 'FX1005')).toEqual(['2005']);
  });
  it('another salon never appears — not in search, not in counts', async () => {
    expect(await find(owner, 'Other')).toEqual([]);
    const theirs = await r.transactions(otherSalon, await recent(otherSalon), { page: 1, pageSize: 25 });
    expect(theirs.items.map((x) => x.ticketNumber)).toEqual(['2001']);
    expect(theirs.items[0].amountCents).toBe(999);
  });
});

describe('Team Tips — calendar, paging, privacy', () => {
  it('the session branch time zone decides the days; From after To is refused (never silently reversed)', async () => {
    const main = await r.period(owner, { preset: 'today' });
    const maui = await r.period(hawaii, { preset: 'today' });
    expect(main.tz).toBe(TZ); expect(maui.tz).toBe(TZ2);
    await expect(r.period(owner, { preset: 'custom', from: '2026-11-20', to: '2026-11-01' })).rejects.toBeInstanceOf(FinanceError);
    const leap = await r.period(owner, { preset: 'custom', from: '2028-02-29', to: '2028-02-29' });
    expect([leap.from, leap.to]).toEqual(['2028-02-29', '2028-02-29']);
  });
  it('presets and Custom with the same days return the same totals', async () => {
    const wk = await r.period(owner, { preset: 'week' });
    const a = await r.summary(owner, r.filters(wk, {}));
    const b = await r.summary(owner, r.filters(await r.period(owner, { preset: 'custom', from: wk.from, to: wk.to }), {}));
    expect(b.kpis.totalTipsCents).toBe(a.kpis.totalTipsCents);
    expect(b.reconciliation.allocatedCents).toBe(a.reconciliation.allocatedCents);
  });
  it('page sizes 10 / 25 / 50 / 100, never more; newest first with a stable id tie-break across 120 rows', async () => {
    expect(tipsPageReq({ pageSize: 10 }).pageSize).toBe(10);
    expect(tipsPageReq({ pageSize: 100 }).pageSize).toBe(100);
    expect(tipsPageReq({ pageSize: 500 }).pageSize).toBe(100);
    for (let i = 0; i < 120; i++) { const t = await ticket({ tip: 100, tech: MAI, num: String(3000 + i), daysAgo: 6 }); await pay(t, 'card', 4100, 100); }
    const f = await recent();
    const p1 = await r.transactions(owner, f, tipsPageReq({ page: 1, pageSize: 100 }));
    const p2 = await r.transactions(owner, f, tipsPageReq({ page: 2, pageSize: 100 }));
    expect(p1.items.length).toBe(100); expect(p1.total).toBe(128); expect(p1.pageCount).toBe(2); expect(p2.items.length).toBe(28);
    const all = [...p1.items, ...p2.items];
    expect(new Set(all.map((x) => x.ticketId)).size).toBe(128);
    for (let i = 1; i < all.length; i++) expect(String(all[i - 1].collectedAt) >= String(all[i].collectedAt)).toBe(true);
    expect(p1.items[0].ticketNumber).toBe('2005');   // the newest tip event first (2005 was collected after 2001, both a day ago)
  });
  it('technicians (no pos.reports.view) are refused by the routes — no coworker tips', async () => {
    const ctl = new TipsScreenController(r);
    const req = { ctx: { tenantId: T, branchId: B, userId: id('e2'), role: 'TECHNICIAN', permissions: ['pos.login', 'tech.earnings.view_own'] } };
    expect(() => ctl.technicianEarnings(req, MAI, {})).toThrow(/cannot/i);
    expect(() => ctl.accuracy(req, {})).toThrow(/cannot/i);
    expect(() => ctl.distribution(req, {})).toThrow(/cannot/i);
  });
});

describe('Team Tips — read-only Tip Accuracy check', () => {
  it('names each finding with counts, cents and ticket ids — and writes nothing', async () => {
    const before = (await q(`select (select count(*) from ticket_tip_allocations)::int as a, (select count(*) from compensation_adjustments)::int as c, (select count(*) from payments)::int as p, (select coalesce(sum(tip_cents),0)::int from tickets) as t`)).rows[0];
    const acc = await r.accuracy(owner, await recent());
    const after = (await q(`select (select count(*) from ticket_tip_allocations)::int as a, (select count(*) from compensation_adjustments)::int as c, (select count(*) from payments)::int as p, (select coalesce(sum(tip_cents),0)::int from tickets) as t`)).rows[0];
    expect(after).toEqual(before);
    expect(acc.readOnly).toBe(true);
    const c = Object.fromEntries(acc.checks.map((x) => [x.key, x]));
    expect(c.period_match).toMatchObject({ status: 'warn', count: 1, cents: 400 }); expect(c.period_match.samples).toEqual([straddle]);
    expect(c.over_allocated).toMatchObject({ status: 'fail', count: 1, cents: 100 }); expect(c.over_allocated.samples).toEqual([over]);
    expect(c.duplicate_provider_reference).toMatchObject({ status: 'fail', count: 1 });
    expect(c.unsettled_tip).toMatchObject({ status: 'ok', count: 1 }); expect(c.unsettled_tip.samples).toEqual([declined]);
    expect(c.source_coverage.status).toBe('ok');
    expect(acc.overall).toBe('fail');
    expect(acc.totals.technicianSumCents).toBe(acc.totals.allocatedCents);
    expect(acc.totals.collectedCents).toBe((await r.summary(owner, await recent())).kpis.totalTipsCents);
    expect(dupA).toBeTruthy(); expect(single && pair && chosen).toBeTruthy();
  });
});
