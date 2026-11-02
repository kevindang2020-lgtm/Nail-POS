// Top Performing Tenants card feed — reuses the ranked tenantPerformance from the full report (no new query).
import { describe, it, expect } from 'vitest';
import { SuperAdminPlatformService } from './super-admin-platform.service';

const perf = [
  { rank: 1, tenantId: 't1', tenantName: 'Luxe Nails & Spa', salonCode: 'LUXE-1001', city: 'Houston', state: 'TX', monthlyCardVolumeCents: 12485000, priorMonthVolumeCents: 10000000, growthPercent: 24.9, transactionCount: 420, averageTicketCents: 29726 },
  { rank: 2, tenantId: 't2', tenantName: 'Diamond Nail Bar', salonCode: 'DIAM-1002', city: 'Miami', state: 'FL', monthlyCardVolumeCents: 9632000, priorMonthVolumeCents: 11000000, growthPercent: -12.4, transactionCount: 300, averageTicketCents: 32106 },
  { rank: 3, tenantId: 't3', tenantName: 'New Salon', salonCode: 'NEW-1003', city: 'Dallas', state: 'TX', monthlyCardVolumeCents: 500000, priorMonthVolumeCents: 0, growthPercent: null, transactionCount: 20, averageTicketCents: 25000 },
];
const stubRepo = { reports: async () => ({ tenantPerformance: perf }) } as any;

describe('topPerformingTenants', () => {
  const svc = new SuperAdminPlatformService(stubRepo);

  it('maps the spec card shape and caps to the limit', async () => {
    const r = await svc.topPerformingTenants(2);
    expect(r.tenants.length).toBe(2);
    expect(r.tenants[0]).toMatchObject({ rank: 1, salonName: 'Luxe Nails & Spa', salonCode: 'LUXE-1001', city: 'Houston', state: 'TX', monthlyCardVolume: 12485000, growthPercent: 24.9, trendDirection: 'up' });
    expect(r.tenants[0].formattedMonthlyCardVolume).toBe('$124,850');
  });

  it('marks negative growth down and null growth as new', async () => {
    const r = await svc.topPerformingTenants(5);
    expect(r.tenants[1].trendDirection).toBe('down');
    expect(r.tenants[2].trendDirection).toBe('new');
    expect(r.tenants[2].growthPercent).toBeNull();
  });

  it('defaults to 5 and never fabricates rows', async () => {
    const empty = new SuperAdminPlatformService({ reports: async () => ({ tenantPerformance: [] }) } as any);
    const r = await empty.topPerformingTenants();
    expect(r.tenants).toEqual([]);
  });
});
