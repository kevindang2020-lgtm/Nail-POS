// analytics-local-day.pgtest — the POS Overview and Dashboard count the BRANCH's day (Oct 6 2026), not UTC's. The clock is
// fixed at 9:30 pm Monday Oct 5 in New York (01:30 UTC Tuesday). Each figure gets a row from 10 am today, one from 9 pm
// tonight (Tuesday in UTC) and one from 11 pm last night (Monday in UTC): today is the first two, yesterday the third.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyOverviewRepo } from './overview.kysely.repository';
import { OverviewBoardService } from './overview-board.service';
import { KyselyDashboardRepo } from '../dashboard/dashboard.kysely.repository';
import { toPosOverviewState } from './overview.dto';

const T = 'e6000000-0000-4000-8000-0000000000a1', B = 'e6000000-0000-4000-8000-0000000000b1', C = 'e6000000-0000-4000-8000-0000000000c1';
const NOW = Date.parse('2026-10-06T01:30:00Z');
const TEN_AM = '2026-10-05T14:00:00Z', NINE_PM = '2026-10-06T01:00:00Z', ELEVEN_PM_SUN = '2026-10-05T03:00:00Z';
const scope: any = { tenantId: T, branchId: B };
let db: any;

beforeAll(async () => {
  const pg: any = await migratedPglite(); db = kyselyFor(pg); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Board Day LLC','Board Day','board-day','BDDAY1','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Day','Guest','Day Guest')`, [C, T, B]);
  for (const [cents, at, status] of [[5000, TEN_AM, 'captured'], [2000, NINE_PM, 'approved'], [9900, ELEVEN_PM_SUN, 'captured']] as const) {   // 'approved' is what checkout writes
    const k: any = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,'paid',$4) returning id`, [T, B, C, at])).rows[0];
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at) values ($1,$2,$3,'cash',$4,0,$6,$5)`, [T, B, k.id, cents, at, status]);
    await q(`insert into pos_queue_items (tenant_id, branch_id, customer_name, source, requested_services, priority, status, checked_in_at) values ($1,$2,$3,'walk_in','[]','normal','waiting',$4)`, [T, B, 'Guest ' + cents, at]);
  }
  // wave 4 pilot P3: completed SERVICE LINES today — 3 done (one an add-on on the same visit), 1 still in progress, 1 done
  // but removed, 1 done yesterday — against ONE completed appointment. "Completed services" is 3, not 1.
  const tk: any = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status) values ($1,$2,$3,'open') returning id`, [T, B, C])).rows[0];
  const CAT = 'e6000000-0000-4000-8000-0000000000d1', SVC = 'e6000000-0000-4000-8000-0000000000d2';
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel',45,1000)`, [SVC, T, B, CAT]);
  for (const [name, status, done, removed] of [['Gel', 'completed', TEN_AM, null], ['Art', 'completed', TEN_AM, null], ['Pedi', 'completed', NINE_PM, null], ['Acrylic', 'in_progress', null, null], ['Gone', 'completed', TEN_AM, TEN_AM], ['Old', 'completed', ELEVEN_PM_SUN, null]] as const) {
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, commission_type_snapshot, commission_value_snapshot, line_total_cents, status, completed_at, removed_at, created_at, updated_at, progress_percent)
             values ($1,$2,$3,$8,$4,1000,30,'percent',50,1000,$5,$6,$7,coalesce($6, now()),coalesce($6, now()),0)`, [T, B, tk.id, name, status, done, removed, SVC]);
  }
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, customer_id, appt_date, start_time, status, source) values ($1,$2,$3,'2026-10-05','10:00','completed','online')`, [T, B, C]).catch(() => undefined);
});

describe('the POS Overview', () => {
  it('opens on Monday in New York, and today\'s revenue is $70 (10 am + 9 pm) against yesterday\'s $99', async () => {
    const r = new KyselyOverviewRepo(db); r.now = () => NOW;
    const o: any = await r.getAggregate(scope, {} as never);
    expect(o.context.businessDate).toBe('2026-10-05');
    expect(o.context.timezone).toBe('America/New_York');
    expect(o.kpis.todayRevenue.amountCents).toBe(7000);
    expect(o.analytics.revenueTrend).toEqual([{ date: '2026-10-04', revenueCents: 9900 }, { date: '2026-10-05', revenueCents: 7000 }]);
  });
  it('the arrivals board lists tonight\'s and this morning\'s guests, not last night\'s', async () => {
    const b = new OverviewBoardService(db); b.now = () => NOW;
    const names = (await b.getBoard({ tenantId: T, branchId: B } as never)).arrivals.map((a: any) => a.customerName).sort();
    expect(names).toEqual(['Guest 2000', 'Guest 5000']);
  });
});

describe('the POS Dashboard', () => {
  it('today\'s revenue $70 vs yesterday $99; the trend\'s last day is Monday', async () => {
    const r = new KyselyDashboardRepo(db); r.now = () => NOW;
    const d: any = await r.getAggregate(scope, {} as never);
    expect(d.kpis.todayRevenueCents).toBe(7000);
    expect(d.kpis.todayRevenueTrendPercent).toBe(Math.round(((7000 - 9900) / 9900) * 1000) / 10);
  });
});

describe('completed services = completed service lines (wave 4 pilot P3)', () => {
  it('the overview and the dashboard count the 3 service lines done today, not the 1 completed appointment', async () => {
    const r = new KyselyOverviewRepo(db); r.now = () => NOW;
    const o: any = await r.getAggregate(scope, {} as never);
    expect(toPosOverviewState(o).todaySummary.completedServices).toBe(3);
    const d = new KyselyDashboardRepo(db); d.now = () => NOW;
    const dash: any = await d.getAggregate(scope, {} as never);
    expect(dash.operationsSnapshot.completedServices).toBe(3);
  });
});
