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

const DEFAULT_TZ = 'America/New_York';


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
  async generateForBranch(tenantId: string, branchId: string, opts: { now?: Date; triggerSource: 'scheduler' | 'manual'; force?: boolean }): Promise<GenerateResult> {
    const now = opts.now ?? new Date();
    const tz = (await this.repo.branchTimezone(tenantId, branchId)) || DEFAULT_TZ;
    const settings = await this.repo.settingsFor(tenantId, branchId);
    const resolvedTz = settings.timezone || tz;
    const businessDate = localDateInTz(now, resolvedTz);

    // Scheduler/auto path respects the "already generated today" guard; manual Generate Now bypasses it (the unique
    // index still prevents duplicate tasks, so a top-up only adds newly completed lines).
    const already = await this.repo.runExists(tenantId, branchId, businessDate);
    if (already && !opts.force) return { businessDate, created: 0, skipped: 0, alreadyRan: true };

    await this.repo.audit({ tenantId, branchId, actionType: 'daily_follow_up_generation_started', metadata: { businessDate, triggerSource: opts.triggerSource } });

    const lines = await this.repo.completedServiceLines(tenantId, branchId, resolvedTz, businessDate);
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
      await this.repo.recordRun({ tenantId, branchId, businessDate, runStatus: 'failed', triggerSource: opts.triggerSource, createdCount: 0, skippedCount: rows.length, errorMessage: e?.message ?? 'insert failed' });
      await this.repo.audit({ tenantId, branchId, actionType: 'daily_follow_up_generation_failed', metadata: { businessDate, error: e?.message } });
      throw e;
    }
    const skipped = rows.length - created;
    await this.repo.recordRun({ tenantId, branchId, businessDate, runStatus: 'completed', triggerSource: opts.triggerSource, createdCount: created, skippedCount: skipped });

    if (settings.reminderToTech && created > 0) {
      const techIds = [...new Set(rows.map((r) => r.technicianId))];
      await this.repo.notifyTechnicians(tenantId, techIds, businessDate);
    }
    await this.repo.audit({ tenantId, branchId, actionType: 'daily_follow_up_generation_completed', metadata: { businessDate, created, skipped, triggerSource: opts.triggerSource } });
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
        if (localMinutesInTz(now, tz) < parseHHMM(settings.generationTime)) continue; // not yet 8pm local
        const businessDate = localDateInTz(now, tz);
        if (await this.repo.runExists(b.tenantId, b.branchId, businessDate)) continue; // already generated today
        const res = await this.generateForBranch(b.tenantId, b.branchId, { now, triggerSource: 'scheduler' });
        branchesRun += 1; totalCreated += res.created;
      } catch { /* per-branch failure is isolated + recorded; keep going */ }
    }
    return { branchesRun, totalCreated };
  }

  /** Sweep: soft-delete still-'pending' tasks older than each branch's auto-expire window (default 24h; 0 = off). A
   *  tech who never sent or skipped a task within the window loses it from the queue automatically. Runs every
   *  scheduler tick, independent of the generation time. */
  async expireStaleTasks(now: Date): Promise<{ expired: number }> {
    const branches = await this.repo.activeBranches();
    let expired = 0;
    for (const b of branches) {
      try {
        const settings = await this.repo.settingsFor(b.tenantId, b.branchId);
        const hours = settings.autoExpirePendingHours;
        if (!settings.enabled || !hours || hours <= 0) continue; // disabled for this branch
        const cutoffIso = new Date(now.getTime() - hours * 3600_000).toISOString();
        const n = await this.repo.expireStalePending(b.tenantId, b.branchId, cutoffIso);
        if (n > 0) { expired += n; await this.repo.audit({ tenantId: b.tenantId, branchId: b.branchId, actionType: 'service_follow_up_tasks_expired', metadata: { count: n, olderThanHours: hours } }); this.emitBranch(b.tenantId, b.branchId); }
      } catch { /* per-branch failure isolated */ }
    }
    return { expired };
  }

  /** Stage-2 maintenance: permanently delete expired (soft-deleted) task rows older than the retention window.
   *  Default 30 days; FOLLOWUP_PURGE_AFTER_DAYS overrides; 0 (or negative) disables purging. The lifecycle audit_logs
   *  entries are kept regardless — only the operational task rows are removed. */
  async purgeExpiredTasks(now: Date, retentionDaysOverride?: number): Promise<{ purged: number }> {
    const days = retentionDaysOverride ?? Number(process.env.FOLLOWUP_PURGE_AFTER_DAYS ?? 30);
    if (!Number.isFinite(days) || days <= 0) return { purged: 0 };
    const cutoffIso = new Date(now.getTime() - days * 86400_000).toISOString();
    const purged = await this.repo.purgeExpired(cutoffIso);
    return { purged };
  }

  // ---------- tech surface ----------

  private async techIdOrThrow(ctx: FollowUpContext): Promise<string> {
    const id = await this.repo.resolveTechnicianId(ctx);
    if (!id) throw new FollowUpError('not_technician', 'No active technician is linked to this account.');
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
    if (settings.requireManagerApproval && t.status === 'pending') {
      // Hold the (optionally edited) message for a manager to approve before it reaches the customer.
      const msg = (message ?? '').trim();
      if (msg && settings.allowTechEditMessage) await this.repo.updateMessage(ctx.tenantId, t.id, msg);
      await this.repo.markStatus(ctx.tenantId, t.id, 'pending_manager_approval');
      await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'tech_followup_submitted_for_approval', entityId: t.id, metadata: {} });
      this.emitTask(t);
      return this.view((await this.repo.taskById(t.id))!);
    }
    return this.doSend(ctx, t, message, 'tech');
  }

  async techSkip(ctx: FollowUpContext, taskId: string, reason?: string): Promise<FollowUpTaskView> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    return this.doSkip(ctx, t, reason, 'tech');
  }

  async techDismiss(ctx: FollowUpContext, taskId: string): Promise<FollowUpTaskView> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    if (t.status === 'sent') throw new FollowUpError('invalid_state', 'A sent follow-up cannot be dismissed.');
    await this.repo.markStatus(ctx.tenantId, t.id, 'dismissed');
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'service_follow_up_dismissed', entityId: t.id, metadata: {} });
    this.emitTask(t);
    return this.view((await this.repo.taskById(t.id))!);
  }

  async techEditMessage(ctx: FollowUpContext, taskId: string, message: string): Promise<FollowUpTaskView> {
    const techId = await this.techIdOrThrow(ctx);
    const t = await this.ownTechTask(ctx, taskId, techId);
    const settings = await this.repo.settingsFor(ctx.tenantId, ctx.branchId);
    if (!settings.allowTechEditMessage) throw new FollowUpError('forbidden', 'Editing follow-up messages is disabled for this branch.');
    if (t.status !== 'pending') throw new FollowUpError('invalid_state', 'Only a pending follow-up can be edited.');
    const clean = (message ?? '').trim();
    if (!clean) throw new FollowUpError('validation', 'Message cannot be empty.');
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

  async managerSend(ctx: FollowUpContext, taskId: string, message?: string): Promise<FollowUpTaskView> {
    const t = await this.branchTask(ctx, taskId);
    return this.doSend(ctx, t, message, 'manager');
  }

  async managerSkip(ctx: FollowUpContext, taskId: string, reason?: string): Promise<FollowUpTaskView> {
    const t = await this.branchTask(ctx, taskId);
    return this.doSkip(ctx, t, reason, 'manager');
  }

  async managerApprove(ctx: FollowUpContext, taskId: string, message?: string): Promise<FollowUpTaskView> {
    const t = await this.branchTask(ctx, taskId);
    if (t.status === 'sent') return this.view(t); // idempotent
    if (!['pending_manager_approval', 'pending'].includes(t.status)) throw new FollowUpError('invalid_state', 'Only a follow-up awaiting approval can be approved.');
    const out = await this.doSend(ctx, t, message, 'manager');
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
    if (!id) throw new FollowUpError('not_found', 'No customer profile is linked to this account.');
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
      throw new FollowUpError('not_found', 'Follow-up not found.');
    }
    await this.repo.markCustomerViewed(ctx.tenantId, t.id);
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: t.branchId, userId: ctx.userId, customerId: custId, role: 'CUSTOMER', actionType: 'customer_followup_viewed', entityId: t.id, metadata: {} } as any);
    return this.view(t);
  }

  async customerReply(ctx: FollowUpContext, taskId: string, text: string): Promise<FollowUpTaskView> {
    const custId = await this.customerIdOrThrow(ctx);
    const t = await this.customerOwnSentTask(ctx, taskId, custId);
    const settings = await this.repo.settingsFor(ctx.tenantId, t.branchId);
    if (!settings.allowCustomerReplies) throw new FollowUpError('forbidden', 'Replies are not enabled for this salon.');
    const clean = (text ?? '').trim();
    if (!clean) throw new FollowUpError('validation', 'Reply cannot be empty.');
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
    if (!t || t.tenantId !== ctx.tenantId || t.branchId !== ctx.branchId) throw new FollowUpError('not_found', 'Follow-up not found.');
    if (t.technicianId !== techId) throw new FollowUpError('forbidden', 'This follow-up belongs to another technician.');
    return t;
  }

  private async branchTask(ctx: FollowUpContext, taskId: string): Promise<TaskRecord> {
    const t = await this.repo.taskById(taskId);
    if (!t || t.tenantId !== ctx.tenantId || t.branchId !== ctx.branchId) throw new FollowUpError('not_found', 'Follow-up not found.');
    return t;
  }

  private async customerOwnSentTask(ctx: FollowUpContext, taskId: string, custId: string): Promise<TaskRecord> {
    const t = await this.repo.taskById(taskId);
    if (!t || t.tenantId !== ctx.tenantId || t.customerId !== custId || !['sent', 'customer_replied', 'rebooked'].includes(t.status)) {
      throw new FollowUpError('not_found', 'Follow-up not found.');
    }
    return t;
  }

  private async doSend(ctx: FollowUpContext, t: TaskRecord, message: string | undefined, by: 'tech' | 'manager'): Promise<FollowUpTaskView> {
    if (t.status === 'sent') return this.view(t); // idempotent
    if (['dismissed'].includes(t.status)) throw new FollowUpError('invalid_state', 'A dismissed follow-up cannot be sent.');
    // No Customer App account → cannot deliver in-app; mark and report honestly (SMS/email fallback is future work).
    if (!t.customerAppUserId) {
      await this.repo.markStatus(ctx.tenantId, t.id, 'customer_not_available');
      await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'tech_followup_send_no_app', entityId: t.id, metadata: { by } });
      this.emitTask(t);
      return this.view((await this.repo.taskById(t.id))!);
    }
    const msg = (message ?? '').trim() || t.suggestedMessage;
    const notifId = await this.repo.createCustomerNotification(t.tenantId, t.customerId, `${t.technicianName} sent you a follow-up`, msg, t.id);
    await this.repo.markSent(ctx.tenantId, t.id, msg, ctx.userId, notifId ?? null);
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'service_follow_up_sent', entityId: t.id, metadata: { by, customerId: t.customerId } });
    this.emitTask(t);
    this.emitCustomerReceived(t.customerId);
    return this.view((await this.repo.taskById(t.id))!);
  }

  private async doSkip(ctx: FollowUpContext, t: TaskRecord, reason: string | undefined, by: 'tech' | 'manager'): Promise<FollowUpTaskView> {
    if (t.status === 'sent') throw new FollowUpError('invalid_state', 'A sent follow-up cannot be skipped.');
    await this.repo.markStatus(ctx.tenantId, t.id, 'skipped', (reason ?? '').trim() || null);
    await this.repo.audit({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType: 'service_follow_up_skipped', entityId: t.id, metadata: { by } });
    this.emitTask(t);
    return this.view((await this.repo.taskById(t.id))!);
  }

  private statsFor(records: TaskRecord[]): TechStats {
    const s: TechStats = { pending: 0, sent: 0, skipped: 0, dismissed: 0, rebooked: 0, total: records.length };
    for (const r of records) {
      if (r.status === 'pending' || r.status === 'pending_manager_approval') s.pending += 1;
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
  });
}
