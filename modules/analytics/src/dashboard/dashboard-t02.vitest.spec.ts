import { describe, it, expect } from 'vitest';
import { InMemoryDashboardRepo } from './dashboard.repository';

// T02 (Tenant Dashboard / Analytics) added three modules + a fuller KPI strip to the consolidated state. These assert
// the seeded dev tenant exposes them and that a real tenant with no data sees honest zeros (no mock data leaks).
describe('T02 dashboard state — Live Activity / Retention / Multi-Location', () => {
  const repo = new InMemoryDashboardRepo();

  it('seeded tenant returns the new modules and the full KPI strip', async () => {
    const s = await repo.getAggregate({ tenantId: 'luxe001', branchId: 'br_cherryhill' }, {} as any);
    expect(s.liveActivity.length).toBeGreaterThan(0);
    expect(s.liveActivity[0]).toHaveProperty('elapsedMinutes');
    expect(s.liveActivity[0]).toHaveProperty('technicianName');
    expect(s.customerRetention.totalCustomers).toBe(358);
    expect(s.customerRetention.returningPercent + s.customerRetention.newPercent + s.customerRetention.inactivePercent).toBeGreaterThan(99);
    expect(s.multiLocation).toHaveLength(3);
    expect(s.multiLocation[0]).toHaveProperty('checkIns');
    expect(s.kpis.monthlyCardVolumeCents).toBeGreaterThan(0);
    expect(s.kpis.appointmentsToday).toBeGreaterThan(0);
    expect(s.kpis.averageTicketCents).toBeGreaterThan(0);
    expect(s.kpis.aiBookingConversionPercent).toBeGreaterThan(0);
  });

  it('a tenant with no data sees honest zeros, not seeded values', async () => {
    const s = await repo.getAggregate({ tenantId: 't_empty', branchId: null }, {} as any);
    expect(s.liveActivity).toHaveLength(0);
    expect(s.multiLocation).toHaveLength(0);
    expect(s.customerRetention.totalCustomers).toBe(0);
    expect(s.kpis.appointmentsToday).toBe(0);
    expect(s.kpis.monthlyCardVolumeCents).toBe(0);
  });
});

// §9 period selector — the on-card dropdowns pass ?range=today|week|month; the in-memory adapter reflects it in the
// period-scoped cards (the Kysely adapter windows the real SQL identically). Verifies the range is honored, not ignored.
describe('dashboard range selector (period-scoped cards)', () => {
  const repo = new InMemoryDashboardRepo();
  const scope = { tenantId: 'luxe001', branchId: 'br_cherryhill' };

  it('defaults to the week window when no range is given', async () => {
    const s = await repo.getAggregate(scope, {} as any);
    expect(s.revenueTrend.period).toBe('week');
    expect(s.revenueTrend.series).toHaveLength(7);
    expect(s.paymentMix.period).toBe('week');
  });

  it('range=today collapses the trend to a single point and labels the period', async () => {
    const s = await repo.getAggregate(scope, { range: 'today' } as any);
    expect(s.revenueTrend.period).toBe('today');
    expect(s.revenueTrend.series).toHaveLength(1);
    expect(s.paymentMix.period).toBe('today');
    // total reflects only the retained point
    expect(s.revenueTrend.totalCents).toBe(s.revenueTrend.series[0].valueCents);
  });

  it('range=month expands the trend window and labels the period', async () => {
    const s = await repo.getAggregate(scope, { range: 'month' } as any);
    expect(s.revenueTrend.period).toBe('month');
    expect(s.revenueTrend.series).toHaveLength(30);
    expect(s.paymentMix.period).toBe('month');
    expect(s.revenueTrend.totalCents).toBe(s.revenueTrend.series.reduce((a, x) => a + x.valueCents, 0));
  });
});
