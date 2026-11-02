import { describe, it, expect, vi } from 'vitest';
import { OverviewAggregateService } from './overview-aggregate.service';

const ctx = { userId: 'sa1', email: 'admin@platform.test', ip: '127.0.0.1' };

// Minimal fakes for the seven composed services.
const make = (over: Record<string, any> = {}) => {
  const overview = { getState: vi.fn().mockResolvedValue({ kpis: { totalTenants: 5 } }) };
  const platform = {
    platformDevices: vi.fn().mockResolvedValue({ kpis: { totalDevices: 10, online: 8, offline: 2 } }),
    platformPayments: vi.fn().mockResolvedValue({ kpis: { todayVolumeCents: 1000 } }),
    branchesDashboard: vi.fn().mockResolvedValue({ directory: [{ id: 'b1' }] }),
    platformServices: vi.fn().mockResolvedValue({ topServices: [{ name: 'Cut' }] }),
    platformAppointments: vi.fn().mockResolvedValue({ rows: [], byStatus: [] }),
    tenantsLiveMonitor: vi.fn().mockResolvedValue([{ tenantId: 't-a', ownerName: 'Pat Owner', plan: 'Standard', branchCount: 2, serviceDone: 2, checkout: 1, revenueTodayCents: 3000, deviceOnline: 2, deviceTotal: 3 }]),
    revenueHourlyTodayYesterday: vi.fn().mockResolvedValue({ today: Array(24).fill(0).map((_, i) => (i === 2 ? 6000 : 0)), yesterday: Array(24).fill(0).map((_, i) => (i === 14 ? 6500 : 0)) }),
  };
  const staff = { getOverview: vi.fn().mockResolvedValue({ kpis: { activeTechnicians: 3 } }) };
  const queue = { getOverview: vi.fn().mockResolvedValue({ kpis: { waitingNow: 1 }, items: [] }) };
  const checkin = { getOverview: vi.fn().mockResolvedValue({ kpis: { sessionsToday: 2 } }) };
  const memberships = { getOverview: vi.fn().mockResolvedValue({ kpis: { activeMembers: 4 } }) };
  const loyalty = { getOverview: vi.fn().mockResolvedValue({ kpis: { pointsRedeemed: 9 } }) };
  Object.assign({ overview, platform, staff, queue, checkin, memberships, loyalty }, over);
  return new OverviewAggregateService(overview as any, platform as any, staff as any, queue as any, checkin as any, memberships as any, loyalty as any);
};

