// booking-service-branch-clock.vitest.spec.ts — the booking service asks the repository for the BRANCH's clock (not the
// default-zone today()/nowMinuteOfDay()): the day grid's default date and its "nothing open in the past" rule follow it.
import { describe, it, expect } from 'vitest';
import { InMemoryBookingRepository } from './booking.repository';
import { BookingService } from './booking.service';

const ctx: any = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u', role: 'FRONT_DESK', permissions: ['pos.booking.view'] };

describe('BookingService uses repo.clock(ctx)', () => {
  it("the day grid opens nothing before the BRANCH's current minute, and defaults to the branch's day", async () => {
    const repo = new InMemoryBookingRepository();
    const day = repo.today();
    repo.nowMinuteOverride = 6 * 60;   // the default-zone clock: 6 am
    (repo as any).clock = async () => ({ today: day, nowMinute: 16 * 60, timeZone: 'America/Los_Angeles' });   // the branch: 4 pm
    const g: any = await new BookingService(repo).dayGrid(ctx);
    expect(g.date).toBe(day);
    const starts: number[] = g.columns.flatMap((c: any) => c.openRanges.map((r: any) => Number(r.start)));   // minutes of the day
    expect(starts.length).toBeGreaterThan(0);
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(16 * 60);
  });
});
