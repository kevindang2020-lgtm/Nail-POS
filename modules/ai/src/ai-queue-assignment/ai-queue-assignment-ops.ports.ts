// ai-queue-assignment-ops.ports.ts — BUILD_PLAN Phase 6: what the ops layer (alerts, overview, jobs) needs from the
// queue domain, and the adapter over QueueService (agent A's seam). The AI module never writes queue tables: every repair
// runs through the queue's own action (its permission checks, version / expected-technician guards, status history and
// audit stay in charge).
import type { QueueService, TechQueueService } from '@aipowersalon/queue';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';
import type { DetectionEntry, DetectionTechnician, RepairAction } from './ai-queue-assignment-detection';
import { WORKER_GRANTS, workerPrincipal } from '@aipowersalon/permissions';

export interface OpsQueueEntry extends DetectionEntry {
  version?: number | null;
  requestedTechnicianId?: string | null;
  isVip?: boolean;
  groupId?: string | null;
}
export interface OpsTechnician extends DetectionTechnician {
  name?: string | null;
  activeAssignments?: number;
  availableInMinutes?: number | null;
}
export interface QueueSnapshot { entries: OpsQueueEntry[]; technicians: OpsTechnician[] }
export interface RepairOptions { technicianId?: string | null; expectedTechnicianId?: string | null; expectedVersion?: number | null; reason?: string | null }

export interface QueueOpsQueuePort {
  /** every active entry of the caller's branch (no page cap — audit bug 4) + the technicians' live status */
  snapshot(ctx: QueueAssignmentContext): Promise<QueueSnapshot>;
  /** a repair, through the queue's own action; throws the queue's own errors (forbidden / conflict / validation) */
  repair(ctx: QueueAssignmentContext, queueItemId: string, action: Exclude<RepairAction, 'dismiss'>, opts: RepairOptions): Promise<unknown>;
}

/** The role of a background job's context. A job has NO user: userId is '' (the queue records actor null). */
export const SYSTEM_ROLE = 'SYSTEM';
/** What a background scan / auto-run reads and does (the queue skips its per-user checks for `system: true`; these are
 *  listed so any permission check that does run sees exactly what the job is for). */
// BUILD_PLAN Phase 9: the job acts as the named worker principal worker:ai-queue-scan with exactly its declared grant
// (packages/permissions worker-principals.ts) — the queue still records no user for it (actor null, source auto_assign).
export const SYSTEM_PERMISSIONS: readonly string[] = WORKER_GRANTS['ai-queue-scan'];
/** The context the per-branch background jobs run under — role SYSTEM, no user, never a person; `actor` names the worker. */
export function queueOpsSystemContext(tenantId: string, branchId: string): QueueAssignmentContext {
  const w = workerPrincipal('ai-queue-scan', { tenantId, branchId });
  return { tenantId, branchId, userId: '', role: SYSTEM_ROLE, permissions: [...w.permissions], actor: w.actor } as QueueAssignmentContext;
}
export const isSystemContext = (ctx: QueueAssignmentContext): boolean => ctx?.role === SYSTEM_ROLE && !ctx.userId;

// ── adapters ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** The queue's context. A background job → `system: true` (QueueService's in-process system path: no user, no per-user
 *  permission check, actor null on history). Staff → their own session, so the queue's own permission checks apply
 *  (pos.queue.assign_technician / call_next / move_to_serving + pos.serving.view / move_to_tech_queue / cancel). */
