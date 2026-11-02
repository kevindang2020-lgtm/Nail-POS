// Server-side Tenant Performance report — pure core (filter/sort/paginate/summary) + service pagination.
import { describe, it, expect } from 'vitest';
import { applyPerformanceQuery, filterPerf, sortPerf, summarizePerf, normalizePerfQuery, type PerfRow } from './tenant-performance-core';
import { SuperAdminPlatformService } from './super-admin-platform.service';

const mk = (over: Partial<PerfRow>): PerfRow => ({
  rank: 0, tenantId: 't', tenantName: 'X', city: null, state: null, plan: null, status: null,
  monthlyCardVolumeCents: 0, priorMonthVolumeCents: 0, growthPercent: 0, transactionCount: 0, averageTicketCents: 0, ...over,
});
const rows: PerfRow[] = [
  mk({ rank: 1, tenantId: 't1', tenantName: 'Luxe Nails & Spa', city: 'Houston', state: 'TX', plan: 'Enterprise', status: 'active', monthlyCardVolumeCents: 12485000, priorMonthVolumeCents: 10000000, growthPercent: 24.9, transactionCount: 420, averageTicketCents: 29726 }),
  mk({ rank: 2, tenantId: 't2', tenantName: 'Diamond Nail Bar', city: 'Miami', state: 'FL', plan: 'Professional', status: 'active', monthlyCardVolumeCents: 9632000, priorMonthVolumeCents: 11000000, growthPercent: -12.4, transactionCount: 300, averageTicketCents: 32106 }),
  mk({ rank: 3, tenantId: 't3', tenantName: 'New Salon', city: 'Dallas', state: 'TX', plan: 'Starter', status: 'paused', monthlyCardVolumeCents: 500000, priorMonthVolumeCents: 0, growthPercent: null, transactionCount: 20, averageTicketCents: 25000 }),
  mk({ rank: 4, tenantId: 't4', tenantName: 'Quiet Salon', city: 'Reno', state: 'NV', plan: 'Starter', status: 'active', monthlyCardVolumeCents: 0, priorMonthVolumeCents: 0, growthPercent: 0, transactionCount: 0, averageTicketCents: 0 }),
];

describe('tenant-performance-core', () => {
  it('search matches name/city/state/plan/status', () => {
    expect(filterPerf(rows, { search: 'miami' }).map((r) => r.tenantId)).toEqual(['t2']);
    expect(filterPerf(rows, { search: 'tx' }).map((r) => r.tenantId).sort()).toEqual(['t1', 't3']);
  });
  it('filters by state/status/plan and volume range and growth direction', () => {
    expect(filterPerf(rows, { state: 'TX' }).length).toBe(2);
    expect(filterPerf(rows, { status: 'paused' }).map((r) => r.tenantId)).toEqual(['t3']);
    expect(filterPerf(rows, { plan: 'Starter' }).length).toBe(2);
    expect(filterPerf(rows, { minVolume: 1000000 }).map((r) => r.tenantId).sort()).toEqual(['t1', 't2']);
    expect(filterPerf(rows, { maxVolume: 600000 }).map((r) => r.tenantId).sort()).toEqual(['t3', 't4']);
    expect(filterPerf(rows, { growthDirection: 'negative' }).map((r) => r.tenantId)).toEqual(['t2']);
    expect(filterPerf(rows, { growthDirection: 'new' }).map((r) => r.tenantId)).toEqual(['t3']);
  });
  it('sorts by whitelisted key with nulls last', () => {
    expect(sortPerf(rows, 'growthPercent', 'desc').map((r) => r.tenantId)).toEqual(['t1', 't4', 't2', 't3']);
    expect(sortPerf(rows, 'transactionCount', 'asc').map((r) => r.tenantId)[0]).toBe('t4');
  });
  it('summary reflects the full set (avg over tenants with volume)', () => {
    const s = summarizePerf(rows);
    expect(s.totalVolumeCents).toBe(22617000);
    expect(s.activeTenantsIncluded).toBe(3);
    expect(s.topTenantVolumeCents).toBe(12485000);
    expect(s.momGrowthPercent).toBe(7.7); // (22617000-21000000)/21000000
  });
  it('paginates with clamped page + page-size', () => {
    const r = applyPerformanceQuery(rows, { limit: 2, page: 2, sortBy: 'monthlyCardVolume', sortDirection: 'desc' });
    expect(r.total).toBe(4); expect(r.pageSize).toBe(2); expect(r.totalPages).toBe(2); expect(r.page).toBe(2);
    expect(r.rows.map((x) => x.tenantId)).toEqual(['t3', 't4']);
    const over = applyPerformanceQuery(rows, { limit: 2, page: 99 });
    expect(over.page).toBe(2); // clamped to last page
  });
  it('normalizes query (caps limit, defaults)', () => {
    const q = normalizePerfQuery({ limit: 9999, page: -3, sortDirection: 'asc' });
    expect(q.limit).toBe(100); expect(q.page).toBe(1); expect(q.sortDirection).toBe('asc');
  });
});

describe('tenantPerformanceReport service', () => {
  it('returns a page + total + summary from the repo rows', async () => {
    const svc = new SuperAdminPlatformService({ tenantPerformanceRows: async () => rows } as any);
    const r = await svc.tenantPerformanceReport({ state: 'TX', sortBy: 'monthlyCardVolume', limit: 1 });
    expect(r.total).toBe(2); expect(r.rows.length).toBe(1); expect(r.rows[0].tenantId).toBe('t1');
    expect(r.summary.activeTenantsIncluded).toBe(2);
  });
  it('never fabricates when the repo is empty', async () => {
    const svc = new SuperAdminPlatformService({ tenantPerformanceRows: async () => [] } as any);
    const r = await svc.tenantPerformanceReport({});
    expect(r.total).toBe(0); expect(r.rows).toEqual([]);
  });
});
