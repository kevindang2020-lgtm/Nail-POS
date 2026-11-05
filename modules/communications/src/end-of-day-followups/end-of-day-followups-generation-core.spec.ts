// end-of-day-followups-generation-core.spec.ts — Nest-free harness for the generation + scheduler + expiry surface of
// DailyFollowUpService (the half the lifecycle harness deliberately left out). A fake port exercises the once-per-day
// generation gate (and the manual force bypass), the insert/skip accounting + failure handling, the scheduler's
// enabled/time-of-day/already-ran gating with per-branch error isolation, and the stale-expiry / retention-purge windows.
// esbuild + node, ok() style.
import { DailyFollowUpService } from './end-of-day-followups.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsAsync(name: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(name, false); } catch { ok(name, true); }
}

const T = 't1';
function line(over: Record<string, any> = {}) {
  return {
    customerId: 'c1', technicianId: 'tech-1', ticketId: 'tk1', ticketServiceLineId: 'tsl1', serviceId: 'svc1',
    serviceName: 'Gel Mani', customerName: 'Dana', customerPhone: null, technicianName: 'Ava',
    customerAppUserId: 'app1', completedAt: '2026-06-18T22:00:00.000Z', ...over,
  };
}
const SETTINGS = { enabled: true, timezone: 'America/New_York', generationTime: '00:00', defaultMessageTemplate: null, reminderToTech: true, autoExpirePendingHours: 24 };

type Opts = {
  tz?: string | null; settings?: Record<string, any>; settingsFor?: (b: string) => any; alreadyRan?: boolean;
  runExists?: (b: string) => boolean; lines?: any[]; created?: number; insertThrows?: boolean;
  branches?: { tenantId: string; branchId: string }[]; expireResult?: number; purgeResult?: number;
};
function makeRepo(o: Opts = {}) {
  const settings = { ...SETTINGS, ...(o.settings || {}) };
  const audits: any[] = []; const runs: any[] = []; const notified: any[] = [];
  return {
    audits, runs, notified,
    async branchTimezone() { return o.tz === undefined ? 'America/New_York' : o.tz; },
    async settingsFor(_t: string, b: string) { return o.settingsFor ? o.settingsFor(b) : settings; },
    async runExists(_t: string, b: string) { return o.runExists ? o.runExists(b) : (o.alreadyRan ?? false); },
    async audit(e: any) { audits.push(e); },
    async completedServiceLines() { return o.lines ?? []; },
    async insertTasksIgnoreConflict(rows: any[]) { if (o.insertThrows) throw new Error('insert failed'); return o.created ?? rows.length; },
    async recordRun(r: any) { runs.push(r); },
    async notifyTechnicians(_t: string, ids: string[]) { notified.push(ids); },
    async activeBranches() { return o.branches ?? []; },
    async expireStalePending() { return o.expireResult ?? 0; },
    async purgeExpired() { return o.purgeResult ?? 0; },
  };
}
const rt = { toTenant: () => {}, toTechnician: () => {}, toCustomer: () => {}, toCustomerDisplay: () => {} };
const svc = (o: Opts = {}) => new DailyFollowUpService(makeRepo(o) as any, rt as any);
const NOW = new Date('2026-06-18T23:30:00.000Z');

