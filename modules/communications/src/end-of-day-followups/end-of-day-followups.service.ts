/**
 * end-of-day-followups.service.ts — orchestration for the Daily Follow-Up Queue. Holds the generation logic (one task
 * per completed service line, owned by the line's technician_id — the main-tech rule), the timezone-aware scheduler
 * gate (runDueBranches, clock-injected for tests), and the per-role surfaces (tech / manager / customer) with all
 * tenant/branch/tech/customer scoping enforced server-side. Depends only on the repository port.
 */
import type { FollowUpTemplateOption } from '@aipowersalon/api-contracts/tenant';
import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import type { GenerateResult } from '@aipowersalon/api-contracts/tenant';
export type { GenerateResult };   // owned by packages/api-contracts (Constitution 13 §13)
import type { DailyFollowUpPort, TaskRecord, NewTaskRow } from './end-of-day-followups.repository';
import {
  FollowUpError, type FollowUpContext, type FollowUpSettings, type FollowUpStatus, type FollowUpTaskView,
  type TechStats, type RebookPreselect, FOLLOW_UP_TEMPLATES, renderTemplate, localDateInTz, localMinutesInTz, parseHHMM,
} from './end-of-day-followups.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
import { EOD_RULE_VERSION, summarizeCandidates, type ClaimResult } from './eod-center';

const DEFAULT_TZ = 'America/New_York';

/** a refused send → the registry code the POS / Tech app shows (guide §12 "clear status reasons") */
const REFUSAL: Record<string, (detail?: string) => Error> = {
  not_found: () => withCode(new FollowUpError('not_found', 'Follow-up not found.'), 'FOLLOWUP_NOT_FOUND'),
  invalid_state: () => withCode(new FollowUpError('invalid_state', 'This follow-up cannot be sent in its current state.'), 'FOLLOWUP_STATE_INVALID'),
  expired: () => withCode(new FollowUpError('invalid_state', 'This follow-up expired and can no longer be sent.'), 'FOLLOWUP_EXPIRED'),
  customer_archived: () => withCode(new FollowUpError('forbidden', 'This customer is archived and is not contacted.'), 'FOLLOWUP_CUSTOMER_ARCHIVED'),
  already_booked: (d) => withCode(new FollowUpError('forbidden', `The customer already booked their next visit${d ? ` (${d})` : ''}. A manager can send anyway with a reason.`), 'FOLLOWUP_ALREADY_BOOKED'),
  recently_contacted: () => withCode(new FollowUpError('forbidden', 'The customer already received a follow-up recently. A manager can send anyway with a reason.'), 'FOLLOWUP_RECENTLY_CONTACTED'),
};


const ymdAdd = (ymd: string, days: number) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + days)); return t.toISOString().slice(0, 10); };

export class DailyFollowUpService {
  // realtime is OPTIONAL: unit tests/harness construct with just the repo (emits become no-ops); the module injects the bus.
  constructor(private readonly repo: DailyFollowUpPort, private readonly realtime?: RealtimeEmitter) {}

  // ---- realtime emits (a broken bus must never break the underlying action) ----
  /** A specific task changed → branch room (POS/manager) + the owning tech's room (tech app). */
  private emitTask(t: { tenantId: string; branchId: string; technicianId: string }): void {
    // Constitution 8: followup.task_sent / task_status_changed / customer_replied now carry this to the branch
    // board AND the owning technician's room via the projection consumer. Legacy path kept for stub/DB-less.
    if (this.repo.emitsDomainEvents?.()) return;
    try { this.realtime?.toTenant({ tenantId: t.tenantId, branchId: t.branchId }, EVENTS.followUpTaskUpdated); this.realtime?.toTechnician(t.technicianId, EVENTS.followUpTaskUpdated); } catch { /* ignore */ }
  }
  /** Branch-wide change (e.g. auto-expiry) → branch room only. */
  private emitBranch(tenantId: string, branchId: string, event = EVENTS.followUpTaskUpdated): void {
    // Branch-wide expiry sweeps go through markStatus, which emits followup.task_status_changed per task.
    if (this.repo.emitsDomainEvents?.()) return;
    try { this.realtime?.toTenant({ tenantId, branchId }, event); } catch { /* ignore */ }
  }
  /** New queue generated → branch room + each affected tech's room. */
  private emitGenerated(tenantId: string, branchId: string, technicianIds: string[]): void {
    // Constitution 8: followup.tasks_generated now carries this to the branch board and each affected tech.
    if (this.repo.emitsDomainEvents?.()) return;
    try { this.realtime?.toTenant({ tenantId, branchId }, EVENTS.dailyFollowUpsCreated); for (const id of technicianIds) this.realtime?.toTechnician(id, EVENTS.dailyFollowUpsCreated); } catch { /* ignore */ }
  }
  /** A follow-up reached a specific customer → that customer's room only. */
  private emitCustomerReceived(customerId: string): void {
    try { this.realtime?.toCustomer?.(customerId, EVENTS.customerFollowUpReceived); } catch { /* ignore */ }
  }

