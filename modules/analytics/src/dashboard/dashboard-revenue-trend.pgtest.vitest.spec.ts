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
}, 180_000);

describe('POS Dashboard → revenue trend (week)', () => {
  it('the series carries each day\'s revenue and appointments in the salon\'s zone', async () => {
    const st: any = await new KyselyDashboardRepo(db).getAggregate({ tenantId: T, branchId: B }, { date: '2026-10-06', range: 'week' } as any);
    expect(st.revenueTrend.series).toHaveLength(7);
    expect(st.revenueTrend.totalCents).toBe(8000);
    expect(st.revenueTrend.series.reduce((a: number, x: any) => a + x.apptCount, 0)).toBe(1);
  });
});
