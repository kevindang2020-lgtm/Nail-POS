// queue.repository.ts — persistence port + in-memory adapter for POS Queue.
// Tenant-scoped waiting guests with server-time wait tracking. A different tenant sees its own (empty) data —
// isolation. move-to-serving / move-to-tech-queue are idempotent (a retry never duplicates a downstream ticket).
import {
  Money, POSQueueFullState, POSQueueItemRow, POSQueueItemDetail, POSQueueKpisFull, QueueFilters, QueueItemStatus,
  QueuePriority, QueueSource, QueueRequestedService, QueueWorkflowSettings, DEFAULT_QUEUE_SETTINGS,
  estimateWaitMinutes,
  buildTopWaitingServices, buildVisitSourceMix, buildCustomerTypeMix, buildQueuePotentialRevenue, computeQueueConversion, QUEUE_CONVERSION_GOAL_PERCENT, QueueAssignmentConflict, type QueueAssignExpectation,
  type QueueWriteMeta, type QueueItemLock, type LockQueueItemRequest, type QueueHistoryRow, type QueueGroupView, type CreateQueueGroupRequest,
  type QueueServiceAssignmentView, type PlanWriteItem, QueueIdempotentReplay, QueueRuleError } from './queue.dto';
import { clampPageSize, clampPage, foldVi, withCode } from '@aipowersalon/api-contracts';
import { buildQueueFloor, projectedServiceCents } from './queue-floor';
import { computeTechSignals, rotationOrder, assignedMinutesFor, isActiveQueueStatus, type TechSignals } from './queue-signals';

/** `system` = an in-process caller with no user (the AI auto-run's background job). Controllers never set it. */
export interface QueueContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; system?: boolean }

interface QItem {
  queueItemId: string; customerId: string; customerName: string; customerPhone?: string; isVip: boolean; source: QueueSource;
  appointmentId: string | null; ticketId: string | null; services: QueueRequestedService[]; priority: QueuePriority; status: QueueItemStatus;
  assignedTechId: string | null; assignedTechName: string | null; requestedTechId?: string | null; requestedTechName?: string | null; station?: string; checkedInAtMs: number; calledAtMs: number | null;
  startedAtMs: number | null; notes: string; customerNotifiedAt: string | null; servingKey?: string; techQueueKey?: string; createdAtMs: number; updatedAt: string;
  // BUILD_PLAN Phase 6 — the shared state model
  branchId?: string | null; version?: number; position?: number | null; groupId?: string | null; lateMinutes?: number | null; previousTechId?: string | null;
}
interface TechRec { technicianId: string; name: string; available: boolean; skills: string[]; branchId?: string | null; /** false = suspended / inactive — never assignable (the Postgres adapter sets it) */ employed?: boolean; }

/** One active queue entry (any status that is not finished — in service included), the engine's / detector's view. */
export interface QueueActiveEntry {
  queueItemId: string; branchId: string | null; version: number; status: string; customerId: string | null; customerName: string;
  isVip: boolean; source: string; appointmentId: string | null; services: QueueRequestedService[];
  assignedTechId: string | null; requestedTechId: string | null; previousTechId: string | null; groupId: string | null; groupSize: number | null;
  position: number | null; lateMinutes: number | null; checkedInAtMs: number; startedAtMs: number | null; updatedAt: string;
  appointmentStartMs: number | null; lock: { technicianId: string | null; reason: string } | null;
  /** multi-technician routing: technicians holding a not-finished line (lead first), and each one's minutes on the visit */
  lineTechnicianIds?: string[]; lineMinutes?: Record<string, number>;
}
/** One technician with everything the engine ranks on (contract "A → everyone", candidates). */
export interface TechSignalRow {
  technicianId: string; name: string; branchId: string | null; available: boolean; skills: string[];
  activeAssignments: number; assignedMinutes: number; rotationIndex: number | null; lastServedAt: string | null; signals: TechSignals;
}
interface SvcRec { serviceId: string; name: string; categoryName: string; durationMinutes: number; priceCents: Money; }

/** Multi-technician routing: the line technicians of a visit (lead first) and each one's minutes on it. */
export function lineFields(lead: string | null, services: QueueRequestedService[], lines: { serviceId: string; technicianId: string }[]): { lineTechnicianIds: string[]; lineMinutes: Record<string, number> } {
  const lineMinutes: Record<string, number> = {};
  for (const l of lines) lineMinutes[l.technicianId] = (lineMinutes[l.technicianId] ?? 0) + services.filter((s) => s.serviceId === l.serviceId).reduce((n, s) => n + (Number(s.estimatedDurationMinutes) || 0), 0);
  const ids = Object.keys(lineMinutes);
  return { lineTechnicianIds: lead && ids.includes(lead) ? [lead, ...ids.filter((x) => x !== lead)] : ids, lineMinutes };
}
/** Does this visit hold one of the technician's capacity slots (lead, or a not-finished line)? */
export function holdsSlot(e: QueueActiveEntry, technicianId: string): boolean { return e.assignedTechId === technicianId || (e.lineTechnicianIds ?? []).includes(technicianId); }
/** The technician's minutes on this visit: their own lines when the visit is split by line, else the whole visit. */
export function minutesFor(e: QueueActiveEntry, technicianId: string): number {
  const m = e.lineMinutes ?? {};
  return Object.keys(m).length ? (m[technicianId] ?? 0) : e.services.reduce((n, s) => n + (Number(s.estimatedDurationMinutes) || 0), 0);
}

