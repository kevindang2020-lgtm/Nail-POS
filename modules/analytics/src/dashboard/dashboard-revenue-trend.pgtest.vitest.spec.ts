// dashboard-revenue-trend.pgtest — w4 sweep SW-10 (Oct 13 2026): the POS Dashboard's revenue trend chart (and its
// appointments-per-day bars) were ALWAYS flat zero. `(${date}::date - ${daysBack})` sends daysBack as an untyped parameter,
// PostgreSQL resolves `date - unknown` as date − date = integer, and `day >= integer` fails ("operator does not exist:
// date >= integer", x344 in the PostgreSQL log of the live sweep) — swallowed by .catch(() => []).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyDashboardRepo } from './dashboard.kysely.repository';

const P = 'c0f00000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), B = id('b1'), CUST = id('c0'), TECH = id('c1');
let db: any;

beforeAll(async () => {
  const pg: any = await migratedPglite(); db = kyselyFor(pg); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Trend LLC','Trend','dash-trend','DTRND1','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [CUST, T, B]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Mia','C','Mia C','active',true)`, [TECH, T, B]);
  for (const [n, at, cents] of [['1', '2026-10-06T16:00:00Z', 5000], ['2', '2026-10-04T15:00:00Z', 3000]] as const) {
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, total_cents, paid_at) values ($1,$2,$3,$4,'paid',$5,$6,$7)`, [id('e' + n), T, B, CUST, 'T' + n, cents, at]);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) values ($1,$2,$3,'cash',$4,'approved',$5)`, [T, B, id('e' + n), cents, at]);
  }
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source) values ($1,$2,$3,$4,'Ann Guest','[]','2026-10-05','10:00','10:45',45,'completed','online')`, [T, B, TECH, CUST]);
  // the window before the shown week (Sep 23 – Sep 29) and one day older still (Sep 22, in no window); a refunded payment
  // (not revenue-bearing) inside the previous window; 03:30Z on Sep 30 is still Sep 29 (23:30) in New York
  for (const [n, at, cents, st] of [['3', '2026-09-25T16:00:00Z', 4000, 'approved'], ['4', '2026-09-22T16:00:00Z', 9999, 'approved'], ['5', '2026-09-26T16:00:00Z', 7777, 'refunded'], ['6', '2026-09-30T03:30:00Z', 1000, 'approved']] as const) {
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, total_cents, paid_at) values ($1,$2,$3,$4,'paid',$5,$6,$7)`, [id('e' + n), T, B, CUST, 'T' + n, cents, at]);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) values ($1,$2,$3,'cash',$4,$5,$6)`, [T, B, id('e' + n), cents, st, at]);
  }
  for (const d of ['2026-09-26', '2026-09-27']) await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source) values ($1,$2,$3,$4,'Ann Guest','[]',$5,'10:00','10:45',45,'completed','online')`, [T, B, TECH, CUST, d]);
}, 180_000);

describe('POS Dashboard → revenue trend (week)', () => {
  it('the series carries each day\'s revenue and appointments in the salon\'s zone', async () => {
    const st: any = await new KyselyDashboardRepo(db).getAggregate({ tenantId: T, branchId: B }, { date: '2026-10-06', range: 'week' } as any);
    expect(st.revenueTrend.series).toHaveLength(7);
    expect(st.revenueTrend.totalCents).toBe(8000);
    expect(st.revenueTrend.series.reduce((a: number, x: any) => a + x.apptCount, 0)).toBe(1);
  });
});

// Operational Trend Explainability (Live Operations 10): the card states its exact source and window and compares it with
// the same-length window right before it — from the same rows, in the branch's day.
describe('POS Dashboard → revenue trend explanation', () => {
  it('week: the shown window, the previous 7 days and what changed', async () => {
    const repo = new KyselyDashboardRepo(db); repo.now = () => Date.parse('2026-10-06T18:00:00Z');
    const st: any = await repo.getAggregate({ tenantId: T, branchId: B }, { date: '2026-10-06', range: 'week' } as any);
    const e = st.revenueTrend.explain;
    expect(e).toMatchObject({ source: 'payments', appointmentSource: 'appointments', timeZone: 'America/New_York', from: '2026-09-30', to: '2026-10-06', previousFrom: '2026-09-23', previousTo: '2026-09-29', days: 7, includesToday: true });
    expect(e.statuses).toContain('approved');
    expect(e.statuses).not.toContain('refunded');
    // Sep 29 23:30 New York (03:30Z Sep 30) belongs to the PREVIOUS window; Sep 22 to none; the refund to none
    expect(e.currentCents).toBe(8000);
    expect(e.currentCents).toBe(st.revenueTrend.totalCents);
    expect(e.previousCents).toBe(5000);
    expect(e.changeCents).toBe(3000);
    expect(e.changePercent).toBe(60);
    expect(e.currentAppointments).toBe(1);
    expect(e.previousAppointments).toBe(2);
    expect(e.peakDay).toEqual({ date: '2026-10-06', valueCents: 5000 });
  });
  it('today: compares with yesterday; a past date is not "in progress"; no previous revenue → no percentage', async () => {
    const repo = new KyselyDashboardRepo(db); repo.now = () => Date.parse('2026-10-20T18:00:00Z');
    const st: any = await repo.getAggregate({ tenantId: T, branchId: B }, { date: '2026-10-06', range: 'today' } as any);
    expect(st.revenueTrend.explain).toMatchObject({ from: '2026-10-06', to: '2026-10-06', previousFrom: '2026-10-05', previousTo: '2026-10-05', days: 1, currentCents: 5000, previousCents: 0, changePercent: null, includesToday: false });
  });
});

describe('POS Dashboard → period slices return the card shapes', () => {
  it('revenue-trend / top-services / payment-mix slices are what the Live Operations cards draw', async () => {
    const { DashboardService } = await import('./dashboard.service');
    const svc = new DashboardService(new KyselyDashboardRepo(db));
    const tc = { tenantId: T, branchId: B, userId: 'u1', role: 'owner', permissions: [] } as any;
    const rt: any = await svc.getRevenueTrend(tc, { date: '2026-10-06', range: 'week' });
    expect(rt.period).toBe('week'); expect(rt.series).toHaveLength(7); expect(rt.totalCents).toBe(8000); expect(rt.points).toBeUndefined();
    const mix: any = await svc.getPaymentMix(tc, { date: '2026-10-06', range: 'week' });
    expect(mix.period).toBe('week'); expect(Array.isArray(mix.entries)).toBe(true);
    expect(mix.entries.find((x: any) => x.method === 'cash')?.amountCents).toBe(8000);
    expect(Array.isArray(await svc.getTopServices(tc, { date: '2026-10-06', range: 'week' }))).toBe(true);
  });
});
