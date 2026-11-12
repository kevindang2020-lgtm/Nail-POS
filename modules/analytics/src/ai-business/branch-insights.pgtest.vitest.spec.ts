// branch-insights.pgtest — A3 AI Branch Comparison "not built" parts (Nov 6 2026; migration 827) on the REAL schema:
// fair scorecard (per worked technician hour, per operating hour, returning customers), the measured explanation of a
// difference, the growth advisor, the recorded Branch Data Health Checker.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BranchInsights, BranchInsightsError, operatingHoursOver, explainDifference, explainEvidence, adviseBranches, type ScorecardRow } from './branch-insights';

const id = (n: number) => `82700000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), BIG = id(2), SMALL = id(3), OWNER = id(10), C1 = id(20), C2 = id(21), C3 = id(22), TECH = id(30);
const PERMS = ['pos.ai_business.view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: '', userId: OWNER, role: 'OWNER', permissions: PERMS, ...o });
let pg: any; let db: any; let bi: BranchInsights;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof BranchInsightsError ? e.code : e?.message; } }
const NOW = Date.parse('2026-11-06T20:00:00Z');
// what AiBusinessBranchesService.compareBranches returns for "week" (its own tests cover it): BIG 3× the sales of SMALL
const compare = {
  async compareBranches(c: any) {
    if (!c.permissions.includes('pos.ai_business.view')) throw new Error('forbidden');
    return { preset: 'week', range: { from: '2026-11-02', to: '2026-11-06' }, financialsIncluded: true, branches: [
      { branchId: BIG, branchName: 'Big Main St', status: 'active', netSalesCents: 300000, ticketsCount: 60, averageTicketCents: 5000, totalBookings: 70, completed: 60, completionRate: 86, cancelledPercent: 5, noShowPercent: 9 },
      { branchId: SMALL, branchName: 'Small Annex', status: 'active', netSalesCents: 100000, ticketsCount: 16, averageTicketCents: 6250, totalBookings: 18, completed: 16, completionRate: 89, cancelledPercent: 5, noShowPercent: 2 },
    ] } as any;
  },
};

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Lux','bi-827','BI827','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Big Main St','active','UTC'), ($2,$3,'Small Annex','active','UTC')`, [BIG, SMALL, T]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$3,'Owner','o@bi.test','active','OWNER'), ($2,$3,'Tech','t@bi.test','active','TECHNICIAN')`, [OWNER, TECH, T]);
  // BIG: 5 shifts × 10 h = 50 technician hours; SMALL: 2 shifts × 5 h = 10 h
  for (let d = 2; d <= 6; d++) await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date,$5,$6,'closed')`,
    [T, BIG, TECH, `2026-11-0${d}`, `2026-11-0${d}T09:00:00Z`, `2026-11-0${d}T19:00:00Z`]);
  for (const d of [3, 5]) await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4::date,$5,$6,'closed')`,
    [T, SMALL, TECH, `2026-11-0${d}`, `2026-11-0${d}T10:00:00Z`, `2026-11-0${d}T15:00:00Z`]);
  // opening hours: BIG every day 9–19 (10 h); SMALL none
  for (let dow = 0; dow < 7; dow++) await q(`insert into tenant_location_hours (tenant_id, location_id, day_of_week, opens_at, closes_at, is_closed) values ($1,$2,$3,'09:00','19:00',false)`, [T, BIG, dow]);
  // customers: C1 returning at BIG (visited in October), C2 new at BIG, C3 new at SMALL
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$4,$5,'A','A','A A'), ($2,$4,$5,'B','B','B B'), ($3,$4,$5,'C','C','C C')`, [C1, C2, C3, T, BIG]);
  const tk = (b: string, c: string, at: string) => q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,'paid',5000,5000,$4,$5,$5)`, [T, b, c, 'BI' + Math.random(), at]);
  await tk(BIG, C1, '2026-10-10T15:00:00Z'); await tk(BIG, C1, '2026-11-03T15:00:00Z'); await tk(BIG, C2, '2026-11-04T15:00:00Z'); await tk(SMALL, C3, '2026-11-05T15:00:00Z');
  bi = new BranchInsights(db, compare, () => NOW);
}, 180_000);

describe('A3 — fair scorecard', () => {
  it('BI-01 per worked technician hour, per operating hour and returning customers; the small branch outranks the big one per hour', async () => {
    const s = await bi.scorecard(ctx(), { preset: 'week' });
    const big = s.rows.find((r) => r.branchId === BIG)!, small = s.rows.find((r) => r.branchId === SMALL)!;
    expect(big).toMatchObject({ technicianHours: 50, operatingHours: 50, netPerTechnicianHourCents: 6000, netPerOperatingHourCents: 6000, customers: 2, returningCustomers: 1, returningRate: 50 });
    expect(small).toMatchObject({ technicianHours: 10, operatingHours: null, netPerTechnicianHourCents: 10000, netPerOperatingHourCents: null, customers: 1, returningRate: 0 });
    expect(small.rank.perTechnicianHour).toBe(1);                  // $1,000 earned in 10 h beats $3,000 in 50 h
    expect(big.rank.perTechnicianHour).toBe(2);
    expect(big.rank.perOperatingHour).toBe(1); expect(small.rank.perOperatingHour).toBeNull();
    expect(s.advice.map((a) => [a.branchName, a.kind])).toEqual(expect.arrayContaining([['Small Annex', 'no_opening_hours']]));
  });
  it('BI-09 trend flags come from the EXISTING alert rules: triggered evaluations in the period per branch and metric; open incidents counted; salon-wide and out-of-period rows not attributed', async () => {
    const rule = async (branch: string | null, metric: string) => (await q(`insert into ai_business_alerts (tenant_id, branch_id, created_by_user_id, title, metric_id, operator, threshold, preset, min_sample_size, frequency, channel, active)
      values ($1,$2,$3,'r','${metric}','lt',50000,'week',1,'daily','in_app',true) returning id`, [T, branch, OWNER]))[0].id as string;
    const ev = (rid: string, branch: string | null, metric: string, at: string, o: { triggered?: boolean; value?: number; status?: string | null; sampleOk?: boolean } = {}) =>
      q(`insert into ai_business_alert_events (tenant_id, branch_id, alert_id, source, metric_id, operator, threshold, preset, value, sample_size, min_sample_size, sample_ok, triggered, state_change, evaluated_at, incident_status)
        values ($1,$2,$3,'scheduled',$4,'lt',50000,'week',$5,10,1,$6,$7,'triggered',$8::timestamptz,$9)`, [T, branch, rid, metric, o.value ?? 30000, o.sampleOk ?? true, o.triggered ?? true, at, o.status === undefined ? 'open' : o.status]);
    const rs = await rule(SMALL, 'net_sales'), rn = await rule(SMALL, 'no_show_rate'), rb = await rule(BIG, 'customer_retention'), rall = await rule(null, 'net_sales');
    await ev(rs, SMALL, 'net_sales', '2026-11-03T15:00:00Z', { value: 40000, status: 'resolved' });
    await ev(rs, SMALL, 'net_sales', '2026-11-05T15:00:00Z', { value: 30000 });                 // latest, still open
    await ev(rs, SMALL, 'net_sales', '2026-10-20T15:00:00Z');                                    // before the week: not counted
    await ev(rn, SMALL, 'no_show_rate', '2026-11-04T15:00:00Z', { triggered: false, status: null });   // evaluated, not triggered
    await ev(rn, SMALL, 'no_show_rate', '2026-11-04T16:00:00Z', { sampleOk: false });                 // too small a sample
    await ev(rb, BIG, 'customer_retention', '2026-11-06T10:00:00Z', { value: 20, status: 'resolved' });
    await ev(rall, null, 'net_sales', '2026-11-04T15:00:00Z');                                   // salon-wide rule: no branch
    const s = await bi.scorecard(ctx(), { preset: 'week' });
    const small = s.rows.find((r) => r.branchId === SMALL)!, big = s.rows.find((r) => r.branchId === BIG)!;
    expect(small.trendFlags).toEqual([{ family: 'revenue', metricId: 'net_sales', unit: 'cents', triggered: 2, openIncidents: 1, latestValue: 30000, threshold: 50000, operator: 'lt', latestAt: '2026-11-05T15:00:00.000Z', route: '/tenant/ai/business/alerts' }]);
    expect(big.trendFlags).toEqual([expect.objectContaining({ family: 'retention', metricId: 'customer_retention', unit: 'percent', triggered: 1, openIncidents: 0, latestValue: 20 })]);
  });
  it('BI-02 opening hours honour closed days and effective dates', () => {
    const rows = [{ day_of_week: 1, opens_at: '09:00', closes_at: '17:30', is_closed: false }, { day_of_week: 0, opens_at: '10:00', closes_at: '15:00', is_closed: true },
      { day_of_week: 2, opens_at: '09:00', closes_at: '17:00', is_closed: false, effective_from: '2026-11-04' }];
    expect(operatingHoursOver(rows, '2026-11-01', '2026-11-03')).toBe(8.5);   // Sun closed, Mon 8.5 h, Tue (Nov 3) before the rule starts
    expect(operatingHoursOver([], '2026-11-01', '2026-11-03')).toBeNull();
  });
});

describe('A3 — explanation and advisor', () => {
  it('BI-03 the bridge adds up: volume (tickets at B\'s average) + average ticket = the whole difference; no invented cause', async () => {
    const e = await bi.explain(ctx(), { preset: 'week', a: BIG, b: SMALL });
    expect(e.bridge).toEqual({ volumeCents: 275000, priceCents: -75000, totalCents: 200000 });
    expect(e.lines[0]).toBe('Big Main St took $2,000.00 more than Small Annex.');
    expect(e.lines.join(' ')).toMatch(/No-shows: 9% vs 2%/);
    expect(e.lines.at(-1)).toMatch(/measured differences, not causes/);
    expect(await code(bi.explain(ctx(), { a: BIG, b: BIG }))).toBe('VALIDATION_FAILED');
    expect(await code(bi.explain(ctx(), { a: BIG, b: id(99) }))).toBe('BRANCH_NOT_AUTHORIZED');
  });
  it('BI-06 Source-to-Answer: the explanation carries every figure it rests on for both branches, the source of each, the salon days and the as-of time; read-only', async () => {
    const before = (await q(`select (select count(*) from ai_business_health_runs)::int as h, (select count(*) from tickets)::int as t`))[0];
    const e = await bi.explain(ctx(), { preset: 'week', a: BIG, b: SMALL });
    const ev = e.evidence;
    expect(ev.asOf).toBe('2026-11-06T20:00:00.000Z');
    expect(ev.a).toEqual({ branchId: BIG, branchName: 'Big Main St', timeZone: 'UTC', range: { from: '2026-11-02', to: '2026-11-06' } });
    expect(ev.b.branchId).toBe(SMALL);
    const by = Object.fromEntries(ev.figures.map((x) => [x.key, x]));
    // the same numbers the bridge used: net 3000 vs 1000, tickets 60 vs 16 — from the Sales Report
    expect(by.net_sales).toEqual({ key: 'net_sales', unit: 'cents', a: 300000, b: 100000, source: 'sales_report', hidden: false });
    expect(by.paid_tickets).toMatchObject({ a: 60, b: 16, source: 'sales_report' });
    expect(e.bridge!.totalCents).toBe(by.net_sales.a! - by.net_sales.b!);
    expect(by.no_show_rate).toMatchObject({ a: 9, b: 2, source: 'booking_report' });
    expect(by.technician_hours).toMatchObject({ a: 50, b: 10, unit: 'hours', source: 'time_clock' });
    expect(by.operating_hours).toMatchObject({ a: 50, b: null, source: 'opening_hours' });     // SMALL has no hours: unknown, never 0
    expect(by.returning_customers).toMatchObject({ a: 1, b: 0, source: 'paid_tickets' });
    expect(ev.sources.map((x) => x.source).sort()).toEqual(['booking_report', 'opening_hours', 'paid_tickets', 'sales_report', 'time_clock']);
    expect(ev.sources.find((x) => x.source === 'sales_report')!.route).toBe('/tenant/reports/sales');
    const after = (await q(`select (select count(*) from ai_business_health_runs)::int as h, (select count(*) from tickets)::int as t`))[0];
    expect(after).toEqual(before);
    // revenue hidden for the viewer: money figures are null and marked hidden, counts stay
    const row = (await bi.scorecard(ctx(), { preset: 'week' })).rows;
    const hid = explainEvidence(row[0], row[1], { asOf: 'x', preset: 'week', financialsIncluded: false });
    const hb = Object.fromEntries(hid.figures.map((x) => [x.key, x]));
    expect(hb.net_sales).toMatchObject({ a: null, b: null, hidden: true });
    expect(hb.average_ticket).toMatchObject({ a: null, b: null, hidden: true });
    expect(hb.bookings).toMatchObject({ hidden: false, a: 70 });
  });
  it('BI-04 advisor rules state their numbers: low yield per technician hour, high no-shows, low return rate', () => {
    const base = (o: Partial<ScorecardRow>): ScorecardRow => ({ branchId: 'x', branchName: 'X', status: 'active', timeZone: 'UTC', netSalesCents: 1, ticketsCount: 1, averageTicketCents: 1, totalBookings: 1, completed: 1,
      completionRate: 100, noShowPercent: 2, cancelledPercent: 0, technicianHours: 10, operatingHours: 10, customers: 20, returningCustomers: 10, netPerTechnicianHourCents: 10000,
      netPerOperatingHourCents: 1, returningRate: 50, rank: { perTechnicianHour: null, perOperatingHour: null, returningRate: null }, ...o });
    const rows = [base({ branchId: 'a', branchName: 'A' }), base({ branchId: 'b', branchName: 'B' }), base({ branchId: 'c', branchName: 'C', netPerTechnicianHourCents: 5000, noShowPercent: 12, returningRate: 30 })];
    const adv = adviseBranches(rows);
    expect(adv.map((a) => a.kind).sort()).toEqual(['high_no_shows', 'low_return_rate', 'low_yield_per_tech_hour']);
    expect(adv.find((a) => a.kind === 'low_yield_per_tech_hour')!.message).toMatch(/C earns \$50\.00 per technician hour, below the salon median of \$100\.00/);
    expect(adviseBranches([rows[0]])).toEqual([]);                   // nothing to compare against
    expect(explainDifference({ ...rows[0], netSalesCents: null, ticketsCount: null }, rows[1]).lines[0]).toMatch(/Revenue is hidden/);
  });
});

describe('A3 — Branch Data Health Checker', () => {
  it('BI-05 recorded, read-only, reused within 30 s; flags missing opening hours and a shift never clocked out', async () => {
    await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,'2026-11-05','2026-11-05T09:00:00Z',null,'open')`, [T, SMALL, TECH]);
    const h = await bi.check(ctx());
    const by = Object.fromEntries(h.checks.map((c) => [c.key, c]));
    expect(h.overall).toBe('WARNING');
    expect(by.opening_hours).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.open_shifts).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.tenant_isolation.state).toBe('PASSED'); expect(by.branch_time_zones.state).toBe('PASSED');
    expect((await bi.check(ctx())).reused).toBe(true);
    expect((await q(`select count(*)::int as n from ai_business_health_runs where tenant_id = $1 and area = 'branches'`, [T]))[0].n).toBe(1);
    expect(await code(bi.check(ctx({ permissions: [] })))).toBe('PERMISSION_DENIED');
  });
});
