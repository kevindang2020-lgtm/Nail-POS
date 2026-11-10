// reports-daily-summary.pgtest — SUNMI batch 9, Daily Summary guide (Nov 10 2026) on the REAL schema:
//   §12  "Top service by revenue" is on the SALES basis ($96 lines), not the charged total ($96 + $7.44 tax + $1.55 surcharge)
//   §10  Customer Retention, No-Show Rate, Average Rating come from their own sources and are N/A (null) when undefined
//   §15  new vs returning is real (a paid ticket before the period → returning), not every customer marked "returning"
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyReportsRepository } from './reports.kysely.repository';
import { ReportsService } from './reports.service';

const id = (n: number) => 'a9001000-0000-4000-8000-' + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(3), BX = id(4), ANN = id(10), BEA = id(11), CAL = id(12), TECH = id(20), SVC = id(30), CAT = id(31);
let pg: any; let repo: KyselyReportsRepository; let today = ''; let from = '';
const ctx: any = { tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: [] };

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`SET TIME ZONE 'UTC'`);
  today = String((await pg.query(`select (now() at time zone 'America/New_York')::date::text as d`)).rows[0].d);
  from = String((await pg.query(`select ((now() at time zone 'America/New_York')::date - 6)::text as d`)).rows[0].d);
  const ticket = async (tid: number, cust: string, daysAgo: number, line: number, tax: number, sur: number) => {
    await pg.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, subtotal_cents, discount_cents, tip_cents, tax_cents, surcharge_cents, total_cents, paid_at)
      VALUES ('${id(tid)}', '${T}', '${B}', '${cust}', 'paid', '${TECH}', ${line}, 0, 0, ${tax}, ${sur}, ${line + tax + sur}, now() - interval '${daysAgo} days');
      INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
      VALUES ('${T}', '${B}', '${id(tid)}', '${SVC}', '${TECH}', 'Gel Manicure', ${line}, 45, ${line});
      INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status, created_at)
      VALUES ('${T}', '${B}', '${id(tid)}', 'card', ${line + tax + sur}, 0, ${sur}, 'approved', now() - interval '${daysAgo} days');`);
  };
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'D LLC', 'Daily', 'daily-b9', 'DAILYB9', 'active'), ('${X}', 'X LLC', 'Other', 'other-b9', 'OTHERB9', 'active');
    INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/New_York'), ('${BX}', '${X}', 'Other', 'active', 'America/New_York');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${ANN}', '${T}', '${B}', 'Ann', 'A', 'Ann A'), ('${BEA}', '${T}', '${B}', 'Bea', 'B', 'Bea B'), ('${CAL}', '${T}', '${B}', 'Cal', 'C', 'Cal C');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TECH}', '${T}', '${B}', 'Lisa', 'T', 'Lisa T', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 4800, 45, 'active');`);
  // this week: Ann twice ($48 + $48 lines; the guide's $96 + $7.44 tax + $1.55 surcharge = $104.99 charged), Bea once
  await ticket(100, ANN, 1, 4800, 372, 155); await ticket(101, ANN, 2, 4800, 372, 0); await ticket(102, BEA, 3, 2000, 0, 0);
  // the previous week: Ann and Cal (Ann came back this week, Cal did not → retention 50%); Bea's first visit is this week (new)
  await ticket(103, ANN, 9, 3000, 0, 0); await ticket(104, CAL, 10, 3000, 0, 0);
  // appointments this week: 3 scheduled (1 no-show), 1 cancelled → 33.3%
  for (const [n, st] of [[200, 'completed'], [201, 'completed'], [202, 'no_show'], [203, 'cancelled']] as const)
    await pg.exec(`INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, duration_minutes, status)
      VALUES ('${id(n)}', '${T}', '${B}', '${TECH}', 'X', (now() at time zone 'America/New_York')::date - 1, '${String(9 + (n - 200)).padStart(2, '0')}:00', '${String(9 + (n - 200)).padStart(2, '0')}:30', 30, '${st}')`);
  // reviews: 5 and 4 this week, a spam 1-star (excluded), another salon's 1-star (never counted)
  await pg.exec(`INSERT INTO reviews (tenant_id, branch_id, rating, source, created_at, is_spam) VALUES
    ('${T}', '${B}', 5, 'internal', now() - interval '1 day', false), ('${T}', '${B}', 4, 'google', now() - interval '2 days', false),
    ('${T}', '${B}', 1, 'google', now() - interval '1 day', true), ('${X}', '${BX}', 1, 'google', now() - interval '1 day', false)`);
  repo = new KyselyReportsRepository(kyselyFor(pg) as any);
}, 180_000);