describe('OverviewAggregateService', () => {
  it('composes every section into one payload, passing the range through', async () => {
    const svc = make();
    const out = await svc.aggregate(ctx, 'week');
    expect(out.ok).toBe(true);
    expect(out.range).toBe('week');
    expect(out.state?.kpis.totalTenants).toBe(5);
    expect(out.devices?.kpis.totalDevices).toBe(10);
    expect(out.branches?.directory).toHaveLength(1);
    expect(out.staff?.kpis.activeTechnicians).toBe(3);
    expect(out.loyalty?.kpis.pointsRedeemed).toBe(9);
    expect(out.tenantsLive).toHaveLength(1);
    expect(out.tenantsLive?.[0]).toMatchObject({ tenantId: 't-a', ownerName: 'Pat Owner', plan: 'Standard', branchCount: 2, serviceDone: 2, checkout: 1, revenueTodayCents: 3000, deviceOnline: 2, deviceTotal: 3 });
    expect(out.revenueHourly?.today[2]).toBe(6000);
    expect(out.revenueHourly?.yesterday[14]).toBe(6500);
    expect(out.generatedAt).toBeTruthy();
  });

  it('threads tenant scope to the five module overviews and flags scoped=true', async () => {
    const staff = { getOverview: vi.fn().mockResolvedValue({ kpis: {} }) };
    const queue = { getOverview: vi.fn().mockResolvedValue({ kpis: {} }) };
    const checkin = { getOverview: vi.fn().mockResolvedValue({ kpis: {} }) };
    const memberships = { getOverview: vi.fn().mockResolvedValue({ kpis: {} }) };
    const loyalty = { getOverview: vi.fn().mockResolvedValue({ kpis: {} }) };
    const overview = { getState: vi.fn().mockResolvedValue({}) };
    const platform = {
      platformDevices: vi.fn().mockResolvedValue({}), platformPayments: vi.fn().mockResolvedValue({}),
      branchesDashboard: vi.fn().mockResolvedValue({}), platformServices: vi.fn().mockResolvedValue({}),
      platformAppointments: vi.fn().mockResolvedValue({}),
      tenantsLiveMonitor: vi.fn().mockResolvedValue([]),
      revenueHourlyTodayYesterday: vi.fn().mockResolvedValue({ today: [], yesterday: [] }),
    };
    const svc = new OverviewAggregateService(overview as any, platform as any, staff as any, queue as any, checkin as any, memberships as any, loyalty as any);
    const out = await svc.aggregate(ctx, 'month', { tenantId: 't-42' });
    expect(out.scoped).toBe(true);
    for (const m of [staff, queue, checkin, memberships, loyalty]) {
      expect(m.getOverview).toHaveBeenCalledWith(ctx, { scope: { tenantId: 't-42' } });
    }
    // Phase 1b: platform sections (device, branch, payments, services, appointments) are scoped too.
    expect(platform.platformDevices).toHaveBeenCalledWith({ tenantId: 't-42' });
    expect(platform.branchesDashboard).toHaveBeenCalledWith({ tenantId: 't-42' });
    expect(platform.platformPayments).toHaveBeenCalledWith({ tenantId: 't-42' });
    expect(platform.platformServices).toHaveBeenCalledWith({ tenantId: 't-42' });
    expect(platform.platformAppointments).toHaveBeenCalledWith({ tenantId: 't-42' });
    expect(platform.tenantsLiveMonitor).toHaveBeenCalledWith({ tenantId: 't-42' });
    expect(platform.revenueHourlyTodayYesterday).toHaveBeenCalledWith({ tenantId: 't-42' });
    // overview state receives the scope object (operational facts scope; governance KPIs stay platform-wide inside).
    expect(overview.getState).toHaveBeenCalledWith('month', 'SUPER_ADMIN', { tenantId: 't-42' });
  });

  it('is unscoped by default (scoped=false, no tenant passed)', async () => {
    const svc = make();
    const out = await svc.aggregate(ctx, 'month');
    expect(out.scoped).toBe(false);
  });

  it('is fail-soft: a rejected dependency becomes null, the rest still resolve', async () => {
    const overview = { getState: vi.fn().mockRejectedValue(new Error('db down')) };
    const platform = {
      platformDevices: vi.fn().mockRejectedValue(new Error('boom')),
      platformPayments: vi.fn().mockResolvedValue({ kpis: { todayVolumeCents: 500 } }),
      branchesDashboard: vi.fn().mockResolvedValue({ directory: [] }),
      platformServices: vi.fn().mockResolvedValue({ topServices: [] }),
      platformAppointments: vi.fn().mockResolvedValue({ rows: [], byStatus: [] }),
      tenantsLiveMonitor: vi.fn().mockRejectedValue(new Error('boom')),
      revenueHourlyTodayYesterday: vi.fn().mockResolvedValue({ today: Array(24).fill(0), yesterday: Array(24).fill(0) }),
    };
    const stub = { getOverview: vi.fn().mockResolvedValue({ kpis: {} }) };
    const svc = new OverviewAggregateService(overview as any, platform as any, stub as any, stub as any, stub as any, stub as any, stub as any);
    const out = await svc.aggregate(ctx, 'month');
    expect(out.ok).toBe(true);
    expect(out.state).toBeNull();      // rejected → null
    expect(out.devices).toBeNull();    // rejected → null
    expect(out.tenantsLive).toBeNull(); // rejected → null (new section is fail-soft too)
    expect(out.payments?.kpis.todayVolumeCents).toBe(500); // unaffected
  });
});
