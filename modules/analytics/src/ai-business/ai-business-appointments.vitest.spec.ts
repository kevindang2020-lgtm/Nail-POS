// ai-business-appointments.vitest.spec.ts — slice 4: appointment metrics (§13, §29).
import { ForbiddenError, type ReportsContext, type ReportFilters, type BookingsOverview, type QueueSummary, type AppointmentsTrend } from '@aipowersalon/reports';
import { describe, it, expect } from 'vitest';
import { AiBusinessAppointmentsService, type AppointmentSource } from './ai-business-appointments.service';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

const booking = (o: Partial<BookingsOverview>): BookingsOverview => ({ totalBookings: 0, completed: 0, completedPercent: 0, cancelled: 0, cancelledPercent: 0, noShow: 0, noShowPercent: 0, ...o });
const queue = (o: Partial<QueueSummary>): QueueSummary => ({ averageWaitMinutes: 0, longestWaitMinutes: 0, walkIns: 0, skipped: 0, peakWindow: '', byTechnician: [], ...o });

class FakeApptSource implements AppointmentSource {
  lastCtx: ReportsContext | null = null;
  constructor(private b: BookingsOverview, private q: QueueSummary, private t: AppointmentsTrend, private denyView = false) {}
  async getBooking(ctx: ReportsContext, _f?: ReportFilters) { this.lastCtx = ctx; if (this.denyView) throw new ForbiddenError('view'); return this.b; }
  async getQueue(_c: ReportsContext, _f?: ReportFilters) { return this.q; }
  async getAppointmentsTrend(_c: ReportsContext, _f?: ReportFilters) { return this.t; }
}
const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'pos.reports.view'], ...o });

describe('getAppointmentMetrics', () => {
  const trend: AppointmentsTrend = { points: [
    { label: 'Mon', date: '2026-06-01', bookings: 12, completed: 10 },
    { label: 'Tue', date: '2026-06-02', bookings: 20, completed: 18 },
    { label: 'Wed', date: '2026-06-03', bookings: 8, completed: 7 },
  ] };
  const src = new FakeApptSource(
    booking({ totalBookings: 40, completed: 35, completedPercent: 87, cancelled: 3, cancelledPercent: 8, noShow: 2, noShowPercent: 5 }),
    queue({ walkIns: 6, longestWaitMinutes: 10, skipped: 0 }),
    trend,
  );
  const svc = new AiBusinessAppointmentsService(src);

  it('passes the funnel through and adds walk-ins', async () => {
    const r = await svc.getAppointmentMetrics(CTX(), 'week');
    expect(r.funnel.totalBookings).toBe(40);
    expect(r.funnel.completed).toBe(35);
    expect(r.funnel.walkIns).toBe(6);
  });

  it('derives the busiest day from the trend', async () => {
    const r = await svc.getAppointmentMetrics(CTX(), 'week');
    expect(r.busiestDay?.date).toBe('2026-06-02');
    expect(r.busiestDay?.bookings).toBe(20);
  });

  it('lists only the fields it actually models (no fabricated lead-time/source/utilization)', async () => {
    const r = await svc.getAppointmentMetrics(CTX(), 'week');
    expect(r.modeledFields).not.toContain('leadTime');
    expect(r.modeledFields).toContain('walkIns');
    expect(r).not.toHaveProperty('utilization');
  });

  it('suppresses rate flags under the sample floor', async () => {
    const small = new AiBusinessAppointmentsService(new FakeApptSource(booking({ totalBookings: 3, noShow: 2, noShowPercent: 66 }), queue({}), { points: [] }));
    const r = await small.getAppointmentMetrics(CTX(), 'today');
    expect(r.limitedData).toBe(true);
    expect(r.attention.find((w) => w.code === 'no_show_rate')).toBeUndefined();
    expect(r.busiestDay).toBeNull();
  });

  it('rejects an invalid preset', async () => {
    try { await svc.getAppointmentMetrics(CTX(), 'eon'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
  });

  it('maps the reports view-permission denial to INSUFFICIENT_PERMISSION', async () => {
    const denied = new AiBusinessAppointmentsService(new FakeApptSource(booking({}), queue({}), { points: [] }, true));
    try { await denied.getAppointmentMetrics(CTX(), 'week'); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INSUFFICIENT_PERMISSION); }
  });

  it('builds the ReportsContext from the trusted tenant id', async () => {
    await svc.getAppointmentMetrics(CTX({ tenantId: 'tZ' }), 'month');
    expect(src.lastCtx?.tenantId).toBe('tZ');
  });
});