/** M4: one batch's shared detail reads (filled lazily by the repository; opaque to callers). */
export interface QueueDetailMemo { [k: string]: unknown }
export interface QueueDetailOptions { memo?: QueueDetailMemo; lean?: boolean }
export interface QueueRepositoryPort {
  /** Constitution 8: true when this repository writes domain events to the outbox inside its transactions, so
   *  the service must NOT also fire the in-process side effects (they would double). Absent/false = legacy path. */
  emitsDomainEvents?(): boolean;
  settings(ctx: QueueContext): Promise<QueueWorkflowSettings>;
  query(ctx: QueueContext, f: QueueFilters): Promise<POSQueueFullState>;
  item(ctx: QueueContext, id: string): Promise<QItem | null>;
  /** `opts` (M4): `memo` — reads shared by a batch of details on the same scope (the active queue, catalog, roster),
   *  `lean` — skip the customer-profile enrichment (loyalty / visits / spend / e-mail) the assignment engine never reads. */
  detail(ctx: QueueContext, id: string, opts?: QueueDetailOptions): Promise<POSQueueItemDetail | null>;
  technicians(ctx: QueueContext): Promise<TechRec[]>;
  /** users.id of the technician's login account (tenant-scoped), for push dispatch. Null when unlinked. */
  technicianUserId(ctx: QueueContext, technicianId: string): Promise<string | null>;
  /** users.id of the queue item's customer account (tenant-scoped), for push dispatch. Null for walk-ins with no account. */
  customerUserId(ctx: QueueContext, queueItemId: string): Promise<string | null>;
  serviceCatalog(ctx: QueueContext): Promise<SvcRec[]>;
  create(ctx: QueueContext, item: QItem): Promise<POSQueueItemRow>;
  createTicketFromQueueItem(ctx: QueueContext, item: QItem): Promise<string>;
  createWalkInCustomer(ctx: QueueContext, customerName: string, customerPhone?: string): Promise<string>;
  update(ctx: QueueContext, id: string, patch: Partial<QItem>): Promise<boolean>;
  // Every write below takes a QueueWriteMeta (BUILD_PLAN Phase 6): the version bump, the pos_queue_status_history row
  // and the pos_queue_audit row are written in the SAME transaction as the change (audit bug 15).
  setStatus(ctx: QueueContext, id: string, st: QueueItemStatus, meta?: QueueWriteMeta): Promise<boolean>;
  /** `expect` = compare-and-set: apply only if the item still has this status + assignee (+ version) (spec §77); else
   *  QueueAssignmentConflict. A replayed idempotency key throws QueueIdempotentReplay (nothing written). */
  assign(ctx: QueueContext, id: string, technicianId: string, expect?: QueueAssignExpectation, meta?: QueueWriteMeta): Promise<boolean>;
  /** `expect` = compare-and-set (round 2, the ops repair path): stale → QueueAssignmentConflict. */
  unassign(ctx: QueueContext, id: string, meta?: QueueWriteMeta, expect?: QueueAssignExpectation): Promise<boolean>;
  setRequestedTechnician(ctx: QueueContext, id: string, technicianId: string | null, meta?: QueueWriteMeta): Promise<boolean>;
  setServices(ctx: QueueContext, id: string, services: QueueRequestedService[], meta?: QueueWriteMeta): Promise<boolean>;
  setPriority(ctx: QueueContext, id: string, priority: QueuePriority, meta?: QueueWriteMeta): Promise<boolean>;
  markCalled(ctx: QueueContext, id: string, meta?: QueueWriteMeta): Promise<boolean>;
  /** Records a write that the repository itself does not describe (details edit, notification) in pos_queue_audit. */
  audit(ctx: QueueContext, id: string | null, meta: QueueWriteMeta): Promise<void>;
  // ---- BUILD_PLAN Phase 6: the shared queue state model ----
  /** ALL active entries of the branch (no page, no cap — audit bug 4), in service included. Not the branch's history. */
  activeEntries(ctx: QueueContext): Promise<QueueActiveEntry[]>;
  /** Every technician of the branch with their REAL branch and the timing / fairness signals. */
  techSignals(ctx: QueueContext, entries?: QueueActiveEntry[]): Promise<TechSignalRow[]>;
  /** The technician of this customer's last finished visit (fallback when check-in did not stamp it). */
  previousTechnicianFor(ctx: QueueContext, customerId: string): Promise<string | null>;
  /** The assignment an idempotency key already produced (null = key unused). */
  idempotentAssignment(ctx: QueueContext, key: string): Promise<{ queueItemId: string; technicianId: string | null; version: number } | null>;
  history(ctx: QueueContext, id: string): Promise<QueueHistoryRow[]>;
  activeLock(ctx: QueueContext, id: string): Promise<QueueItemLock | null>;
  lock(ctx: QueueContext, id: string, req: LockQueueItemRequest, meta: QueueWriteMeta): Promise<QueueItemLock>;
  unlock(ctx: QueueContext, id: string, reason: string, meta: QueueWriteMeta): Promise<boolean>;
  /** Positions 1..n in the given order; an item whose version moved since the caller read it → QueueAssignmentConflict (all or nothing). */
  reorder(ctx: QueueContext, order: { queueItemId: string; expectedVersion?: number }[], meta: QueueWriteMeta): Promise<{ queueItemId: string; position: number; version: number }[]>;
  createGroup(ctx: QueueContext, req: CreateQueueGroupRequest, meta: QueueWriteMeta): Promise<QueueGroupView>;
  groups(ctx: QueueContext): Promise<QueueGroupView[]>;
  serviceAssignments(ctx: QueueContext, id: string): Promise<QueueServiceAssignmentView[]>;
  setServiceAssignments(ctx: QueueContext, id: string, rows: { serviceId: string; technicianId: string | null }[], meta: QueueWriteMeta): Promise<QueueServiceAssignmentView[]>;
  /** customers.id of the signed-in customer in this salon (customers.user_id link). */
  customerIdForUser(ctx: QueueContext): Promise<string | null>;
  markNotified(ctx: QueueContext, id: string): Promise<void>;
  waitEstimate(ctx: QueueContext): Promise<{ configured: boolean; quotedWaitMinutes?: number; basis: string; reason?: string }>;
  getServingKey(ctx: QueueContext, id: string): Promise<string | undefined>;
  setServingKey(ctx: QueueContext, id: string, key: string): Promise<void>;
  getTechQueueKey(ctx: QueueContext, id: string): Promise<string | undefined>;
  setTechQueueKey(ctx: QueueContext, id: string, key: string): Promise<void>;
  // Projects a queue item into the technician queue (pos_tech_queue_tickets) when it is moved to the tech queue.
  // Idempotent: a queue item already projected returns its existing tech-queue ticket without creating a duplicate.
  projectToTechQueue(ctx: QueueContext, id: string): Promise<{ created: boolean; techQueueTicketId?: string; techQueueTicketIds?: string[] }>;
  nextSeq(): number;
  /** Multi-technician routing: the ONE writer of a multi-line assignment — all or none (see the Kysely implementation).
   *  Stale guest / line → QueueAssignmentConflict (queueItemId / serviceId set); a used key → QueueIdempotentReplay. */
  assignPlan(ctx: QueueContext, req: PlanWriteRequest): Promise<{ queueItemId: string; version: number; assignedTechnicianId: string }[]>;
}
export interface PlanWriteRequest { items: PlanWriteItem[]; groupId: string | null; source: string; ai: boolean; keyBase: string; reason: string | null; metadata?: Record<string, unknown> }

const now = () => new Date().toISOString();
const COMMISSION = 15;

