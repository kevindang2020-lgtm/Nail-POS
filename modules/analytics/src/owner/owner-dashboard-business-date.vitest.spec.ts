// owner-dashboard-business-date.vitest.spec.ts — wave 4 pilot P3: the Owner app's "Today's Overview" date chip showed the
// wrong day for a salon east of UTC. The dashboard's `date` was the UTC date of the salon's start-of-day instant
// (R.today.fromIso.slice(0, 10)): at UTC+14 the salon's Oct 14 starts at Oct 13 10:00Z → the chip read "October 13".
// It is the salon's BUSINESS date (its zone), from the server. Fixed clock.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository } from './owner.repository';

class ZoneRepo extends InMemoryOwnerRepository {
  constructor(private zone: string) { super(); }
  async allowedBranchIds() { return null; }
  async userHomeBranch() { return null; }
  async tenantTimezoneCurrency() { return { timezone: this.zone, currency: 'USD' }; }
}
const ctx: any = { tenantId: 't1', userId: 'u1', role: 'OWNER', permissions: ['owner.dashboard.view'] };
afterEach(() => vi.useRealTimers());

describe('Owner dashboard date = the salon\'s business date', () => {
  it('a salon at UTC+14 at 2026-10-13T12:00Z is already on Oct 14', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    expect((await new OwnerService(new ZoneRepo('Etc/GMT-14')).getDashboard({ ...ctx })).date).toBe('2026-10-14');
  });
  it('a salon in Los Angeles at 2026-10-14T03:00Z is still on Oct 13', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));
    expect((await new OwnerService(new ZoneRepo('America/Los_Angeles')).getDashboard({ ...ctx })).date).toBe('2026-10-13');
  });
});

describe('Booking overview carries the salon business date for its chip', () => {
  it('UTC+14: the window starting Oct 14 (salon) is reported as businessDateFrom 2026-10-14', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    const out: any = await new OwnerService(new ZoneRepo('Etc/GMT-14')).getBookingOverview({ ...ctx, permissions: ['owner.dashboard.view', 'owner.bookings.view'] } as any, 'today' as any);
    expect(out.businessDateFrom).toBe('2026-10-14');
  });
});
