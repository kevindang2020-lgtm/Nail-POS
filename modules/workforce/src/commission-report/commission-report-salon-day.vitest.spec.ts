// commission-report-salon-day — "Today" on the commission report is the SALON's day (wave 4 PILOT, Oct 13 2026).
// Found by live-pilot-day.mjs: at 20:00 UTC the pilot salon (UTC+14) was on Oct 14, but presetRange read the UTC date, so
// the window was the salon's Oct 13 and End of Day showed $0 commission / $0 tips while POS reports, the Tech App and
// payroll showed the day. Same in New York after 8 pm: "Today" turned into tomorrow. The repository already reads
// from/to as salon civil days; the service now asks the repository for the salon's business date.
import { describe, it, expect } from 'vitest';
import { InMemoryCommissionReportRepository } from './commission-report.repository';
import { CommissionReportService } from './commission-report.service';

const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['pos.reports.view'] };
const clock = () => new Date('2026-10-13T20:00:00Z');

class SalonRepo extends InMemoryCommissionReportRepository {
  asked: Array<[string, string]> = [];
  constructor(private today: string) { super(); }
  async salonToday() { return this.today; }
  async load(c: any, from: string, to: string) { this.asked.push([from, to]); return super.load(c, from, to); }
}

describe('commission report "today" follows the salon clock', () => {
  it('a salon already on Oct 14 (UTC+14) gets Oct 14, not the UTC Oct 13', async () => {
    const repo = new SalonRepo('2026-10-14');
    const st = await new CommissionReportService(repo, clock).getState(ctx, 'today');
    expect([st.from, st.to]).toEqual(['2026-10-14', '2026-10-14']);
    expect(repo.asked[0]).toEqual(['2026-10-14', '2026-10-14']);
  });
  it('New York at 4 pm (20:00 UTC) is still Oct 13; month starts Oct 1 of the salon month', async () => {
    const st = await new CommissionReportService(new SalonRepo('2026-10-13'), clock).getState(ctx, 'month');
    expect([st.from, st.to]).toEqual(['2026-10-01', '2026-10-13']);
  });
  it('a repository without a salon clock keeps the UTC date', async () => {
    const st = await new CommissionReportService(new InMemoryCommissionReportRepository(), clock).getState(ctx, 'today');
    expect(st.from).toBe('2026-10-13');
  });
});
