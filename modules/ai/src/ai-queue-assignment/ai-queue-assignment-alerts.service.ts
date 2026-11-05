// ai-queue-assignment-alerts.service.ts — BUILD_PLAN Phase 6: queue alerts, end to end.
//
// scan      the live snapshot of ONE branch (every active entry — no 20-row cap, audit bug 4) through the one detection
//           core with the branch's EFFECTIVE thresholds (the one settings source); raise / update / AUTO-RESOLVE in one
//           transaction (events in the outbox); realtime for each change; a high / critical alert notifies the owner
//           and the branch's managers once. Runs for staff ("Scan now") and for the per-minute background job.
// list      unresolved alerts by default — resolved ones only when asked (`status=all`), audit bug 9.
// repair    REALLY changes the queue, through the queue's own action (unassign, reassign, call, start, hand to the tech
//           queue, cancel); recorded in queue_repair_actions + audit_logs; the alert closes as 'repaired:<action>'.
//           Before Phase 6 a repair only wrote a log line and closed the alert (audit "repair workflow" PARTIAL).
import { hasPermission } from '@aipowersalon/permissions';
import { detectQueueFindings, ALERT_TYPES, type AlertFinding, type RepairAction } from './ai-queue-assignment-detection';
import type { QueueAlertRepositoryPort, AlertFilter, AlertRecord } from './ai-queue-assignment-alerts.repository';
import type { QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import type { QueueAssignmentSettingsPort } from './ai-queue-assignment-settings';
import type { QueueOpsQueuePort } from './ai-queue-assignment-ops.ports';
import { needsNotification, type OpsEmitterPort, type QueueAlertNotifierPort } from './ai-queue-assignment-ops.notifications';
import { QueueAssignmentContext, QueueAssignmentForbiddenError, QueueAssignmentValidationError, QueueAssignmentDisabledError } from './ai-queue-assignment.dto';

/** Which repairs each alert type offers (the detection core proposes them per finding; this is the server-side gate). */
export const REPAIRS_BY_TYPE: Record<string, RepairAction[]> = {
  waiting_too_long: ['call', 'reassign', 'dismiss'],
  unassigned: ['reassign', 'dismiss'],
  stuck_record: ['unassign', 'reassign', 'call', 'start_service', 'move_to_tech_queue', 'cancel', 'dismiss'],
  late_appointment: ['call', 'start_service', 'reassign', 'dismiss'],
  long_service: ['dismiss'],
  overloaded_technician: ['reassign', 'dismiss'],   // reassign names the guest (queueItemId) to move off the technician
  congestion: ['dismiss'],
};
export class QueueAlertConflictError extends Error { constructor(m: string) { super(m); this.name = 'QueueAlertConflictError'; } }
export class QueueAlertNotFoundError extends Error { constructor(m = 'That alert was not found (or is already closed).') { super(m); this.name = 'QueueAlertNotFoundError'; } }

export interface ScanResult { raised: number; updated: number; autoResolved: number; total: number; notified: number }
export interface RepairBody { action?: string; technicianId?: string | null; queueItemId?: string | null; expectedVersion?: number | null; reason?: string | null }

export class QueueAlertService {
  constructor(
    private readonly alerts: QueueAlertRepositoryPort,
    private readonly settings: QueueAssignmentSettingsPort,
    private readonly queue: QueueOpsQueuePort,
    private readonly entitlement?: QueueAssignmentEntitlementPort | null,
    private readonly emitter?: OpsEmitterPort | null,
    private readonly notifier?: QueueAlertNotifierPort | null,
    private readonly now: () => number = Date.now,
  ) {}

  private need(ctx: QueueAssignmentContext, perm: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new QueueAssignmentForbiddenError('Not signed in.');
    if (!hasPermission(ctx as any, perm)) throw new QueueAssignmentForbiddenError(`You need the "${perm}" permission for this.`);
  }
  private async assertEnabled(ctx: QueueAssignmentContext) {
    if (this.entitlement && !(await this.entitlement.isEnabled(ctx.tenantId))) throw new QueueAssignmentDisabledError();
  }
  private scope(ctx: QueueAssignmentContext) { return { tenantId: ctx.tenantId, branchId: ctx.branchId }; }

  /** Staff "Scan now". */
  async scanAlerts(ctx: QueueAssignmentContext): Promise<ScanResult> {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    return this.runScan(ctx);
  }

  /** The scan itself — also what the background job calls (system context; the job checked the switches). */
  async runScan(ctx: QueueAssignmentContext): Promise<ScanResult> {
    const scope = this.scope(ctx);
    const eff = await this.settings.effective(scope);
    const snap = await this.queue.snapshot(ctx);
    const nowMs = this.now();
    const findings: AlertFinding[] = detectQueueFindings({ branchId: ctx.branchId, entries: snap.entries, technicians: snap.technicians }, eff, nowMs);
    const out = await this.alerts.applyScan(scope, findings, new Date(nowMs).toISOString());
    for (const a of out.raised) this.emitter?.emit(scope, 'alert_raised', { alertId: a.id, type: a.type, severity: a.severity, queueEntryId: a.queueEntryId });
    for (const a of out.escalated) this.emitter?.emit(scope, 'alert_raised', { alertId: a.id, type: a.type, severity: a.severity, queueEntryId: a.queueEntryId, escalated: true });
    for (const a of out.autoResolved) this.emitter?.emit(scope, 'alert_resolved', { alertId: a.id, type: a.type, queueEntryId: a.queueEntryId, autoResolved: true, resolution: a.resolution });
    let notified = 0;
    if (this.notifier) for (const a of [...out.raised, ...out.escalated]) {
      if (!needsNotification(a)) continue;
      try { await this.notifier.notify(a); await this.alerts.markNotified(scope, a.id, a.severity); notified++; } catch { /* a failed notification never fails the scan */ }
    }
    return { raised: out.raised.length, updated: out.updated, autoResolved: out.autoResolved.length, total: findings.length, notified };
  }

  async listAlerts(ctx: QueueAssignmentContext, filter: AlertFilter = {}): Promise<AlertRecord[]> {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    const status = filter.status && ['open', 'acknowledged', 'resolved', 'all'].includes(filter.status) ? filter.status : 'open';
    if (filter.type && !(ALERT_TYPES as readonly string[]).includes(filter.type)) throw new QueueAssignmentValidationError('Unknown alert type.');
    return this.alerts.list(this.scope(ctx), { ...filter, status });
  }

  async acknowledgeAlert(ctx: QueueAssignmentContext, id: string, note?: string | null): Promise<AlertRecord> {
    this.need(ctx, 'ai_queue_assignment.resolve_alerts');
    await this.assertEnabled(ctx);
    const a = await this.alerts.acknowledge(this.scope(ctx), id, ctx.userId, clean(note));
    if (!a) throw new QueueAlertNotFoundError();
    this.emitter?.emit(this.scope(ctx), 'alert_acknowledged', { alertId: id, type: a.type });
    return a;
  }

  async resolveAlert(ctx: QueueAssignmentContext, id: string, note?: string | null): Promise<AlertRecord> {
    this.need(ctx, 'ai_queue_assignment.resolve_alerts');
    await this.assertEnabled(ctx);
    const a = await this.alerts.resolve(this.scope(ctx), id, ctx.userId, { note: clean(note), resolution: 'resolved_by_staff' });
    if (!a) throw new QueueAlertNotFoundError();
    this.emitter?.emit(this.scope(ctx), 'alert_resolved', { alertId: id, type: a.type, queueEntryId: a.queueEntryId, autoResolved: false, resolution: a.resolution });
    return a;
  }

  /** A repair that changes the queue (through QueueService), audited, and closes the alert. */
  async repair(ctx: QueueAssignmentContext, alertId: string, body: RepairBody): Promise<{ alert: AlertRecord; action: string; queueItemId: string | null; result: unknown }> {
    this.need(ctx, 'ai_queue_assignment.resolve_alerts');
    await this.assertEnabled(ctx);
    const scope = this.scope(ctx);
    const alert = await this.alerts.get(scope, alertId);
    if (!alert || alert.status === 'resolved') throw new QueueAlertNotFoundError();
    const action = String(body?.action ?? '') as RepairAction;
    const allowed = REPAIRS_BY_TYPE[alert.type] ?? ['dismiss'];
    if (!allowed.includes(action)) throw new QueueAssignmentValidationError(`This alert can be repaired by: ${allowed.join(', ')}.`);
    const reason = clean(body?.reason);
    let result: unknown = null; let queueItemId: string | null = null;
    if (action !== 'dismiss') {
      if (action === 'reassign') this.need(ctx, 'ai_queue_assignment.assign');
      if (action === 'cancel') {
        this.need(ctx, 'ai_queue_assignment.override');   // removing a guest from the queue is a manager's call
        if (!reason || reason.length < 3) throw new QueueAssignmentValidationError('Say why the guest is being removed from the queue.');
      }
      queueItemId = alert.type === 'overloaded_technician' ? (body?.queueItemId ?? null) : alert.queueEntryId;
      if (!queueItemId) throw new QueueAssignmentValidationError('Choose which guest to move.');
      if (action === 'reassign' && !body?.technicianId) throw new QueueAssignmentValidationError('Choose the technician to assign.');
      // the guest as the queue sees it NOW: the reassign / unassign carries the current technician + version, so a board
      // that changed in the meantime gets a conflict instead of a silent overwrite (audit bug 5)
      const snap = await this.queue.snapshot(ctx);
      const entry = snap.entries.find((e) => e.queueEntryId === queueItemId);
      if (!entry) throw new QueueAlertConflictError('That guest is no longer in the queue — the alert will clear on the next scan.');
      if (alert.type === 'overloaded_technician' && entry.assignedTechnicianId !== alert.technicianId) throw new QueueAssignmentValidationError('That guest is not waiting for this technician.');
      result = await this.queue.repair(ctx, queueItemId, action, {
        technicianId: body?.technicianId ?? null, expectedTechnicianId: entry.assignedTechnicianId,
        expectedVersion: body?.expectedVersion ?? entry.version ?? null, reason: reason ?? `Repair from a ${alert.type.replace(/_/g, ' ')} alert`,
      });
    }
    await this.alerts.recordRepair(scope, { queueEntryId: queueItemId ?? alert.queueEntryId, alertId, action, reason, performedBy: ctx.userId, role: ctx.role,
      detail: { alertType: alert.type, technicianId: body?.technicianId ?? null } });
    const closed = await this.alerts.resolve(scope, alertId, ctx.userId, { note: reason, resolution: action === 'dismiss' ? 'dismissed' : `repaired:${action}` });
    this.emitter?.emit(scope, 'record_repaired', { alertId, queueEntryId: queueItemId ?? alert.queueEntryId, action });
    if (closed) this.emitter?.emit(scope, 'alert_resolved', { alertId, type: alert.type, queueEntryId: alert.queueEntryId, autoResolved: false, resolution: closed.resolution });
    return { alert: closed ?? alert, action, queueItemId, result };
  }

  // ── wait thresholds (the old screen's route; now a thin view over the one settings source) ───────────────────────
  async getThresholds(ctx: QueueAssignmentContext) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx);
    const e = await this.settings.effective(this.scope(ctx));
    return { approachingMin: e.waitApproachingMin, exceededMin: e.waitExceededMin, severeMin: e.waitSevereMin, criticalMin: e.waitCriticalMin, configVersion: e.configVersion };
  }
  async setThresholds(ctx: QueueAssignmentContext, t: { approachingMin?: number; exceededMin?: number; severeMin?: number; criticalMin?: number; expectedVersion?: number; reason?: string }) {
    this.need(ctx, 'ai_queue_assignment.manage_rules');
    await this.assertEnabled(ctx);
    const patch: Record<string, number> = {};
    if (t?.approachingMin !== undefined) patch.waitApproachingMin = Number(t.approachingMin);
    if (t?.exceededMin !== undefined) patch.waitExceededMin = Number(t.exceededMin);
    if (t?.severeMin !== undefined) patch.waitSevereMin = Number(t.severeMin);
    if (t?.criticalMin !== undefined) patch.waitCriticalMin = Number(t.criticalMin);
    const e = await this.settings.update(this.scope(ctx), patch, { userId: ctx.userId, role: ctx.role }, { expectedVersion: t?.expectedVersion, reason: t?.reason ?? null, change: 'thresholds' });
    this.emitter?.emit(this.scope(ctx), 'settings_changed', { scope: 'branch', configVersion: e.configVersion });
    return { approachingMin: e.waitApproachingMin, exceededMin: e.waitExceededMin, severeMin: e.waitSevereMin, criticalMin: e.waitCriticalMin, configVersion: e.configVersion };
  }
}

function clean(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().slice(0, 500);
  return t ? t : null;
}
