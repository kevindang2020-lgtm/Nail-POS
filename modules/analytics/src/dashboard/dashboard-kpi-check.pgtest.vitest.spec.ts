// dashboard-kpi-check.pgtest — AI PowerSalon Live Operations 04: the KPI Accuracy & Reconciliation Checker against the REAL
// schema. Each Live Operations KPI equals the Overview board's value for the same branch / salon day / payment rules; a
// cached snapshot older than the data is called stale_cache (not a mismatch); a disagreeing definition is a mismatch; a KPI
// with no second source is not_checked — never a fabricated pass. Read only.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyDashboardRepo } from './dashboard.kysely.repository';
import { KyselyOverviewRepo } from '../overview/overview.kysely.repository';
import { DashboardService, type TenantContext } from './dashboard.service';
import { reconcileKpis } from './dashboard-kpi-check';
import type { TenantCache } from '@aipowersalon/cache';

const P = 'c0f40000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), B = id('b1'), CUST = id('c0'), TECH = id('c1');
let db: any; let pg: any; let today = '';
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const tc: TenantContext = { tenantId: T, branchId: B, userId: id('e9'), role: 'OWNER', permissions: ['pos.dashboard.view'] };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); clearBranchTimeZoneCache();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Check LLC','Check','dash-kpi-check','DKPIC1','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [CUST, T, B]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Mia','C','Mia C','active',true)`, [TECH, T, B]);
  today = (await q(`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d`)).rows[0].d;
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, total_cents, paid_at) values ($1,$2,$3,$4,'paid','K1',6000, now())`, [id('e1'), T, B, CUST]);
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) values ($1,$2,$3,'cash',6000,'approved', now()), ($1,$2,$3,'cash',2500,'refunded', now())`, [T, B, id('e1')]);
  await q(`insert into pos_queue_items (tenant_id, branch_id, customer_id, customer_name, status, source, checked_in_at) values ($1,$2,$3,'Ann Guest','waiting','walk_in', now())`, [T, B, CUST]);
}, 180_000);

describe('Live Operations 04 — KPI accuracy checker', () => {
  it('every checked KPI equals the Overview board for the same branch day (refunded payments excluded on both); the scope is stated', async () => {
    const svc = new DashboardService(new KyselyDashboardRepo(db), undefined, new KyselyOverviewRepo(db));
    const r = await svc.kpiCheck(tc, {});
    const row = (k: string) => r.rows.find((x) => x.kpi === k)!;
    expect(row('todayRevenueCents')).toMatchObject({ shown: 6000, fresh: 6000, authorityValue: 6000, authority: 'overview_board', status: 'match', reason: 'same_value' });
    expect(row('averageTicketCents')).toMatchObject({ shown: 6000, authorityValue: 6000, status: 'match' });
    expect(row('waitingGuests')).toMatchObject({ shown: 1, authorityValue: 1, status: 'match' });
    expect(row('checkInsToday')).toMatchObject({ shown: 1, authorityValue: 1, status: 'match' });
    expect(row('appointmentsToday')).toMatchObject({ status: 'not_checked', reason: 'no_second_source', authorityValue: null });
    expect(r.summary).toEqual({ match: 9, staleCache: 0, mismatch: 0, notChecked: 4 });
    expect(r.scope).toMatchObject({ branchId: B, timeZone: 'America/New_York', businessDate: today, revenueDateBasis: 'payment_created_branch_day' });
    expect(r.scope.revenueStatuses).toContain('approved');
    expect(r.scope.revenueStatuses).not.toContain('refunded');
    expect(r.cacheTtlSeconds).toBe(30);
  });

  it('a cached snapshot older than the data is stale_cache, not a mismatch; reading writes nothing', async () => {
    const repo = new KyselyDashboardRepo(db);
    const old = await repo.getAggregate({ tenantId: T, branchId: B }, {});
    const cache: TenantCache = { getOrSet: (async () => old) as TenantCache['getOrSet'], invalidate: async () => undefined } as unknown as TenantCache;
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) values ($1,$2,$3,'card',1500,'approved', now())`, [T, B, id('e1')]);
    const before = (await q(`select count(*)::int as n from payments where tenant_id = $1`, [T])).rows[0].n;
    const r = await new DashboardService(repo, cache, new KyselyOverviewRepo(db)).kpiCheck(tc, {});
    expect(r.rows.find((x) => x.kpi === 'todayRevenueCents')).toMatchObject({ shown: 6000, fresh: 7500, authorityValue: 7500, status: 'stale_cache', reason: 'cache_older_than_data' });
    expect(r.summary.mismatch).toBe(0);
    expect((await q(`select count(*)::int as n from payments where tenant_id = $1`, [T])).rows[0].n).toBe(before);
  });

  it('a disagreeing definition is a mismatch with both values; without an authority every KPI is not_checked', async () => {
    const fresh = await new KyselyDashboardRepo(db).getAggregate({ tenantId: T, branchId: B }, {});
    const authority = await new KyselyOverviewRepo(db).getAggregate({ tenantId: T, branchId: B }, {});
    const off = { ...authority, kpis: { ...authority.kpis, servingNow: { ...authority.kpis.servingNow, count: authority.kpis.servingNow.count + 2 } } };
    const r = reconcileKpis({ shown: fresh, fresh, authority: off, checkedAt: 'x', branchId: B, businessDate: today, cacheTtlSeconds: 30 });
    expect(r.rows.find((x) => x.kpi === 'servingNow')).toMatchObject({ fresh: 0, authorityValue: 2, status: 'mismatch', reason: 'definition_differs' });
    const none = reconcileKpis({ shown: fresh, fresh, authority: null, checkedAt: 'x', branchId: B, businessDate: today, cacheTtlSeconds: 30 });
    expect(none.summary).toEqual({ match: 0, staleCache: 0, mismatch: 0, notChecked: 13 });
  });
});
