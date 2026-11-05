// end-of-day-followups-core.spec.ts — Nest-free harness for DailyFollowUpService (post-service customer follow-up tasks).
// A fake port with a MUTABLE task store (so status transitions re-read through taskById) + a permissive fake realtime
// exercise the role resolution, task ownership scoping, per-status guards, settings validation, and the core lifecycle
// transitions (send / hold-for-approval / dismiss / approve / no-app / customer reply). esbuild + node, ok() style.
import { DailyFollowUpService } from './end-of-day-followups.service';
import { FollowUpError } from './end-of-day-followups.dto';
import type { TaskRecord } from './end-of-day-followups.repository';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); ok(name, false); } catch (e: any) { ok(name, e instanceof FollowUpError && e.code === code); }
}

const T = 't1', B = 'b1', TECH = 'tech-1', CUST = 'cust-1';
const ctx = { tenantId: T, branchId: B, userId: 'u1', role: 'STAFF' };

function makeTask(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task1', tenantId: T, branchId: B, businessDate: '2026-06-18', status: 'pending', customerId: CUST,
    customerName: 'Dana', customerPhone: null, customerAppUserId: 'app1', serviceId: 'svc1', serviceName: 'Gel Mani',
    ticketId: 'tk1', ticketNumber: '001', ticketServiceLineId: 'tsl1', appointmentId: null, technicianId: TECH,
    technicianName: 'Ava', completedAt: null, templateKey: null, suggestedMessage: 'Thanks for visiting!',
    sentMessage: null, sentAt: null, skipReason: null, ...over,
  };
}

type Opts = { techId?: string | null; custId?: string | null; settings?: Record<string, any>; task?: TaskRecord };
function makeRepo(o: Opts = {}) {
  const settings = { generationTime: '19:00', allowTechEditMessage: true, allowCustomerReplies: true, requireManagerApproval: false, ...(o.settings || {}) };
  const store = new Map<string, TaskRecord>();
  const t = o.task === undefined ? makeTask() : o.task;
  if (t) store.set(t.id, t);
  const audits: any[] = []; const notifs: any[] = []; const edits: any[] = [];
  return {
    audits, notifs, edits, store,
    async resolveTechnicianId() { return o.techId === undefined ? TECH : o.techId; },
    async resolveCustomerRecordId() { return o.custId === undefined ? CUST : o.custId; },
    async settingsFor() { return settings; },
    async saveSettings(_c: any, patch: any) { return { ...settings, ...patch }; },
    async taskById(id: string) { return store.get(id) ?? null; },
    async tasksForTechnician() { return [...store.values()]; },
    async tasksForBranch() { return [...store.values()]; },
    async tasksForCustomer() { return [...store.values()]; },
    async markSent(_t: string, id: string, message: string) { const r = store.get(id); if (r) { r.status = 'sent'; r.sentMessage = message; r.sentAt = 'now'; } },
    async markStatus(_t: string, id: string, status: any, skipReason?: string | null) { const r = store.get(id); if (r) { r.status = status; if (skipReason !== undefined) r.skipReason = skipReason ?? null; } },
    async updateMessage(_t: string, id: string, message: string) { edits.push({ id, message }); const r = store.get(id); if (r) r.suggestedMessage = message; },
    async markCustomerViewed() { /* no-op */ },
    async createCustomerNotification(_t: string, _c: string, _title: string, body: string, ref: string) { notifs.push({ body, ref }); return 'notif1'; },
    async audit(entry: any) { audits.push(entry); },
  };
}
const rt = { toTenant: () => {}, toTechnician: () => {}, toCustomer: () => {}, toCustomerDisplay: () => {} };
const svc = (o: Opts = {}) => new DailyFollowUpService(makeRepo(o) as any, rt as any);

