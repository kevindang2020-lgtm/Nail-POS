// eod-catch-up.vitest.spec — Nov 3 audit: a missed 8 PM end-of-day run (server down at generation time) used to be skipped for
// good, because after midnight the branch is "not yet 8 PM" for the NEW day. The scheduler now catches up yesterday — only the
// last missed day, and only for a branch that ran the day before it (a branch just switched on is never back-filled).
import { describe, it, expect } from 'vitest';
import { DailyFollowUpService } from './end-of-day-followups.service';

const T = 't1';
const SETTINGS = { enabled: true, timezone: 'America/New_York', generationTime: '20:00', defaultMessageTemplate: null, reminderToTech: false, autoExpirePendingHours: 24 };
const line = { customerId: 'c1', technicianId: 'tech-1', ticketId: 'tk1', ticketServiceLineId: 'tsl1', serviceId: 'svc1', serviceName: 'Gel Mani', customerName: 'Dana',
  customerPhone: null, technicianName: 'Ava', customerAppUserId: 'app1', completedAt: '2026-06-17T22:00:00.000Z', excluded: null, noApp: false, existingTaskId: null, nextBookingDate: null, lastSentAt: null };
function repo(ran: (date: string) => boolean) {
  const runs: any[] = []; const asked: string[] = [];
  return {
    runs, asked,
    async branchTimezone() { return 'America/New_York'; },
    async settingsFor() { return SETTINGS; },
    async runExists(_t: string, _b: string, d: string) { return ran(d); },
    async audit() {},
    async eodCandidates(_t: string, _b: string, _tz: string, d: string) { asked.push(d); return [line]; },
    async insertTasksIgnoreConflict(rows: any[]) { return rows.length; },
    async recordRun(r: any) { runs.push(r); },
    async notifyTechnicians() {},
    async activeBranches() { return [{ tenantId: T, branchId: 'b1' }]; },
    async expireStalePending() { return 0; },
  };
}
const rt = { toTenant: () => {}, toTechnician: () => {}, toCustomer: () => {}, toCustomerDisplay: () => {} };
const NOW = new Date('2026-06-18T23:30:00.000Z');   // 7:30 PM on Jun 18 in New York — before tonight's 8 PM run

describe('end-of-day catch-up', () => {
  it('yesterday missed, the day before ran → yesterday is generated now, for yesterday\'s date', async () => {
    const r = repo((d) => d === '2026-06-16');
    const out = await new DailyFollowUpService(r as any, rt as any).runDueBranches(NOW);
    expect(out).toEqual({ branchesRun: 1, totalCreated: 1 });
    expect(r.runs.map((x) => x.businessDate)).toEqual(['2026-06-17']);
    expect(r.asked).toEqual(['2026-06-17']);
  });
  it('yesterday already ran → nothing before 8 PM', async () => {
    const r = repo((d) => d === '2026-06-16' || d === '2026-06-17');
    expect(await new DailyFollowUpService(r as any, rt as any).runDueBranches(NOW)).toEqual({ branchesRun: 0, totalCreated: 0 });
  });
  it('no run the day before either (a branch just switched on) → never back-filled', async () => {
    const r = repo(() => false);
    expect(await new DailyFollowUpService(r as any, rt as any).runDueBranches(NOW)).toEqual({ branchesRun: 0, totalCreated: 0 });
  });
  it('after 8 PM the normal run for today still happens', async () => {
    const r = repo(() => false);
    const out = await new DailyFollowUpService(r as any, rt as any).runDueBranches(new Date('2026-06-19T00:30:00.000Z'));   // 8:30 PM Jun 18
    expect(out.branchesRun).toBe(1); expect(r.runs.map((x) => x.businessDate)).toEqual(['2026-06-18']);
  });
});