  // ---------- generation ----------

  /** Generate (or top-up) the follow-up queue for one branch on its current local business date. Idempotent. */
  async generateForBranch(tenantId: string, branchId: string, opts: { now?: Date; triggerSource: 'scheduler' | 'manual'; force?: boolean; businessDate?: string }): Promise<GenerateResult> {
    const now = opts.now ?? new Date();
    const tz = (await this.repo.branchTimezone(tenantId, branchId)) || DEFAULT_TZ;
    const settings = await this.repo.settingsFor(tenantId, branchId);
    const resolvedTz = settings.timezone || tz;
    const businessDate = opts.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.businessDate) ? opts.businessDate : localDateInTz(now, resolvedTz);   // catch-up passes yesterday

    // Scheduler/auto path respects the "already generated today" guard; manual Generate Now bypasses it (the unique
    // index still prevents duplicate tasks, so a top-up only adds newly completed lines).
    const already = await this.repo.runExists(tenantId, branchId, businessDate);
    if (already && !opts.force) return { businessDate, created: 0, skipped: 0, alreadyRan: true };

    await this.repo.audit({ tenantId, branchId, actionType: 'daily_follow_up_generation_started', metadata: { businessDate, triggerSource: opts.triggerSource } });

    // ONE eligibility rule (eod-center.ts): the same function Preview Tonight shows — a line becomes a task unless it
    // already has one, the customer is archived, already booked, or was contacted inside the cooldown (guide §6, §8)
    const candidates = await this.repo.eodCandidates(tenantId, branchId, resolvedTz, businessDate, settings.contactCooldownHours ?? 24, now);
    const sum = summarizeCandidates(candidates);
    const diag = { candidates: sum.candidates, excluded: sum.excluded, exclusions: { ...sum.reasons, no_app: sum.noApp }, ruleVersion: EOD_RULE_VERSION, timezone: resolvedTz, generationTime: settings.generationTime, runKey: `${tenantId}:${branchId}:${businessDate}:${EOD_RULE_VERSION}` };
    const lines = candidates.filter((c) => !c.excluded);
    const rows: NewTaskRow[] = lines.map((l) => {
      const { key, message } = renderTemplate(settings.defaultMessageTemplate, {
        customerFirstName: l.customerName, technicianName: l.technicianName, salonName: '', serviceName: l.serviceName,
      });
      return {
        tenantId, branchId, businessDate, customerId: l.customerId, technicianId: l.technicianId,
        ticketId: l.ticketId, ticketServiceLineId: l.ticketServiceLineId, serviceId: l.serviceId,
        serviceName: l.serviceName, customerName: l.customerName, customerPhone: l.customerPhone,
        technicianName: l.technicianName, customerAppUserId: l.customerAppUserId, completedAt: l.completedAt,
        templateKey: key, suggestedMessage: message,
      };
    });

    let created = 0;
    try {
      created = await this.repo.insertTasksIgnoreConflict(rows);
    } catch (e: any) {
      await this.repo.recordRun({ tenantId, branchId, businessDate, runStatus: 'failed', triggerSource: opts.triggerSource, createdCount: 0, skippedCount: rows.length, errorMessage: e?.message ?? 'insert failed', diag });
      await this.repo.audit({ tenantId, branchId, actionType: 'daily_follow_up_generation_failed', metadata: { businessDate, error: e?.message } });
      throw e;
    }
    const skipped = rows.length - created;
    await this.repo.recordRun({ tenantId, branchId, businessDate, runStatus: 'completed', triggerSource: opts.triggerSource, createdCount: created, skippedCount: skipped, diag });