const qctx = (ctx: QueueAssignmentContext) => (isSystemContext(ctx)
  ? { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: '', role: SYSTEM_ROLE, permissions: [...SYSTEM_PERMISSIONS], system: true }
  : { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions }) as any;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Map a scanEntries row (agent A's contract shape) onto the detection entry. Tolerant of the older, thinner shape. */
export function toOpsEntry(r: any): OpsQueueEntry {
  return {
    queueEntryId: String(r.queueEntryId ?? r.queueItemId), status: String(r.status), waitMinutes: num(r.waitMinutes) ?? 0,
    assignedTechnicianId: str(r.assignedTechnicianId), requestedTechnicianId: str(r.requestedTechnicianId), isAppointment: !!r.isAppointment,
    appointmentStartAt: str(r.appointmentStartAt), lateMinutes: num(r.lateMinutes), startedAt: str(r.startedAt), expectedDurationMinutes: num(r.expectedDurationMinutes),
    updatedAt: str(r.updatedAt), version: num(r.version), isVip: !!r.isVip, groupId: str(r.groupId),
    lock: r.lock ? { technicianId: str(r.lock.technicianId), reason: str(r.lock.reason) } : null,
  };
}
export function toOpsTechnician(t: any): OpsTechnician {
  const status = String(t.status ?? t.workingStatus ?? (t.available ? 'available' : 'busy'));
  return { technicianId: String(t.technicianId), name: str(t.name), status, available: typeof t.available === 'boolean' ? t.available : status === 'available',
    onBreak: !!t.onBreak || status === 'on_break', activeAssignments: num(t.activeAssignments) ?? num(t.activeTicketCount) ?? 0, availableInMinutes: num(t.availableInMinutes) };
}

/** Over agent A's QueueService (modules/queue/src/queue/queue.service.ts): scanEntries + technicianAvailability for the
 *  snapshot; unassignTechnician / assignTechnician (source 'repair', expected technician + version → 409 when the
 *  board moved on), callNext, moveToServing, moveToTechQueue, cancel for the repairs. */
export class QueueServiceOpsAdapter implements QueueOpsQueuePort {
  constructor(private readonly queue: Pick<QueueService, 'scanEntries' | 'technicianAvailability' | 'unassignTechnician' | 'assignTechnician' | 'callNext' | 'moveToServing' | 'moveToTechQueue' | 'cancel'>,
    _techQueue?: TechQueueService | null) {}
  async snapshot(ctx: QueueAssignmentContext): Promise<QueueSnapshot> {
    const c = qctx(ctx);
    const [entries, technicians] = await Promise.all([this.queue.scanEntries(c), this.queue.technicianAvailability(c)]);
    return { entries: entries.map(toOpsEntry), technicians: technicians.map(toOpsTechnician) };
  }
  async repair(ctx: QueueAssignmentContext, id: string, action: Exclude<RepairAction, 'dismiss'>, o: RepairOptions): Promise<unknown> {
    const c = qctx(ctx); const reason = o.reason ?? 'Queue alert repair';
    // the expectation the alert was raised on: the technician the guest had (null = none) and the version read
    const expect = { expectedTechnicianId: o.expectedTechnicianId ?? null, ...(o.expectedVersion != null ? { expectedVersion: o.expectedVersion } : {}) };
    switch (action) {
      case 'unassign': return this.queue.unassignTechnician(c, id, { reason, source: 'repair', ...expect });
      case 'reassign':
        if (!o.technicianId) throw new Error('A technician is required');
        return this.queue.assignTechnician(c, id, { technicianId: o.technicianId, source: 'repair', reason, ...expect });
      case 'call': return this.queue.callNext(c, id);
      case 'start_service': return this.queue.moveToServing(c, id);
      case 'move_to_tech_queue': return this.queue.moveToTechQueue(c, id);
      case 'cancel': return this.queue.cancel(c, id, { reason });
    }
  }
}

/** Tests / DB-less. */
export class InMemoryQueueOps implements QueueOpsQueuePort {
  calls: { id: string; action: string; opts: RepairOptions }[] = [];
  constructor(public snap: QueueSnapshot = { entries: [], technicians: [] }, private readonly fail: Error | null = null) {}
  async snapshot(): Promise<QueueSnapshot> { return this.snap; }
  async repair(_ctx: QueueAssignmentContext, id: string, action: string, opts: RepairOptions): Promise<unknown> {
    if (this.fail) throw this.fail;
    this.calls.push({ id, action, opts });
    const e = this.snap.entries.find((x) => x.queueEntryId === id);
    if (e) {
      if (action === 'unassign') { e.assignedTechnicianId = null; e.status = 'waiting'; }
      if (action === 'reassign') { e.assignedTechnicianId = opts.technicianId ?? null; e.status = 'assigned'; }
      if (action === 'start_service') e.status = 'in_service';
      if (action === 'cancel') e.status = 'cancelled';
      e.updatedAt = new Date().toISOString();
    }
    return { ok: true };
  }
}