(async () => {
  // ---- generateForBranch: the once-per-day gate + force bypass ----
  {
    const r = await svc({ alreadyRan: true, lines: [line()] }).generateForBranch(T, 'b1', { triggerSource: 'scheduler' });
    ok('scheduler skips a branch already generated today', r.alreadyRan === true && r.created === 0);
  }
  {
    const repo = makeRepo({ alreadyRan: true, lines: [line(), line({ ticketServiceLineId: 'tsl2' })], created: 2 });
    const r = await new DailyFollowUpService(repo as any, rt as any).generateForBranch(T, 'b1', { triggerSource: 'manual', force: true });
    ok('manual Generate Now forces past the gate', r.alreadyRan === false && r.created === 2);
  }

  // ---- generateForBranch: insert/skip accounting + notifications + failure ----
  {
    const repo = makeRepo({ lines: [line(), line({ ticketServiceLineId: 'tsl2' })], created: 2 });
    const r = await new DailyFollowUpService(repo as any, rt as any).generateForBranch(T, 'b1', { triggerSource: 'scheduler' });
    ok('all newly-completed lines become tasks', r.created === 2 && r.skipped === 0 && repo.runs.some((x) => x.runStatus === 'completed'));
    ok('techs are notified when tasks were created', repo.notified.length === 1);
  }
  {
    const repo = makeRepo({ lines: [line(), line({ ticketServiceLineId: 'tsl2' })], created: 1 }); // one was a duplicate
    const r = await new DailyFollowUpService(repo as any, rt as any).generateForBranch(T, 'b1', { triggerSource: 'scheduler' });
    ok('duplicate lines count as skipped, not created', r.created === 1 && r.skipped === 1);
  }
  {
    const repo = makeRepo({ lines: [line()], created: 1, settings: { reminderToTech: false } });
    await new DailyFollowUpService(repo as any, rt as any).generateForBranch(T, 'b1', { triggerSource: 'scheduler' });
    ok('no tech reminder when the branch has it off', repo.notified.length === 0);
  }
  {
    const repo = makeRepo({ lines: [line()], insertThrows: true });
    await throwsAsync('a failed insert rethrows', () => new DailyFollowUpService(repo as any, rt as any).generateForBranch(T, 'b1', { triggerSource: 'scheduler' }));
    ok('a failed generation records a failed run', repo.runs.some((x) => x.runStatus === 'failed'));
  }

  // ---- runDueBranches: enabled / time-of-day / already-ran gating + per-branch isolation ----
  {
    const r = await svc({ branches: [{ tenantId: T, branchId: 'b1' }], lines: [line()], created: 1 }).runDueBranches(NOW);
    ok('scheduler runs an enabled, due, not-yet-run branch', r.branchesRun === 1 && r.totalCreated === 1);
  }
  {
    const r = await svc({ branches: [{ tenantId: T, branchId: 'b1' }], settingsFor: () => ({ ...SETTINGS, enabled: false }) }).runDueBranches(NOW);
    ok('scheduler skips a disabled branch', r.branchesRun === 0);
  }
  {
    const r = await svc({ branches: [{ tenantId: T, branchId: 'b1' }], runExists: () => true, lines: [line()] }).runDueBranches(NOW);
    ok('scheduler skips a branch already generated today', r.branchesRun === 0);
  }
  {
    const settingsFor = (b: string) => { if (b === 'bad') throw new Error('boom'); return SETTINGS; };
    const r = await svc({ branches: [{ tenantId: T, branchId: 'bad' }, { tenantId: T, branchId: 'good' }], settingsFor, lines: [line()], created: 1 }).runDueBranches(NOW);
    ok('one branch failing does not stop the others', r.branchesRun === 1 && r.totalCreated === 1);
  }

  // ---- expireStaleTasks: window gating ----
  {
    const repo = makeRepo({ branches: [{ tenantId: T, branchId: 'b1' }], expireResult: 3 });
    const r = await new DailyFollowUpService(repo as any, rt as any).expireStaleTasks(NOW);
    ok('stale pending tasks are expired + audited', r.expired === 3 && repo.audits.some((a) => a.actionType === 'service_follow_up_tasks_expired'));
  }
  {
    const r = await svc({ branches: [{ tenantId: T, branchId: 'b1' }], settingsFor: () => ({ ...SETTINGS, autoExpirePendingHours: 0 }), expireResult: 9 }).expireStaleTasks(NOW);
    ok('expiry is off when the window is 0', r.expired === 0);
  }

  // ---- purgeExpiredTasks: retention window ----
  ok('purge removes rows older than the retention window', (await svc({ purgeResult: 5 }).purgeExpiredTasks(NOW, 30)).purged === 5);
  ok('purge is disabled when retention <= 0', (await svc({ purgeResult: 5 }).purgeExpiredTasks(NOW, 0)).purged === 0);

  console.log(`\nend-of-day-followups-generation-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