export class InMemoryQueueRepository implements QueueRepositoryPort {
  private store = new Map<string, QItem[]>();
  private techs = new Map<string, TechRec[]>();
  private catalog = new Map<string, SvcRec[]>();
  private seq = 7000;
  // BUILD_PLAN Phase 6 — the in-memory twin of pos_queue_status_history / pos_queue_audit / locks / groups / service lines
  readonly historyRows: (QueueHistoryRow & { tenantId: string; queueItemId: string; idempotencyKey?: string | null })[] = [];
  readonly auditRows: { tenantId: string; userId: string | null; role: string; actionType: string; entityId: string | null; metadata: Record<string, unknown>; createdAt: string }[] = [];
  private locks: (QueueItemLock & { tenantId: string; queueItemId: string; releasedAt: string | null })[] = [];
  private groupRows: { tenantId: string; groupId: string; label: string; size: number; together: boolean; createdAt: string }[] = [];
  private serviceRows: { tenantId: string; queueItemId: string; serviceId: string; technicianId: string | null; status: string; sequence: number; version?: number; timing?: 'parallel' | 'after'; afterServiceId?: string | null }[] = [];
  /** technician signals a test sets directly (the in-memory roster has no schedules / clock-ins) */
  signalOverrides = new Map<string, Partial<TechSignals>>();
  /** previous finished visit's technician, by customer id (tests set it) */
  previousVisits = new Map<string, string>();
  nextSeq() { return ++this.seq; }

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); this.techs.set(tenantId, []); this.catalog.set(tenantId, []); return; }
    const mAgo = (m: number) => Date.now() - m * 60000;
    const cat: SvcRec[] = [
      { serviceId: 'svc_mani', name: 'Signature Manicure', categoryName: 'Manicure', durationMinutes: 45, priceCents: 5500 },
      { serviceId: 'svc_pedi', name: 'Spa Pedicure', categoryName: 'Pedicure', durationMinutes: 55, priceCents: 6500 },
      { serviceId: 'svc_gel', name: 'Gel Add-on', categoryName: 'Add-on', durationMinutes: 15, priceCents: 1500 },
      { serviceId: 'svc_wax', name: 'Eyebrow Wax', categoryName: 'Waxing', durationMinutes: 20, priceCents: 2200 },
    ];
    this.catalog.set(tenantId, cat);
    const svc = (id: string): QueueRequestedService => { const s = cat.find((x) => x.serviceId === id)!; return { serviceId: s.serviceId, serviceName: s.name, estimatedDurationMinutes: s.durationMinutes, priceCents: s.priceCents }; };
    this.techs.set(tenantId, [
      { technicianId: 'tech_mia', name: 'Mia', available: true, skills: ['Manicure', 'Add-on'], branchId: 'br1' },
      { technicianId: 'tech_ava', name: 'Ava', available: true, skills: ['Pedicure', 'Manicure'], branchId: 'br1' },
      { technicianId: 'tech_leo', name: 'Leo', available: false, skills: ['Waxing', 'Manicure'], branchId: 'br1' },
    ]);
    const mk = (id: string, cust: string, phone: string, vip: boolean, source: QueueSource, services: QueueRequestedService[], priority: QueuePriority, status: QueueItemStatus, checkedMinAgo: number, techId: string | null, techName: string | null, over: Partial<QItem> = {}): QItem => ({
      queueItemId: id, customerId: 'c_' + id, customerName: cust, customerPhone: phone, isVip: vip, source, appointmentId: source === 'appointment' ? 'appt_' + id : null, ticketId: null,
      services, priority, status, assignedTechId: techId, assignedTechName: techName, station: undefined, checkedInAtMs: mAgo(checkedMinAgo), calledAtMs: status === 'called' ? mAgo(checkedMinAgo - 2) : null,
      startedAtMs: status === 'in_service' ? mAgo(10) : null, notes: '', customerNotifiedAt: null, createdAtMs: mAgo(checkedMinAgo), updatedAt: new Date(mAgo(Math.min(checkedMinAgo, 5))).toISOString(),
      branchId: 'br1', version: 1, position: null, groupId: null, lateMinutes: null, previousTechId: null, ...over,
    });
    this.store.set(tenantId, [
      mk('q_5001', 'Grace Kim', '+18565550101', true, 'walk_in', [svc('svc_mani'), svc('svc_gel')], 'vip', 'waiting', 25, null, null),
      mk('q_5002', 'Nora Patel', '+18565550102', false, 'appointment', [svc('svc_pedi')], 'normal', 'waiting', 10, null, null),
      mk('q_5003', 'Liv Chen', '+18565550103', false, 'walk_in', [svc('svc_mani')], 'normal', 'assigned', 15, 'tech_ava', 'Ava'),
      mk('q_5004', 'Ivy Park', '+18565550104', false, 'online', [svc('svc_wax')], 'high', 'called', 30, null, null),
      mk('q_5005', 'Mia Wong', '+18565550105', false, 'appointment', [svc('svc_mani'), svc('svc_pedi')], 'normal', 'ready_for_tech', 5, 'tech_mia', 'Mia'),
      mk('q_5006', 'Zoe Diaz', '+18565550106', false, 'walk_in', [svc('svc_gel')], 'normal', 'in_service', 40, 'tech_leo', 'Leo'),
    ]);
  }
  private L(ctx: QueueContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  private _item(ctx: QueueContext, id: string) { return this.L(ctx).find((q) => q.queueItemId === id) || null; }
  async item(ctx: QueueContext, id: string) { return this._item(ctx, id); }
  private _settings() { return DEFAULT_QUEUE_SETTINGS; }
  async settings(_ctx: QueueContext) { return this._settings(); }
  private _techs(ctx: QueueContext) { this.ensure(ctx.tenantId); return (this.techs.get(ctx.tenantId) || []).slice(); }
  async technicians(ctx: QueueContext) { return this._techs(ctx); }
  async technicianUserId(ctx: QueueContext, technicianId: string) { return this._techs(ctx).some((t) => t.technicianId === technicianId) ? 'user_' + technicianId : null; }
  async customerUserId(ctx: QueueContext, queueItemId: string) { const q = this._item(ctx, queueItemId); return q?.customerId ? 'user_' + q.customerId : null; }
  private _catalog(ctx: QueueContext) { this.ensure(ctx.tenantId); return (this.catalog.get(ctx.tenantId) || []).slice(); }
  async serviceCatalog(ctx: QueueContext) { return this._catalog(ctx); }

  private waited(q: QItem) { return Math.max(0, Math.floor((Date.now() - q.checkedInAtMs) / 60000)); }
  private activeStatuses: QueueItemStatus[] = ['waiting', 'called', 'assigned', 'ready_for_tech'];
  private avgServiceMin(ctx: QueueContext) { const cat = this._catalog(ctx); return cat.length ? Math.round(cat.reduce((a, s) => a + s.durationMinutes, 0) / cat.length) : 45; }
  private availTechs(ctx: QueueContext) { return this._techs(ctx).filter((t) => t.available).length; }
  private techName(ctx: QueueContext, id: string | null | undefined) { return id ? (this._techs(ctx).find((t) => t.technicianId === id)?.name ?? null) : null; }
  private lockOf(ctx: QueueContext, id: string): QueueItemLock | null {
    const now = Date.now();
    const l = this.locks.find((x) => x.tenantId === ctx.tenantId && x.queueItemId === id && !x.releasedAt && (!x.expiresAt || Date.parse(x.expiresAt) > now));
    if (!l) return null;
    const { tenantId: _t, queueItemId: _q, releasedAt: _r, ...view } = l; return { ...view, technicianName: this.techName(ctx, l.technicianId) };
  }

  private lockFields(ctx: QueueContext, id: string) { const l = this.lockOf(ctx, id); return { locked: !!l, lock: l ? { technicianId: l.technicianId, reason: l.reason } : null }; }
  private toRow(ctx: QueueContext, q: QItem): POSQueueItemRow {
    const reqName = q.requestedTechName || (q.requestedTechId ? (this._techs(ctx).find((t) => t.technicianId === q.requestedTechId)?.name || undefined) : undefined);
    const waited = this.waited(q);
    const waitingCount = this.L(ctx).filter((x) => this.activeStatuses.includes(x.status)).length;
    return {
      queueItemId: q.queueItemId, tenantId: ctx.tenantId, branchId: q.branchId ?? ctx.branchId, customerId: q.customerId, customerName: q.customerName, customerPhone: q.customerPhone, isVip: q.isVip,
      source: q.source, appointmentId: q.appointmentId, ticketId: q.ticketId, requestedServices: q.services, serviceCount: q.services.length, priority: q.priority, status: q.status, requestedTechnicianName: reqName,
      assignedTechnicianId: q.assignedTechId, assignedTechnicianName: q.assignedTechName, station: q.station, checkedInAt: new Date(q.checkedInAtMs).toISOString(),
      quotedWaitMinutes: estimateWaitMinutes(waitingCount, this.avgServiceMin(ctx), this.availTechs(ctx)), actualWaitMinutes: waited, notes: q.notes,
      createdAt: new Date(q.createdAtMs).toISOString(), updatedAt: q.updatedAt,
      version: q.version ?? 1, requestedTechnicianId: q.requestedTechId ?? null, position: q.position ?? null, groupId: q.groupId ?? null, ...this.lockFields(ctx, q.queueItemId),
    };
  }
  private techEligible(ctx: QueueContext, q: QItem): boolean {
    if (!q.assignedTechId) return false; const tech = this._techs(ctx).find((t) => t.technicianId === q.assignedTechId); if (!tech) return false;
    const cats = new Set(this._catalog(ctx).filter((s) => q.services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    return [...cats].every((c) => tech.skills.includes(c));
  }

  private filtered(ctx: QueueContext, f: QueueFilters): QItem[] {
    let rows = this.L(ctx).slice();
    if (f.search) { const s = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ rows = rows.filter((q) => [q.customerName, q.customerPhone, q.assignedTechName, q.notes, ...q.services.map((x) => x.serviceName)].some((x) => foldVi(x).includes(s))); }
    if (f.status) rows = rows.filter((q) => q.status === f.status);
    if (f.source) rows = rows.filter((q) => q.source === f.source);
    if (f.priority) rows = rows.filter((q) => q.priority === f.priority);
    if (f.technicianId) rows = rows.filter((q) => q.assignedTechId === f.technicianId);
    if (f.serviceCategory) { const cat = this._catalog(ctx); rows = rows.filter((q) => q.services.some((rs) => cat.find((s) => s.serviceId === rs.serviceId)?.categoryName === f.serviceCategory)); }
    if (f.station) rows = rows.filter((q) => q.station === f.station);
    if (f.waitMin != null) rows = rows.filter((q) => this.waited(q) >= Number(f.waitMin));
    if (f.waitMax != null) rows = rows.filter((q) => this.waited(q) <= Number(f.waitMax));
    // the board's order: a manager's reorder (position) first, then first come first served
    return rows.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.checkedInAtMs - b.checkedInAtMs);
  }

  async query(ctx: QueueContext, f: QueueFilters) {
    const all = this.L(ctx);
    const matched = this.filtered(ctx, f);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((q) => this.toRow(ctx, q));

    const active = all.filter((q) => this.activeStatuses.includes(q.status));
    const waits = active.map((q) => this.waited(q));
    const kpis: POSQueueKpisFull = {
      waitingGuests: active.length,
      averageWaitMinutes: waits.length ? Math.round(waits.reduce((a, w) => a + w, 0) / waits.length) : null,
      longestWaitMinutes: waits.length ? Math.max(...waits) : 0,
      vipWaiting: active.filter((q) => q.isVip || q.priority === 'vip').length,
      appointmentsWaiting: active.filter((q) => q.source === 'appointment').length,
      walkInsWaiting: active.filter((q) => q.source === 'walk_in').length,
      readyForTech: all.filter((q) => q.status === 'ready_for_tech').length,
      assignedTechnicians: new Set(active.filter((q) => q.assignedTechId).map((q) => q.assignedTechId)).size,
      delayedQueueItems: active.filter((q) => this.waited(q) > this.avgServiceMin(ctx)).length,
      readyForAssignment: active.filter((q) => !q.assignedTechId && (q.status === 'waiting' || q.status === 'called')).length,
      estQueueRevenueCents: active.reduce((a, q) => a + q.services.reduce((b: number, rs) => b + projectedServiceCents(rs), 0), 0),
      readyForService: all.filter((q) => q.status === 'ready_for_tech' || q.status === 'assigned').length,
      noShowRisk: active.filter((q) => q.source === 'appointment' && this.waited(q) > Math.max(15, this.avgServiceMin(ctx))).length,
      returnRatePercent: null,   // §15: this adapter keeps no paid-visit history — nothing to measure, not "0% return"
    };
    const aggItems = active.map((q) => ({ source: q.source, isVip: q.isVip, priority: q.priority, customerId: q.customerId, requestedServices: q.services.map((rs) => ({ serviceName: rs.serviceName, priceCents: projectedServiceCents(rs) })) }));
    const potRev = buildQueuePotentialRevenue(aggItems);
    const today0 = new Date(); const isToday = (q: any) => { const c = q.checkedInAtMs ? new Date(q.checkedInAtMs) : null; return !!c && c.toDateString() === today0.toDateString(); };
    const elig = all.filter((q: any) => isToday(q) && q.status !== 'cancelled');
    const conv = { percent: computeQueueConversion(elig.length, elig.filter((q: any) => q.status === 'in_service' || q.startedAtMs).length), goalPercent: QUEUE_CONVERSION_GOAL_PERCENT, deltaPercent: null };
    const analytics = {
      queueTrend: [] as { hour: number; count: number }[], customerTypeMix: buildCustomerTypeMix(aggItems, {}), visitSourceMix: buildVisitSourceMix(aggItems), topWaitingServices: buildTopWaitingServices(aggItems),
      conversion: conv, potentialRevenueByService: potRev.byService, potentialRevenueTotalCents: potRev.totalCents, potentialRevenueDeltaPercent: null,
    };

    // Customer Queue mandate §20–§29: the same server projection as the Postgres adapter (it answered staff: [], insights: [])
    const signals = await this.techSignals(ctx);
    const floor = buildQueueFloor({
      items: all.filter((q) => isActiveQueueStatus(q.status) && q.status !== 'in_service').map((q) => ({ queueItemId: q.queueItemId, status: q.status, priority: q.priority, isVip: q.isVip, source: String(q.source), customerName: q.customerName, assignedTechId: q.assignedTechId, checkedInAtMs: q.checkedInAtMs, services: q.services })),
      techs: signals.map((t) => ({ technicianId: t.technicianId, name: t.name, skills: t.skills, activeAssignments: t.activeAssignments, rotationIndex: t.rotationIndex, signals: t.signals })),
      vipPriorityEnabled: this._settings().vipPriorityEnabled, avgServiceMinutes: this.avgServiceMin(ctx), peakHour: null, nowMs: Date.now(),
    });
    const rowOf = (qid: string) => { const r = this.toRow(ctx, this._item(ctx, qid)!); r.waitLevel = floor.waitLevel[qid] ?? 'normal'; return r; };
    for (const r of pageRows) r.waitLevel = floor.waitLevel[r.queueItemId] ?? 'normal';
    return {
      kpis, analytics, staff: floor.staff, insights: floor.insights, queue: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      flow: { counts: floor.flowCounts, top: Object.fromEntries(Object.entries(floor.flowTop).map(([k, ids]) => [k, ids.map(rowOf)])) },
      waitingByPriority: floor.priorityOrder.map(rowOf), priorityCounts: floor.priorityCounts, staffSummary: floor.staffSummary,
      filters: {
        statuses: ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue', 'in_service', 'cancelled', 'removed'],
        sources: ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'], technicians: [...new Set(all.map((q) => q.assignedTechName || ''))].filter(Boolean),
        serviceCategories: [...new Set(this._catalog(ctx).map((s) => s.categoryName))], priorityLevels: ['normal', 'high', 'vip', 'urgent'], stations: [...new Set(all.map((q) => q.station || ''))].filter(Boolean),
      },
      workflowSettings: this._settings(),
    };
  }

  async detail(ctx: QueueContext, id: string, _opts?: QueueDetailOptions) {
    const q = this._item(ctx, id); if (!q) return null;
    const prev = q.previousTechId ?? (q.customerId ? this.previousVisits.get(q.customerId) ?? null : null);
    return {
      ...this.toRow(ctx, q), technicianEligible: this.techEligible(ctx, q), customerNotifiedAt: q.customerNotifiedAt, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: q.updatedAt }],
      previousTechnicianId: prev, previousTechnicianName: this.techName(ctx, prev), lock: this.lockOf(ctx, id), lateMinutes: q.lateMinutes ?? null, appointmentStartAt: null,
      serviceAssignments: await this.serviceAssignments(ctx, id),
    };
  }

  /** One transition: bump the version, write the history + audit rows (the in-memory twin of migration 525's trigger). */
  private transition(ctx: QueueContext, q: QItem, meta: QueueWriteMeta | undefined, change: () => void): void {
    if (meta?.idempotencyKey && this.historyRows.some((h) => h.tenantId === ctx.tenantId && h.idempotencyKey === meta.idempotencyKey)) throw new QueueIdempotentReplay(q.queueItemId);
    const fromStatus = q.status, fromTech = q.assignedTechId ?? null;
    change();
    q.version = (q.version ?? 1) + 1; q.updatedAt = new Date().toISOString();
    this.historyRows.push({ tenantId: ctx.tenantId, queueItemId: q.queueItemId, version: q.version, fromStatus, toStatus: q.status, fromTechnicianId: fromTech, toTechnicianId: q.assignedTechId ?? null,
      action: meta?.action ?? (fromTech !== (q.assignedTechId ?? null) ? (q.assignedTechId ? 'assign' : 'unassign') : fromStatus !== q.status ? 'status' : 'update'),
      source: meta?.source ?? (ctx.system ? 'system' : 'staff'), actorId: ctx.userId || null, reason: meta?.reason ?? null, createdAt: q.updatedAt, idempotencyKey: meta?.idempotencyKey ?? null });
    if (meta) void this.audit(ctx, q.queueItemId, meta);
  }
  async audit(ctx: QueueContext, id: string | null, meta: QueueWriteMeta) {
    this.auditRows.push({ tenantId: ctx.tenantId, userId: ctx.userId || null, role: ctx.system ? 'SYSTEM' : ctx.role, actionType: meta.auditAction ?? 'pos_queue_' + meta.action, entityId: id,
      metadata: { source: meta.source ?? (ctx.system ? 'system' : 'staff'), reason: meta.reason ?? null, ...(meta.metadata || {}) }, createdAt: new Date().toISOString() });
  }

  async create(ctx: QueueContext, item: QItem) {
    const row: QItem = { branchId: ctx.branchId || null, version: 1, position: null, groupId: null, lateMinutes: null, ...item };
    if (!row.previousTechId && row.customerId) row.previousTechId = this.previousVisits.get(row.customerId) ?? null;   // stamped at check-in (migration 525 does this in SQL)
    this.L(ctx).push(row);
    this.historyRows.push({ tenantId: ctx.tenantId, queueItemId: row.queueItemId, version: 1, fromStatus: null, toStatus: row.status, fromTechnicianId: null, toTechnicianId: row.assignedTechId ?? null, action: 'check_in', source: 'staff', actorId: ctx.userId || null, reason: null, createdAt: new Date().toISOString() });
    return this.toRow(ctx, row);
  }
  async createTicketFromQueueItem(_ctx: QueueContext, _item: QItem) { return 't_' + this.nextSeq(); }
  async createWalkInCustomer(_ctx: QueueContext, _customerName: string, _customerPhone?: string) { return 'c_walkin_' + this.nextSeq(); }
  async update(ctx: QueueContext, id: string, patch: Partial<QItem>) { const q = this._item(ctx, id); if (!q) return false; Object.assign(q, patch); q.updatedAt = now(); return true; }
  async setStatus(ctx: QueueContext, id: string, st: QueueItemStatus, meta?: QueueWriteMeta) { const q = this._item(ctx, id); if (!q) return false; this.transition(ctx, q, meta, () => { q.status = st; if (st === 'in_service') q.startedAtMs = Date.now(); }); return true; }
  async assign(ctx: QueueContext, id: string, technicianId: string, expect?: QueueAssignExpectation, meta?: QueueWriteMeta) {
    const q = this._item(ctx, id); const tech = this._techs(ctx).find((t) => t.technicianId === technicianId); if (!q || !tech) return false;
    if (meta?.idempotencyKey && this.historyRows.some((h) => h.tenantId === ctx.tenantId && h.idempotencyKey === meta.idempotencyKey)) throw new QueueIdempotentReplay(id);
    if (expect && (q.status !== expect.status || (q.assignedTechId ?? null) !== (expect.technicianId ?? null) || (expect.version != null && (q.version ?? 1) !== expect.version))) throw new QueueAssignmentConflict(q.assignedTechId ?? null, q.version ?? 1);
    this.transition(ctx, q, meta, () => { q.assignedTechId = tech.technicianId; q.assignedTechName = tech.name; if (q.status === 'waiting' || q.status === 'called') q.status = 'assigned'; });
    return true;
  }
  async unassign(ctx: QueueContext, id: string, meta?: QueueWriteMeta, expect?: QueueAssignExpectation) { const q = this._item(ctx, id); if (!q) return false;
    if (expect && ((q.assignedTechId ?? null) !== (expect.technicianId ?? null) || (expect.version != null && (q.version ?? 1) !== expect.version))) throw new QueueAssignmentConflict(q.assignedTechId ?? null, q.version ?? 1);
    this.transition(ctx, q, meta, () => { q.assignedTechId = null; q.assignedTechName = null; if (q.status === 'assigned' || q.status === 'ready_for_tech') q.status = 'waiting'; });
    for (const r of this.serviceRows) if (r.tenantId === ctx.tenantId && r.queueItemId === id && r.status === 'assigned') { r.technicianId = null; r.status = 'pending'; r.version = (r.version ?? 1) + 1; }
    return true; }
  async setRequestedTechnician(ctx: QueueContext, id: string, technicianId: string | null, meta?: QueueWriteMeta) {
    const q = this._item(ctx, id); if (!q) return false;
    const t = technicianId ? this._techs(ctx).find((x) => x.technicianId === technicianId) : null; if (technicianId && !t) return false;
    this.transition(ctx, q, meta, () => { q.requestedTechId = t?.technicianId ?? null; q.requestedTechName = t?.name ?? null; }); return true;
  }
  async setServices(ctx: QueueContext, id: string, services: QueueRequestedService[], meta?: QueueWriteMeta) { const q = this._item(ctx, id); if (!q) return false; this.transition(ctx, q, meta, () => { q.services = services; }); return true; }
  async setPriority(ctx: QueueContext, id: string, priority: QueuePriority, meta?: QueueWriteMeta) { const q = this._item(ctx, id); if (!q) return false; this.transition(ctx, q, meta, () => { q.priority = priority; }); return true; }
  async markCalled(ctx: QueueContext, id: string, meta?: QueueWriteMeta) { const q = this._item(ctx, id); if (!q) return false; this.transition(ctx, q, meta, () => { q.status = 'called'; q.calledAtMs = Date.now(); }); return true; }
  async markNotified(ctx: QueueContext, id: string) { const q = this._item(ctx, id); if (q) { q.customerNotifiedAt = now(); q.updatedAt = now(); } }

  async waitEstimate(ctx: QueueContext) {
    const settings = this._settings();
    if (settings.waitEstimateBasis === 'manual') return { configured: false, basis: 'manual', reason: 'Estimate unavailable — wait estimate is set to manual.' };
    const active = this.L(ctx).filter((q) => this.activeStatuses.includes(q.status)).length;
    const techs = this.availTechs(ctx);
    if (settings.waitEstimateBasis === 'available_techs' && techs <= 0) return { configured: true, quotedWaitMinutes: estimateWaitMinutes(active, this.avgServiceMin(ctx), 0), basis: 'available_techs' };
    return { configured: true, quotedWaitMinutes: estimateWaitMinutes(active, this.avgServiceMin(ctx), techs), basis: settings.waitEstimateBasis };
  }
  async getServingKey(ctx: QueueContext, id: string) { return this._item(ctx, id)?.servingKey; }
  async setServingKey(ctx: QueueContext, id: string, key: string) { const q = this._item(ctx, id); if (q) q.servingKey = key; }
  async getTechQueueKey(ctx: QueueContext, id: string) { return this._item(ctx, id)?.techQueueKey; }
  async setTechQueueKey(ctx: QueueContext, id: string, key: string) { const q = this._item(ctx, id); if (q) q.techQueueKey = key; }
  // In-memory double has no separate pos_tech_queue_tickets store (that is the tech-queue module's table); the live
  // projection runs on the Kysely repository. No-op keeps the port satisfied for unit tests that use this double.
  async projectToTechQueue(_ctx: QueueContext, _id: string): Promise<{ created: boolean; techQueueTicketId?: string }> { return { created: false }; }

  // ---- BUILD_PLAN Phase 6 ----
  async activeEntries(ctx: QueueContext): Promise<QueueActiveEntry[]> {
    return this.L(ctx).filter((q) => isActiveQueueStatus(q.status) && (!ctx.branchId || !q.branchId || q.branchId === ctx.branchId)).map((q) => {
      const lock = this.lockOf(ctx, q.queueItemId);
      const group = q.groupId ? this.groupRows.find((g) => g.groupId === q.groupId) : undefined;
      return {
        queueItemId: q.queueItemId, branchId: q.branchId ?? null, version: q.version ?? 1, status: q.status, customerId: q.customerId || null, customerName: q.customerName,
        isVip: q.isVip || q.priority === 'vip', source: q.source, appointmentId: q.appointmentId, services: q.services, assignedTechId: q.assignedTechId ?? null,
        requestedTechId: q.requestedTechId ?? null, previousTechId: q.previousTechId ?? null, groupId: q.groupId ?? null, groupSize: group?.size ?? null, position: q.position ?? null,
        lateMinutes: q.lateMinutes ?? null, checkedInAtMs: q.checkedInAtMs, startedAtMs: q.startedAtMs, updatedAt: q.updatedAt, appointmentStartMs: null,
        lock: lock ? { technicianId: lock.technicianId, reason: lock.reason } : null,
        ...lineFields(q.assignedTechId ?? null, q.services, this.serviceRows.filter((r) => r.tenantId === ctx.tenantId && r.queueItemId === q.queueItemId && r.technicianId && ['pending', 'assigned', 'in_service'].includes(r.status)).map((r) => ({ serviceId: r.serviceId, technicianId: r.technicianId! }))),
      };
    });
  }
  async techSignals(ctx: QueueContext, entries?: QueueActiveEntry[]): Promise<TechSignalRow[]> {
    const es = entries ?? await this.activeEntries(ctx); const nowMs = Date.now();
    const dur = (e: QueueActiveEntry) => e.services.reduce((n, s) => n + (s.estimatedDurationMinutes || 0), 0);
    const techs = this._techs(ctx);
    const rot = rotationOrder(techs.map((t) => ({ technicianId: t.technicianId, name: t.name, lastServedAtMs: null })), []);
    return techs.map((t) => {
      const mine = es.filter((e) => holdsSlot(e, t.technicianId));
      const inService = mine.filter((e) => e.status === 'in_service' && e.startedAtMs != null).map((e) => ({ startedAtMs: e.startedAtMs as number, durationMinutes: minutesFor(e, t.technicianId) }));
      const base = computeTechSignals({ technicianId: t.technicianId, liveStatus: t.available ? 'available' : 'off_today', schedule: null, punch: null, blocks: [], appointments: [], inService, rosterActive: t.available }, 0, nowMs);
      return {
        technicianId: t.technicianId, name: t.name, branchId: t.branchId ?? null, available: t.available, skills: t.skills,
        activeAssignments: mine.length, assignedMinutes: assignedMinutesFor(mine.map((e) => ({ status: e.status, durationMinutes: minutesFor(e, t.technicianId), startedAtMs: e.startedAtMs })), nowMs),
        rotationIndex: rot[t.technicianId] ?? null, lastServedAt: null, signals: { ...base, ...(this.signalOverrides.get(t.technicianId) || {}) },
      };
    });
  }
  async previousTechnicianFor(_ctx: QueueContext, customerId: string) { return this.previousVisits.get(customerId) ?? null; }
  async idempotentAssignment(ctx: QueueContext, key: string) {
    const h = this.historyRows.find((x) => x.tenantId === ctx.tenantId && x.idempotencyKey === key);
    return h ? { queueItemId: h.queueItemId, technicianId: h.toTechnicianId, version: h.version } : null;
  }
  async history(ctx: QueueContext, id: string): Promise<QueueHistoryRow[]> {
    return this.historyRows.filter((h) => h.tenantId === ctx.tenantId && h.queueItemId === id).map(({ tenantId: _t, queueItemId: _q, idempotencyKey: _k, ...r }) => r);
  }
  async activeLock(ctx: QueueContext, id: string) { return this.lockOf(ctx, id); }
  async lock(ctx: QueueContext, id: string, req: LockQueueItemRequest, meta: QueueWriteMeta): Promise<QueueItemLock> {
    const q = this._item(ctx, id); if (!q) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND');
    for (const l of this.locks) if (l.tenantId === ctx.tenantId && l.queueItemId === id && !l.releasedAt) l.releasedAt = new Date().toISOString();
    const lock = { tenantId: ctx.tenantId, queueItemId: id, releasedAt: null, lockId: 'lock_' + this.nextSeq(), technicianId: req.technicianId ?? null, reason: req.reason, lockedBy: ctx.userId || null,
      expiresAt: req.expiresInMinutes ? new Date(Date.now() + req.expiresInMinutes * 60000).toISOString() : null, createdAt: new Date().toISOString() };
    this.locks.push(lock);
    this.transition(ctx, q, meta, () => undefined);
    return this.lockOf(ctx, id)!;
  }
  async unlock(ctx: QueueContext, id: string, _reason: string, meta: QueueWriteMeta) {
    const q = this._item(ctx, id); const l = this.locks.find((x) => x.tenantId === ctx.tenantId && x.queueItemId === id && !x.releasedAt);
    if (!q || !l) return false; l.releasedAt = new Date().toISOString(); this.transition(ctx, q, meta, () => undefined); return true;
  }
  async reorder(ctx: QueueContext, order: { queueItemId: string; expectedVersion?: number }[], meta: QueueWriteMeta) {
    const items = order.map((o) => ({ o, q: this._item(ctx, o.queueItemId) }));
    for (const { o, q } of items) { if (!q) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND'); if (o.expectedVersion != null && (q.version ?? 1) !== o.expectedVersion) throw new QueueAssignmentConflict(q.assignedTechId ?? null, q.version ?? 1); }
    return items.map(({ q }, i) => { this.transition(ctx, q!, meta, () => { q!.position = i + 1; }); return { queueItemId: q!.queueItemId, position: i + 1, version: q!.version ?? 1 }; });
  }
  async createGroup(ctx: QueueContext, req: CreateQueueGroupRequest, meta: QueueWriteMeta): Promise<QueueGroupView> {
    const items = req.queueItemIds.map((id) => this._item(ctx, id));
    if (items.some((q) => !q)) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND');
    const g = { tenantId: ctx.tenantId, groupId: 'grp_' + this.nextSeq(), label: req.label, size: items.length, together: req.together !== false, createdAt: new Date().toISOString() };
    this.groupRows.push(g);
    for (const q of items) this.transition(ctx, q!, meta, () => { q!.groupId = g.groupId; });
    return (await this.groups(ctx)).find((x) => x.groupId === g.groupId)!;
  }
  async groups(ctx: QueueContext): Promise<QueueGroupView[]> {
    return this.groupRows.filter((g) => g.tenantId === ctx.tenantId).map((g) => {
      const members = this.L(ctx).filter((q) => q.groupId === g.groupId);
      const status = members.every((m) => !isActiveQueueStatus(m.status)) ? 'done' : members.some((m) => m.status === 'in_service') ? 'in_service' : 'waiting';
      return { groupId: g.groupId, label: g.label, size: g.size, together: g.together, status, createdAt: g.createdAt,
        members: members.map((m) => ({ queueItemId: m.queueItemId, customerName: m.customerName, status: m.status, assignedTechnicianId: m.assignedTechId ?? null, assignedTechnicianName: m.assignedTechName ?? null })) };
    }).filter((g) => g.status !== 'done');
  }
  async serviceAssignments(ctx: QueueContext, id: string): Promise<QueueServiceAssignmentView[]> {
    const q = this._item(ctx, id);
    return this.serviceRows.filter((r) => r.tenantId === ctx.tenantId && r.queueItemId === id).sort((a, b) => a.sequence - b.sequence)
      .map((r) => ({ serviceId: r.serviceId, serviceName: q?.services.find((s) => s.serviceId === r.serviceId)?.serviceName ?? '', technicianId: r.technicianId, technicianName: this.techName(ctx, r.technicianId), status: r.status, sequence: r.sequence, timing: r.timing ?? 'parallel', afterServiceId: r.afterServiceId ?? null, version: r.version ?? 1 }));
  }
  async setServiceAssignments(ctx: QueueContext, id: string, rows: { serviceId: string; technicianId: string | null }[], meta: QueueWriteMeta) {
    const q = this._item(ctx, id); if (!q) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND');
    for (const r of rows) {
      const seq = q.services.findIndex((s) => s.serviceId === r.serviceId);
      const cur = this.serviceRows.find((x) => x.tenantId === ctx.tenantId && x.queueItemId === id && x.serviceId === r.serviceId);
      if (cur) { cur.technicianId = r.technicianId; cur.status = r.technicianId ? 'assigned' : 'pending'; }
      else this.serviceRows.push({ tenantId: ctx.tenantId, queueItemId: id, serviceId: r.serviceId, technicianId: r.technicianId, status: r.technicianId ? 'assigned' : 'pending', sequence: seq });
    }
    this.transition(ctx, q, meta, () => undefined);
    return this.serviceAssignments(ctx, id);
  }
  async customerIdForUser(ctx: QueueContext) { return this.L(ctx).find((q) => 'user_' + q.customerId === ctx.userId)?.customerId ?? null; }
  /** The in-memory twin of the Kysely assignPlan: check every guest + line first, then write all (CAS, idempotent). */
  async assignPlan(ctx: QueueContext, req: PlanWriteRequest) {
    const ASSIGNABLE = req.ai ? ['waiting', 'called', 'ready_for_tech'] : ['waiting', 'called', 'assigned', 'ready_for_tech'];
    if (this.historyRows.some((h) => h.tenantId === ctx.tenantId && h.idempotencyKey === `${req.keyBase}:${req.items[0]?.queueItemId}`)) throw new QueueIdempotentReplay(req.items[0].queueItemId);
    const line = (qid: string, sid: string) => this.serviceRows.find((x) => x.tenantId === ctx.tenantId && x.queueItemId === qid && x.serviceId === sid);
    for (const it of req.items) {
      const q = this._item(ctx, it.queueItemId); if (!q) throw withCode(new QueueRuleError('A guest in this plan is not in the queue.'), 'PLAN_GUEST_NOT_IN_QUEUE');
      if (req.groupId && q.groupId !== req.groupId) throw withCode(new QueueRuleError('A guest in this plan is not in that party.'), 'PARTY_GUEST_NOT_IN_PARTY');
      if (!ASSIGNABLE.includes(q.status)) {
        if (req.ai && q.status === 'assigned') throw new QueueAssignmentConflict(q.assignedTechId ?? null, q.version ?? 1, undefined, { queueItemId: q.queueItemId });
        throw withCode(new QueueRuleError(`This guest is no longer awaiting assignment (status: ${q.status}).`), 'GUEST_NOT_AWAITING_ASSIGNMENT');
      }
      if (it.expectedVersion !== (q.version ?? 1) || (it.expectedTechnicianId ?? null) !== (q.assignedTechId ?? null)) throw new QueueAssignmentConflict(q.assignedTechId ?? null, q.version ?? 1, undefined, { queueItemId: q.queueItemId });
      const onVisit = new Set(q.services.map((x) => x.serviceId)); const sent = new Set(it.lines.map((l) => l.serviceId));
      if (sent.size !== it.lines.length || sent.size !== onVisit.size || [...onVisit].some((x) => !sent.has(x))) throw withCode(new QueueRuleError('Every service of the visit needs a technician (all or none).'), 'VISIT_TECHNICIANS_ALL_OR_NONE');
      for (const l of it.lines) {
        const cur = line(it.queueItemId, l.serviceId);
        if (cur && ['in_service', 'done'].includes(cur.status)) throw withCode(new QueueRuleError('A service of this visit has already started — it cannot be re-planned.'), 'VISIT_SERVICE_STARTED');
        const curTech = cur && cur.status !== 'cancelled' ? cur.technicianId : null;
        if ((l.expectedTechnicianId ?? null) !== curTech) throw new QueueAssignmentConflict(curTech, cur?.version ?? null, undefined, { queueItemId: it.queueItemId, serviceId: l.serviceId });
      }
    }
    return req.items.map((it) => {
      const q = this._item(ctx, it.queueItemId)!; const tech = this._techs(ctx).find((t) => t.technicianId === it.leadTechnicianId);
      this.transition(ctx, q, { action: 'assign_plan', source: req.source as any, reason: req.reason, idempotencyKey: `${req.keyBase}:${it.queueItemId}` }, () => {
        q.assignedTechId = it.leadTechnicianId; q.assignedTechName = tech?.name ?? null; if (q.status === 'waiting' || q.status === 'called') q.status = 'assigned';
      });
      for (const l of it.lines) {
        const cur = line(it.queueItemId, l.serviceId); const seq = Math.max(0, q.services.findIndex((s) => s.serviceId === l.serviceId));
        if (cur) Object.assign(cur, { technicianId: l.technicianId, status: 'assigned', version: (cur.version ?? 1) + 1, timing: l.timing, afterServiceId: l.afterServiceId, sequence: seq });
        else this.serviceRows.push({ tenantId: ctx.tenantId, queueItemId: it.queueItemId, serviceId: l.serviceId, technicianId: l.technicianId, status: 'assigned', sequence: seq, version: 1, timing: l.timing, afterServiceId: l.afterServiceId });
      }
      return { queueItemId: it.queueItemId, version: q.version ?? 1, assignedTechnicianId: it.leadTechnicianId };
    });
  }
}
