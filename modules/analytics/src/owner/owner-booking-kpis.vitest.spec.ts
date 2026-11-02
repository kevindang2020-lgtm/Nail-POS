import { describe, it, expect } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';
import type { OwnerContext } from './owner.repository';

// Service-level tests for getBookingOverview — the appointment health figures an owner watches: completion, cancellation,
// and no-show rates (each a share of total via pctOf) plus their period-over-period trends (pct). Computed in the service
// from status counts, so exercised here against in-memory fakes (the SQL behind the counts is verified on live Postgres).
const ctx = (perms: string[], role = 'OWNER'): OwnerContext => ({ tenantId: 't1', userId: 'u1', role, permissions: perms } as any);

class BookingRepo extends InMemoryOwnerRepository {
  bi = 0; allowed: string[] | null = null;
  async allowedBranchIds() { return this.allowed; }
  async userHomeBranch() { return this.allowed ? this.allowed[0] : null; }
  async tenantTimezoneCurrency() { return { timezone: 'UTC', currency: 'USD' }; }
  // cur then prev
  async bookingStatusCounts() { return [{ total: 100, completed: 80, cancelled: 12, noShow: 8 }, { total: 50, completed: 35, cancelled: 10, noShow: 5 }][this.bi++]; }
  async bookingsByDate() { return []; }
}

describe('getBookingOverview — appointment rates and trends', () => {
  it('computes completion/cancellation/no-show rates as shares of total', async () => {
    const out = await new OwnerService(new BookingRepo()).getBookingOverview(ctx(['owner.bookings.view']), 'week');
    expect(out.totalBookings).toBe(100);
    expect(out.completed).toEqual({ count: 80, percentage: 80 });   // 80/100
    expect(out.cancelled).toEqual({ count: 12, percentage: 12 });   // 12/100
    expect(out.noShow).toEqual({ count: 8, percentage: 8 });        // 8/100
    expect(out.completionRate).toBe(80);
    expect(out.cancellationRate).toBe(12);
    expect(out.noShowRate).toBe(8);
  });

  it('computes each rate trend against the prior window', async () => {
    const out = await new OwnerService(new BookingRepo()).getBookingOverview(ctx(['owner.bookings.view']), 'week');
    // prev rates: completed 35/50=70, cancelled 10/50=20, noShow 5/50=10
    expect(out.completionRateTrendPercent).toBe(14.3);    // 80 vs 70 → (10/70)
    expect(out.cancellationRateTrendPercent).toBe(-40);   // 12 vs 20
    expect(out.noShowRateTrendPercent).toBe(-20);         // 8 vs 10
  });

  it('returns a 7-day trend series', async () => {
    const out = await new OwnerService(new BookingRepo()).getBookingOverview(ctx(['owner.bookings.view']), 'week');
    expect(out.trend).toHaveLength(7);
    expect(out.trend.every((d) => d.bookingCount === 0)).toBe(true); // no per-date rows in this fixture
  });

  it('requires owner.bookings.view', async () => {
    await expect(new OwnerService(new BookingRepo()).getBookingOverview(ctx(['owner.dashboard.view']))).rejects.toThrow(/permission/i);
  });

  it('rejects a branch outside a restricted manager’s assigned set', async () => {
    const repo = new BookingRepo(); repo.allowed = ['b1'];
    await expect(new OwnerService(repo).getBookingOverview(ctx(['owner.bookings.view'], 'MANAGER'), 'week', 'b2')).rejects.toThrow();
  });
});