    if (settings.reminderToTech && created > 0) {
      const techIds = [...new Set(rows.map((r) => r.technicianId))];
      await this.repo.notifyTechnicians(tenantId, techIds, businessDate);
    }
    await this.repo.audit({ tenantId, branchId, actionType: 'daily_follow_up_generation_completed', metadata: { businessDate, created, skipped, triggerSource: opts.triggerSource, candidates: diag.candidates, excluded: diag.excluded, exclusions: diag.exclusions, ruleVersion: EOD_RULE_VERSION } });
    if (created > 0) this.emitGenerated(tenantId, branchId, [...new Set(rows.map((r) => r.technicianId))]);
    return { businessDate, created, skipped, alreadyRan: false };
  }

  /** Scheduler tick: generate for every active branch whose local time has passed its generation time today. */
  async runDueBranches(now: Date): Promise<{ branchesRun: number; totalCreated: number }> {
    const branches = await this.repo.activeBranches();
    let branchesRun = 0, totalCreated = 0;
    for (const b of branches) {
      try {
        const settings = await this.repo.settingsFor(b.tenantId, b.branchId);
        if (!settings.enabled) continue;
        const tz = settings.timezone || (await this.repo.branchTimezone(b.tenantId, b.branchId)) || DEFAULT_TZ;
        if (localMinutesInTz(now, tz) < parseHHMM(settings.generationTime)) {
          // not yet 8pm local — but if YESTERDAY's run was missed (the server was down at 8pm), catch it up now. Only the last missed
          // day, and only for a branch that ran the day before it (a branch just switched on is never back-filled).
          const today = localDateInTz(now, tz), yesterday = ymdAdd(today, -1), dayBefore = ymdAdd(today, -2);
          if (!(await this.repo.runExists(b.tenantId, b.branchId, yesterday)) && (await this.repo.runExists(b.tenantId, b.branchId, dayBefore))) {
            const res = await this.generateForBranch(b.tenantId, b.branchId, { now, triggerSource: 'scheduler', businessDate: yesterday });
            branchesRun += 1; totalCreated += res.created;
          }
          continue;
        }
        const businessDate = localDateInTz(now, tz);
        if (await this.repo.runExists(b.tenantId, b.branchId, businessDate)) continue; // already generated today
        const res = await this.generateForBranch(b.tenantId, b.branchId, { now, triggerSource: 'scheduler' });
        branchesRun += 1; totalCreated += res.created;
      } catch { /* per-branch failure is isolated + recorded; keep going */ }
    }
    return { branchesRun, totalCreated };
  }

  /** Sweep: expire UNSENT tasks (pending / awaiting approval / rejected) whose age since GENERATION (created_at) passed
   *  the branch's auto-expire window (default 24 h; 0 = off). A status change only — the task leaves the active queue
   *  but stays in history with its reason; nothing is deleted (guide §10). Runs every scheduler tick. */
  async expireStaleTasks(now: Date): Promise<{ expired: number }> {
    const branches = await this.repo.activeBranches();
    let expired = 0;
    for (const b of branches) {
      try {
        const settings = await this.repo.settingsFor(b.tenantId, b.branchId);
        const hours = settings.autoExpirePendingHours;
        if (!settings.enabled || !hours || hours <= 0) continue; // disabled for this branch
        const cutoffIso = new Date(now.getTime() - hours * 3600_000).toISOString();
        const n = await this.repo.expireStalePending(b.tenantId, b.branchId, cutoffIso, hours);
        if (n > 0) { expired += n; await this.repo.audit({ tenantId: b.tenantId, branchId: b.branchId, actionType: 'service_follow_up_tasks_expired', metadata: { count: n, olderThanHours: hours } }); this.emitBranch(b.tenantId, b.branchId); }
      } catch { /* per-branch failure isolated */ }
    }
    return { expired };
  }

  // ---------- tech surface ----------

  private async techIdOrThrow(ctx: FollowUpContext): Promise<string> {
    const id = await this.repo.resolveTechnicianId(ctx);
    if (!id) throw withCode(new FollowUpError('not_technician', 'No active technician is linked to this account.'), 'NO_TECHNICIAN_PROFILE');
    return id;
  }

  async techList(ctx: FollowUpContext, opts: { date?: string; status?: FollowUpStatus | 'all' }): Promise<{ tasks: FollowUpTaskView[]; stats: TechStats }> {
    const techId = await this.techIdOrThrow(ctx);
    const status = opts.status && opts.status !== 'all' ? opts.status : undefined;
    const records = await this.repo.tasksForTechnician(ctx.tenantId, ctx.branchId, techId, { businessDate: opts.date, status });
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'tech_followup_list_viewed', metadata: { date: opts.date ?? null, count: records.length } });
    return { tasks: records.map(this.view), stats: this.statsFor(records) };
  }

  async techGet(ctx: FollowUpContext, taskId: string): Promise<FollowUpTaskView> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    return this.view(t);
  }

  templates(): FollowUpTemplateOption[] { return FOLLOW_UP_TEMPLATES.map((t) => ({ key: t.key, label: t.label })); }

  async previewMessage(ctx: FollowUpContext, taskId: string, templateKey: string | null): Promise<{ message: string; templateKey: string }> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    const { key, message } = renderTemplate(templateKey, { customerFirstName: t.customerName, technicianName: t.technicianName, salonName: '', serviceName: t.serviceName });
    return { message, templateKey: key };
  }

  async techSend(ctx: FollowUpContext, taskId: string, message?: string): Promise<FollowUpTaskView> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    const settings = await this.repo.settingsFor(ctx.tenantId, ctx.branchId);
    if (settings.requireManagerApproval && (t.status === 'pending' || t.status === 'rejected')) {
      // Hold the (optionally edited) message for a manager to approve before it reaches the customer. A rejected
      // draft comes back here after the technician edits it (guide §9: Rejected → resubmit).
      const msg = (message ?? '').trim();
      if (msg && settings.allowTechEditMessage) await this.repo.updateMessage(ctx.tenantId, t.id, msg);
      if (!(await this.repo.submitForApproval(ctx.tenantId, t.id))) throw withCode(new FollowUpError('invalid_state', 'This follow-up can no longer be submitted.'), 'FOLLOWUP_STATE_INVALID');
      await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'tech_followup_submitted_for_approval', entityId: t.id, metadata: {} });
      this.emitTask(t);
      return this.view((await this.repo.taskById(t.id))!);
    }
    // Nov 3 audit: "Allow technician to edit message = Off" also binds the direct send — an edited text used to reach the customer
    const edited = (message ?? '').trim();
    if (edited && edited !== String(t.suggestedMessage ?? '').trim() && !settings.allowTechEditMessage) {
      throw withCode(new FollowUpError('forbidden', 'Editing follow-up messages is disabled for this branch.'), 'FOLLOWUP_EDITING_DISABLED');
    }
    return this.doSend(ctx, t, settings.allowTechEditMessage ? message : undefined, 'tech', { allowedFrom: ['pending'], approve: false, override: null });
  }

  async techSkip(ctx: FollowUpContext, taskId: string, reason?: string): Promise<FollowUpTaskView> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    return this.doSkip(ctx, t, reason, 'tech');
  }

  async techDismiss(ctx: FollowUpContext, taskId: string): Promise<FollowUpTaskView> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    if (t.status === 'sent') throw withCode(new FollowUpError('invalid_state', 'A sent follow-up cannot be dismissed.'), 'FOLLOWUP_STATE_INVALID');
    await this.repo.markStatus(ctx.tenantId, t.id, 'dismissed');
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'service_follow_up_dismissed', entityId: t.id, metadata: {} });
    this.emitTask(t);
    return this.view((await this.repo.taskById(t.id))!);
  }

  async techEditMessage(ctx: FollowUpContext, taskId: string, message: string): Promise<FollowUpTaskView> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    const settings = await this.repo.settingsFor(ctx.tenantId, ctx.branchId);
    if (!settings.allowTechEditMessage) throw withCode(new FollowUpError('forbidden', 'Editing follow-up messages is disabled for this branch.'), 'FOLLOWUP_EDITING_DISABLED');
    if (t.status !== 'pending' && t.status !== 'rejected') throw withCode(new FollowUpError('invalid_state', 'Only a pending or returned follow-up can be edited.'), 'FOLLOWUP_STATE_INVALID');
    const clean = (message ?? '').trim();
    if (!clean) throw withCode(new FollowUpError('validation', 'Message cannot be empty.'), 'MESSAGE_REQUIRED');
    await this.repo.updateMessage(ctx.tenantId, t.id, clean);
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'service_follow_up_message_edited', entityId: t.id, metadata: {} });
    this.emitTask(t);
    return this.view((await this.repo.taskById(t.id))!);
  }

  // ---------- manager / POS surface ----------

  async managerList(ctx: FollowUpContext, opts: { date?: string; technicianId?: string; status?: FollowUpStatus | 'all' }): Promise<{ tasks: FollowUpTaskView[]; stats: TechStats }> {
    const status = opts.status && opts.status !== 'all' ? opts.status : undefined;
    const records = await this.repo.tasksForBranch(ctx.tenantId, ctx.branchId, { businessDate: opts.date, technicianId: opts.technicianId, status });
    return { tasks: records.map(this.view), stats: this.statsFor(records) };
  }

  async managerGenerateNow(ctx: FollowUpContext): Promise<GenerateResult> {
    // Manager-triggered top-up for today; bypasses the once-per-day gate but unique index prevents duplicates.
    return this.generateForBranch(ctx.tenantId, ctx.branchId, { triggerSource: 'manual', force: true });
  }

  async managerSend(ctx: FollowUpContext, taskId: string, message?: string, override?: { reason?: string | null } | null): Promise<FollowUpTaskView> {
    const t = await this.branchTask(ctx, taskId);
    // "Require manager approval" holds a TECHNICIAN's send; a manager sending directly is the approval
    return this.doSend(ctx, t, message, 'manager', { allowedFrom: ['pending', 'pending_manager_approval', 'customer_not_available'], approve: true, override: this.overrideOf(override) });
  }

  /** Reject a draft that waits for approval; the note goes back to the technician, who may edit and resubmit. */
  async managerReject(ctx: FollowUpContext, taskId: string, note: string): Promise<FollowUpTaskView> {
    const t = await this.branchTask(ctx, taskId);
    const clean = (note ?? '').trim();
    if (clean.length < 3) throw withCode(new FollowUpError('validation', 'Write a short note for the technician.'), 'FOLLOWUP_REJECT_NOTE_REQUIRED');
    if (t.status !== 'pending_manager_approval') throw withCode(new FollowUpError('invalid_state', 'Only a follow-up awaiting approval can be rejected.'), 'FOLLOWUP_STATE_INVALID');
    if (!(await this.repo.rejectTask(ctx.tenantId, t.id, ctx.userId, clean.slice(0, 1000)))) throw withCode(new FollowUpError('invalid_state', 'This follow-up changed — refresh and try again.'), 'FOLLOWUP_STATE_INVALID');
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'tech_followup_rejected', entityId: t.id, metadata: { noteLength: clean.length } });
    this.emitTask(t);
    return this.view((await this.repo.taskById(t.id))!);
  }

  private overrideOf(o?: { reason?: string | null } | null): { reason: string } | null {
    if (!o) return null;
    const reason = (o.reason ?? '').trim();
    if (reason.length < 5) throw withCode(new FollowUpError('validation', 'A manager exception needs a reason (at least 5 characters).'), 'FOLLOWUP_OVERRIDE_REASON_REQUIRED');
    return { reason: reason.slice(0, 500) };
  }

  async managerSkip(ctx: FollowUpContext, taskId: string, reason?: string): Promise<FollowUpTaskView> {
    const t = await this.branchTask(ctx, taskId);
    return this.doSkip(ctx, t, reason, 'manager');
  }

  async managerApprove(ctx: FollowUpContext, taskId: string, message?: string, override?: { reason?: string | null } | null): Promise<FollowUpTaskView> {
    const t = await this.branchTask(ctx, taskId);
    if (t.status === 'sent') return this.view(t); // idempotent
    if (!['pending_manager_approval', 'pending'].includes(t.status)) throw withCode(new FollowUpError('invalid_state', 'Only a follow-up awaiting approval can be approved.'), 'FOLLOWUP_STATE_INVALID');
    const out = await this.doSend(ctx, t, message, 'manager', { allowedFrom: ['pending_manager_approval', 'pending'], approve: true, override: this.overrideOf(override) });
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'tech_followup_approved', entityId: t.id, metadata: {} });
    return out;
  }

  async getSettings(ctx: FollowUpContext): Promise<FollowUpSettings> { return this.repo.settingsFor(ctx.tenantId, ctx.branchId); }

  async saveSettings(ctx: FollowUpContext, patch: Partial<FollowUpSettings>): Promise<FollowUpSettings> {
    if (patch.generationTime !== undefined && !/^\d{1,2}:\d{2}$/.test(patch.generationTime)) throw new FollowUpError('validation', 'generationTime must be HH:mm.');
    const saved = await this.repo.saveSettings(ctx, patch);
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'end_of_day_followup_settings_updated', entityType: 'daily_follow_up_settings', metadata: { patch } });
    return saved;
  }

  // ---------- customer surface ----------

  private async customerIdOrThrow(ctx: FollowUpContext): Promise<string> {
    const id = await this.repo.resolveCustomerRecordId(ctx);
    if (!id) throw withCode(new FollowUpError('not_found', 'No customer profile is linked to this account.'), 'NO_CUSTOMER_PROFILE');
    return id;
  }

  async customerList(ctx: FollowUpContext): Promise<FollowUpTaskView[]> {
    const custId = await this.customerIdOrThrow(ctx);
    const records = await this.repo.tasksForCustomer(ctx.tenantId, custId);
    return records.map(this.view);
  }

  async customerGet(ctx: FollowUpContext, taskId: string): Promise<FollowUpTaskView> {
    const custId = await this.customerIdOrThrow(ctx);
    const t = await this.repo.taskById(taskId);
    if (!t || t.tenantId !== ctx.tenantId || t.customerId !== custId || !['sent', 'customer_replied', 'rebooked'].includes(t.status)) {
      throw withCode(new FollowUpError('not_found', 'Follow-up not found.'), 'FOLLOWUP_NOT_FOUND');
    }
    await this.repo.markCustomerViewed(ctx.tenantId, t.id);
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: t.branchId, userId: ctx.userId, customerId: custId, role: 'CUSTOMER', actionType: 'customer_followup_viewed', entityId: t.id, metadata: {} } as any);
    return this.view(t);
  }

  async customerReply(ctx: FollowUpContext, taskId: string, text: string): Promise<FollowUpTaskView> {
    const custId = await this.customerIdOrThrow(ctx);
    const t = await this.customerOwnSentTask(ctx, taskId, custId);
    const settings = await this.repo.settingsFor(ctx.tenantId, t.branchId);
    if (!settings.allowCustomerReplies) throw withCode(new FollowUpError('forbidden', 'Replies are not enabled for this salon.'), 'REPLIES_DISABLED');
    const clean = (text ?? '').trim();
    if (!clean) throw withCode(new FollowUpError('validation', 'Reply cannot be empty.'), 'REPLY_REQUIRED');
    await this.repo.markStatus(ctx.tenantId, t.id, 'customer_replied');
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: t.branchId, userId: ctx.userId, customerId: custId, role: 'CUSTOMER', actionType: 'customer_follow_up_replied', entityId: t.id, metadata: { length: clean.length } } as any);
    this.emitTask(t);
    return this.view((await this.repo.taskById(t.id))!);
  }

  async customerRebook(ctx: FollowUpContext, taskId: string): Promise<RebookPreselect> {
    const custId = await this.customerIdOrThrow(ctx);
    const t = await this.customerOwnSentTask(ctx, taskId, custId);
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: t.branchId, userId: ctx.userId, customerId: custId, role: 'CUSTOMER', actionType: 'customer_follow_up_rebook_clicked', entityId: t.id, metadata: { technicianId: t.technicianId, serviceId: t.serviceId } } as any);
    return { salonId: t.tenantId, tenantId: t.tenantId, branchId: t.branchId, technicianId: t.technicianId, serviceId: t.serviceId, serviceName: t.serviceName };
  }

  // ---------- shared internals ----------

  private async ownTechTask(ctx: FollowUpContext, taskId: string, techId: string): Promise<TaskRecord> {
    const t = await this.repo.taskById(taskId);
    if (!t || t.tenantId !== ctx.tenantId || t.branchId !== ctx.branchId) throw withCode(new FollowUpError('not_found', 'Follow-up not found.'), 'FOLLOWUP_NOT_FOUND');
    if (t.technicianId !== techId) throw withCode(new FollowUpError('forbidden', 'This follow-up belongs to another technician.'), 'FOLLOWUP_OTHER_TECHNICIAN');
    return t;
  }

  private async branchTask(ctx: FollowUpContext, taskId: string): Promise<TaskRecord> {
    const t = await this.repo.taskById(taskId);
    if (!t || t.tenantId !== ctx.tenantId || t.branchId !== ctx.branchId) throw withCode(new FollowUpError('not_found', 'Follow-up not found.'), 'FOLLOWUP_NOT_FOUND');
    return t;
  }

  private async customerOwnSentTask(ctx: FollowUpContext, taskId: string, custId: string): Promise<TaskRecord> {
    const t = await this.repo.taskById(taskId);
    if (!t || t.tenantId !== ctx.tenantId || t.customerId !== custId || !['sent', 'customer_replied', 'rebooked'].includes(t.status)) {
      throw withCode(new FollowUpError('not_found', 'Follow-up not found.'), 'FOLLOWUP_NOT_FOUND');
    }
    return t;
  }

  /** The send: the customer protections are re-checked and the task claimed in ONE transaction (repo.claimSend →
   *  eod-center claimAndSendTask). A refusal leaves the task where it was and is audited with its reason. */
  private async doSend(ctx: FollowUpContext, t: TaskRecord, message: string | undefined, by: 'tech' | 'manager', o: { allowedFrom: string[]; approve: boolean; override: { reason: string } | null }): Promise<FollowUpTaskView> {
    if (t.status === 'sent') return this.view(t); // idempotent
    const settings = await this.repo.settingsFor(ctx.tenantId, t.branchId);
    const today = localDateInTz(new Date(), settings.timezone);
    const r: ClaimResult = await this.repo.claimSend({
      tenantId: ctx.tenantId, taskId: t.id, actorUserId: ctx.userId, message: message ?? null, allowedFrom: o.allowedFrom, approve: o.approve,
      override: o.override, cooldownHours: settings.contactCooldownHours ?? 24, today, title: (tech) => `${tech} sent you a follow-up`,
    });
    if (r.outcome === 'refused') {
      await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'service_follow_up_send_refused', entityId: t.id, metadata: { by, reason: r.reason } });
      throw REFUSAL[r.reason](r.detail);
    }
    if (r.outcome === 'no_app') {
      await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'tech_followup_send_no_app', entityId: t.id, metadata: { by } });
    } else if (r.outcome === 'sent') {
      await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'service_follow_up_sent', entityId: t.id, metadata: { by, customerId: t.customerId, overridden: r.overridden, ...(o.override ? { overrideReason: o.override.reason } : {}) } });
      this.emitCustomerReceived(t.customerId);
    }
    this.emitTask(t);
    return this.view((await this.repo.taskById(t.id))!);
  }

  private async doSkip(ctx: FollowUpContext, t: TaskRecord, reason: string | undefined, by: 'tech' | 'manager'): Promise<FollowUpTaskView> {
    if (t.status === 'sent') throw withCode(new FollowUpError('invalid_state', 'A sent follow-up cannot be skipped.'), 'FOLLOWUP_STATE_INVALID');
    await this.repo.markStatus(ctx.tenantId, t.id, 'skipped', (reason ?? '').trim() || null);
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'service_follow_up_skipped', entityId: t.id, metadata: { by } });
    this.emitTask(t);
    return this.view((await this.repo.taskById(t.id))!);
  }

  private statsFor(records: TaskRecord[]): TechStats {
    const s: TechStats = { pending: 0, sent: 0, skipped: 0, dismissed: 0, rebooked: 0, total: records.length };
    for (const r of records) {
      if (r.status === 'pending' || r.status === 'pending_manager_approval' || r.status === 'rejected') s.pending += 1;
      else if (r.status === 'sent' || r.status === 'customer_replied') s.sent += 1;
      else if (r.status === 'skipped' || r.status === 'customer_not_available') s.skipped += 1;
      else if (r.status === 'dismissed') s.dismissed += 1;
      else if (r.status === 'rebooked') s.rebooked += 1;
    }
    return s;
  }

  private view = (t: TaskRecord): FollowUpTaskView => ({
    id: t.id, businessDate: t.businessDate, status: t.status, customerName: t.customerName, customerPhone: t.customerPhone,
    customerHasApp: !!t.customerAppUserId, serviceName: t.serviceName, serviceId: t.serviceId, ticketId: t.ticketId,
    ticketServiceLineId: t.ticketServiceLineId, appointmentId: t.appointmentId, technicianId: t.technicianId,
    technicianName: t.technicianName, completedAt: t.completedAt, templateKey: t.templateKey,
    suggestedMessage: t.suggestedMessage, sentMessage: t.sentMessage, sentAt: t.sentAt, skipReason: t.skipReason,
    expiredAt: t.expiredAt ?? null, managerNote: t.managerNote ?? null,
  });
}