(async () => {
  // ---- role resolution ----
  await throwsCode('techList requires a linked technician', () => svc({ techId: null }).techList(ctx, {}), 'not_technician');
  await throwsCode('customerList requires a linked customer', () => svc({ custId: null }).customerList(ctx), 'not_found');

  // ---- task ownership / scoping ----
  await throwsCode('techGet 404s a task from another tenant', () => svc({ task: makeTask({ tenantId: 'other' }) }).techGet(ctx, 'task1'), 'not_found');
  await throwsCode('techGet forbids another technician\'s task', () => svc({ task: makeTask({ technicianId: 'tech-2' }) }).techGet(ctx, 'task1'), 'forbidden');
  await throwsCode('customerGet hides a not-yet-sent task', () => svc({ task: makeTask({ status: 'pending' }) }).customerGet(ctx, 'task1'), 'not_found');

  // ---- per-status guards ----
  await throwsCode('a sent follow-up cannot be dismissed', () => svc({ task: makeTask({ status: 'sent' }) }).techDismiss(ctx, 'task1'), 'invalid_state');
  await throwsCode('editing is blocked when disabled for the branch', () => svc({ settings: { allowTechEditMessage: false } }).techEditMessage(ctx, 'task1', 'hi'), 'forbidden');
  await throwsCode('only a pending follow-up can be edited', () => svc({ task: makeTask({ status: 'sent' }) }).techEditMessage(ctx, 'task1', 'hi'), 'invalid_state');
  await throwsCode('an edited message cannot be empty', () => svc().techEditMessage(ctx, 'task1', '   '), 'validation');
  await throwsCode('only an awaiting-approval follow-up can be approved', () => svc({ task: makeTask({ status: 'skipped' }) }).managerApprove(ctx, 'task1'), 'invalid_state');
  await throwsCode('replies blocked when disabled for the salon', () => svc({ task: makeTask({ status: 'sent' }), settings: { allowCustomerReplies: false } }).customerReply(ctx, 'task1', 'thanks'), 'forbidden');
  await throwsCode('a customer reply cannot be empty', () => svc({ task: makeTask({ status: 'sent' }) }).customerReply(ctx, 'task1', '  '), 'validation');
  await throwsCode('generationTime must be HH:mm', () => svc().saveSettings(ctx, { generationTime: '7pm' } as any), 'validation');

  // ---- lifecycle transitions ----
  {
    const repo = makeRepo(); const r = await new DailyFollowUpService(repo as any, rt as any).techSend(ctx, 'task1');
    ok('techSend delivers to a customer with the app (→ sent + notification)', r.status === 'sent' && repo.notifs.length === 1);
  }
  {
    const repo = makeRepo({ settings: { requireManagerApproval: true } });
    const r = await new DailyFollowUpService(repo as any, rt as any).techSend(ctx, 'task1');
    ok('techSend holds for approval when required', r.status === 'pending_manager_approval' && repo.notifs.length === 0);
  }
  {
    const repo = makeRepo({ task: makeTask({ customerAppUserId: null }) });
    const r = await new DailyFollowUpService(repo as any, rt as any).techSend(ctx, 'task1');
    ok('techSend marks customer_not_available with no app account', r.status === 'customer_not_available' && repo.notifs.length === 0);
  }
  {
    const repo = makeRepo();
    const r = await new DailyFollowUpService(repo as any, rt as any).techDismiss(ctx, 'task1');
    ok('techDismiss moves a pending task to dismissed', r.status === 'dismissed');
  }
  {
    const repo = makeRepo({ task: makeTask({ status: 'pending_manager_approval' }) });
    const r = await new DailyFollowUpService(repo as any, rt as any).managerApprove(ctx, 'task1');
    ok('managerApprove sends an awaiting-approval task', r.status === 'sent' && repo.notifs.length === 1 && repo.audits.some((a) => a.actionType === 'tech_followup_approved'));
  }
  {
    const repo = makeRepo({ task: makeTask({ status: 'sent' }) });
    const r = await new DailyFollowUpService(repo as any, rt as any).customerReply(ctx, 'task1', 'See you soon!');
    ok('customerReply records a reply on a sent task', r.status === 'customer_replied');
  }
  {
    const repo = makeRepo(); const saved = await new DailyFollowUpService(repo as any, rt as any).saveSettings(ctx, { generationTime: '20:30' } as any);
    ok('saveSettings persists a valid HH:mm + audits', (saved as any).generationTime === '20:30' && repo.audits.some((a) => a.actionType === 'end_of_day_followup_settings_updated'));
  }

  console.log(`\nend-of-day-followups-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
