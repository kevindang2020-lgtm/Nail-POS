// scheduled-reports.scheduler — D5 (Oct 22 2026): NOTHING ran the Super Admin scheduled reports. Two stores waited for an
// external cron nobody called (218 super_admin_scheduled_reports; 272 scheduled_reports). The richer store is the
// authority and runs in-process behind SCHEDULED_REPORTS_CRON_ENABLED (off by default); the older store is kept and its
// due rows run in the same tick when its runner is bound.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ScheduledReportsScheduler, scheduledReportsCronEnabled, SCHEDULED_REPORTS_ACTOR } from './scheduled-reports.scheduler';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; vi.useRealTimers(); });

const fakes = (due = 0) => {
  const calls: string[] = [];
  const reports = { runDue: vi.fn(async (ctx: any, nowIso: string) => { calls.push(`authority:${ctx.email}:${nowIso}`); return { ranAt: nowIso, dueCount: due, results: Array.from({ length: due }, (_, i) => ({ scheduleId: `s${i}`, runId: `r${i}`, status: i === 0 ? 'error' : 'success' })) }; }) };
  const legacy = { runDueScheduledReports: vi.fn(async () => { calls.push('legacy'); return { ran: 2, results: [] }; }) };
  return { calls, reports, legacy };
};

describe('Super Admin scheduled reports are actually run', () => {
  it('the flag is OFF unless set (dev / CI never generate reports on a timer)', () => {
    delete process.env.SCHEDULED_REPORTS_CRON_ENABLED;
    expect(scheduledReportsCronEnabled()).toBe(false);
    expect(scheduledReportsCronEnabled({ SCHEDULED_REPORTS_CRON_ENABLED: 'on' } as any)).toBe(true);
  });
  it('one tick runs the authority store\'s due schedules as the system actor, then the older store — in that order', async () => {
    const f = fakes(2);
    const s = new ScheduledReportsScheduler(f.reports as any, f.legacy);
    const r = await s.tick(new Date(Date.UTC(2026, 9, 22, 9)));
    expect(f.calls).toEqual([`authority:${SCHEDULED_REPORTS_ACTOR.email}:2026-10-22T09:00:00.000Z`, 'legacy']);
    expect(r).toEqual({ due: 2, legacyRan: 2 });
  });
  it('without the older store\'s runner bound only the authority runs; an older-store failure never stops the tick', async () => {
    const f = fakes(1);
    expect(await new ScheduledReportsScheduler(f.reports as any, null).tick()).toEqual({ due: 1, legacyRan: 0 });
    const broken = { runDueScheduledReports: vi.fn(async () => { throw new Error('notifier down'); }) };
    expect(await new ScheduledReportsScheduler(f.reports as any, broken).tick()).toEqual({ due: 1, legacyRan: 0 });
  });
  it('a tick already running is not re-entered', async () => {
    const f = fakes(0);
    let release!: () => void;
    f.reports.runDue.mockImplementationOnce(() => new Promise((res) => { release = () => res({ ranAt: '', dueCount: 0, results: [] }); }));
    const s = new ScheduledReportsScheduler(f.reports as any, null);
    const first = s.tick();
    expect(await s.tick()).toEqual({ due: 0, legacyRan: 0 });
    expect(f.reports.runDue).toHaveBeenCalledTimes(1);
    release(); await first;
  });
  it('armed only when the flag is on (and this process runs report jobs)', () => {
    vi.useFakeTimers();
    const f = fakes();
    delete process.env.PROCESS_ROLE;
    process.env.SCHEDULED_REPORTS_CRON_ENABLED = '0';
    const off = new ScheduledReportsScheduler(f.reports as any, null); off.onModuleInit();
    expect(off.armed).toBe(false);
    process.env.SCHEDULED_REPORTS_CRON_ENABLED = '1';
    const on = new ScheduledReportsScheduler(f.reports as any, null); on.onModuleInit();
    expect(on.armed).toBe(true);
    on.onModuleDestroy(); expect(on.armed).toBe(false);
  });
});