describe('Daily Summary — the figures behind the eight KPIs and the insights', () => {
  it('§12 top service and top technician use the SALES basis — never the charged total with tax and surcharge', async () => {
    const { state } = await repo.query(ctx, { from, to: today });
    expect(state.salesKpis.grossSalesCents).toBe(11600);                    // 4800 + 4800 + 2000 lines
    expect(state.revenueByService[0]).toMatchObject({ serviceName: 'Nails', revenueCents: 11600, serviceCount: 3 });
    expect(state.topTechnicians[0]).toMatchObject({ revenueCents: 11600, completedServices: 3 });
    expect(state.payments.cardCents).toBe(11600 + 372 + 155 + 372);          // the card mix stays the amount CHARGED (incl. tax + surcharge)
  });
  it('§15 new vs returning is real; §10 retention has its cohort; none is a 0 that means "unknown"', async () => {
    const { state } = await repo.query(ctx, { from, to: today });
    expect(state.customerInsights).toMatchObject({ newCustomers: 1, returningCustomers: 1, retentionCohort: 2, retentionReturned: 1, retentionRatePercent: 50 });
    expect(state.kpis.newCustomers).toBe(1);
  });
  it('§10 no-show rate = no-shows ÷ scheduled (cancelled excluded); average rating is the Reputation definition', async () => {
    const { state } = await repo.query(ctx, { from, to: today });
    expect(state.kpis.noShowRatePercent).toBe(33.3);
    expect(state.bookingsOverview).toMatchObject({ noShow: 1, cancelled: 1 });
    expect(state.kpis.averageRating).toBe(4.5);
  });
  it('a period with no appointments, no reviews and no prior visits answers N/A (null), not 0', async () => {
    const old = String((await pg.query(`select ((now() at time zone 'America/New_York')::date - 60)::text as d`)).rows[0].d);
    const old2 = String((await pg.query(`select ((now() at time zone 'America/New_York')::date - 54)::text as d`)).rows[0].d);
    const { state } = await repo.query(ctx, { from: old, to: old2 });
    expect(state.kpis.noShowRatePercent).toBeNull();
    expect(state.kpis.averageRating).toBeNull();
    expect(state.customerInsights.retentionRatePercent).toBeNull();
  });
});

describe('Daily Summary — transactions, one page at a time (guide §8–§9)', () => {
  const owner: any = { ...ctx, userId: 'a9001000-0000-4000-8000-000000000099', role: 'OWNER', permissions: ['pos.reports.view', 'pos.reports.financial_view'] };
  it('newest first by recorded time; Showing X–Y of N; a page past the end is the last page', async () => {
    const svc = new ReportsService(repo as any);
    const p1 = await svc.getTransactionsPage(owner, { from, to: today }, '', 1, 10);
    expect(p1.total).toBe(3);
    expect(p1.items.map((t) => t.ticketId)).toEqual([id(100), id(101), id(102)]);   // 1, 2, 3 days ago
    expect(p1.items.every((t, i, a) => i === 0 || String(a[i - 1].occurredAt) >= String(t.occurredAt))).toBe(true);
    const far = await svc.getTransactionsPage(owner, { from, to: today }, '', 9, 10);
    expect(far.page).toBe(1);
  });
  it('search: customer name (accents and case folded) and a ticket reference; no match is an empty page, not an error', async () => {
    const svc = new ReportsService(repo as any);
    expect((await svc.getTransactionsPage(owner, { from, to: today }, 'BEA', 1, 10)).items.map((t) => t.customer)).toEqual(['Bea B']);
    expect((await svc.getTransactionsPage(owner, { from, to: today }, id(101).slice(-8), 1, 10)).items.map((t) => t.ticketId)).toEqual([id(101)]);
    expect(await svc.getTransactionsPage(owner, { from, to: today }, 'nobody here', 1, 10)).toMatchObject({ total: 0, items: [] });
  });
  it('Appointments Report outcomes (batch 9 guide 5): appointments by scheduled day, every status once, shares of one total', async () => {
    const { state } = await repo.query(ctx, { from, to: today });
    expect(state.bookingsOverview).toMatchObject({ basis: 'scheduled_date', totalBookings: 4, completed: 2, completedPercent: 50, cancelled: 1, cancelledPercent: 25, noShow: 1, noShowPercent: 25, open: 0, other: 0 });
    const empty = (await repo.query(ctx, { from: '2020-01-01', to: '2020-01-02' })).state.bookingsOverview;
    expect(empty).toMatchObject({ totalBookings: 0, completedPercent: null, noShowPercent: null });
  });
  it('Customers Report (batch 9 guide 7): counts on the payment day, real period changes, and the period customer list', async () => {
    const { state } = await repo.query(ctx, { from, to: today });
    // previous week: Ann + Cal, both first-time then → prevNew 2; this week new 1 → -50%; returning had no base → N/A
    expect(state.customerInsights).toMatchObject({ newCustomers: 1, returningCustomers: 1, newCustomersTrendPercent: -50, returningCustomersTrendPercent: null, retentionRateTrendPercent: null });
    const svc = new ReportsService(repo);
    const fin: any = { ...ctx, permissions: ['pos.reports.view', 'pos.reports.financial_view'] };
    const pg1 = await svc.getCustomersPage(fin, { from, to: today });
    expect(pg1.items.map((c) => [c.customer, c.type, c.visits, c.netSalesCents])).toEqual([['Ann A', 'returning', 2, 9600], ['Bea B', 'new', 1, 2000]]);
    expect((await svc.getCustomersPage(fin, { from, to: today }, { type: 'new' })).items.map((c) => c.customer)).toEqual(['Bea B']);
    const cv: any = { ...ctx, permissions: ['pos.reports.view', 'pos.reports.customer_view'] };
    const noMoney = await svc.getCustomersPage(cv, { from, to: today });
    expect(noMoney.moneyVisible).toBe(false); expect(noMoney.items.every((c) => c.netSalesCents === null)).toBe(true);
    await expect(svc.getCustomersPage({ ...ctx, permissions: ['pos.reports.view'] } as any, { from, to: today })).rejects.toThrow();
  });
});

