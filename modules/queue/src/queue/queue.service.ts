// queue.service.ts — tenant POS Queue. Resolves tenant/role from session; enforces per-action permissions;
import { resolveCatalogLines, CatalogLineError, resolveManagerOverride, ManagerOverrideForbiddenError } from '@aipowersalon/appointments';
import { type RealtimeEmitter, type EventName, EVENTS } from '@aipowersalon/realtime-contracts';
import { skillMatch } from '@aipowersalon/workforce';
// computes wait estimates from settings; assignment checks tenant + availability + skill eligibility; moves to
// Tech Queue / Serving are idempotent; notifications are honest; cancel/remove preserve history; audits everything.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
//
// BUILD_PLAN Phase 6 (ai_queue_assignment → complete): this is the ONE queue state model the AI engine, the boards and
// the auto-run act on. Every transition is versioned, written to pos_queue_status_history + pos_queue_audit in its own
// transaction, and idempotent; assignment locks, reorder, parties and multi-technician visits live here; the engine's
// inputs (assignmentInputs / scanEntries) are complete — no 20-row page, the technician's real branch, the timing and
// fairness signals. The queue keeps NO scorer: suggestions come from QUEUE_RECOMMENDER (the AI layer).
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import {
  POSQueueFullState, QueueFilters, POSQueueItemRow, POSQueueItemDetail, CreateQueueItemRequest, UpdateQueueItemRequest,
  AssignTechnicianRequest, UnassignTechnicianRequest, ChangeRequestedTechnicianRequest, AutoBalancePreview, UpdateServicesRequest, UpdatePriorityRequest, NotifyCustomerRequest,
  CancelQueueItemRequest, RemoveQueueItemRequest, QueueRequestedService, canMoveToServing, canMoveToTechQueue,
  buildServingIdempotencyKey, buildTechQueueIdempotencyKey, QueueAssignmentLocked, QueueIdempotentReplay, QueueRuleError,
  type QueueWriteMeta, type QueueAssignSource, type LockQueueItemRequest, type UnlockQueueItemRequest, type ReorderQueueRequest, type QueueHistoryRow,
  type CreateQueueGroupRequest, type QueueGroupView, type ServiceAssignmentsRequest, type TechnicianAvailabilityRow, type QueueAssignmentInputs,
  type QueueScanEntry, type AcceptAlternateRequest, type CustomerAlternatesView, type QueueAlternatesView, type AcceptAlternateResult,
  type AssignPlanRequest, type AssignPlanResult, type PlanWriteItem, type PlanWriteLine, type QueueAssignmentServiceInput, type MoveGroupToTechQueueResult,
} from './queue.dto';
import { QueueContext, QueueRepositoryPort, type QueueActiveEntry, type TechSignalRow } from './queue.repository';
import { resolveRecommender, type QueueRecommenderSource } from './queue-recommender';
import { isActiveQueueStatus } from './queue-signals';

/** Structural push port (kept minimal so Nest-free specs can pass a plain object). */
export type QueuePushLike = { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body?: string; data?: Record<string, string>; reference?: string; category?: string }): Promise<unknown> };

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string, public readonly code?: string) { super(msg); this.name = 'ValidationError'; } }
export { QueueAssignmentConflict, QueueAssignmentLocked, QueueRuleError } from './queue.dto';
import { QueueAssignmentConflict } from './queue.dto';

const ASSIGN_SOURCES: QueueAssignSource[] = ['staff', 'ai_suggestion', 'auto_assign', 'repair'];
const AI_SOURCES: QueueAssignSource[] = ['ai_suggestion', 'auto_assign'];

export interface POSQueueAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

/** Structural port for the global identity service (one-way coupling — see CustomersService). */
export interface IdentityLinkLike {
  ensureLinked(c: { tenantId: string; customerId: string; firstName?: string | null; lastName?: string | null; fullName?: string | null; phoneRaw?: string | null; email?: string | null }, source?: 'realtime' | 'reconciliation' | 'activation' | 'import'): Promise<unknown>;
}

/** A plan's lines with their timing: the planner's (when sent) or derived — an add-on after its parent on the visit, a
 *  second line of the same technician after their previous one, other technicians side by side (D3). */
export function derivePlanLines(services: QueueRequestedService[], lines: { serviceId: string; technicianId: string; expectedTechnicianId: string | null; timing?: 'parallel' | 'after'; afterServiceId?: string | null; plannedStartOffsetMin?: number | null }[]): PlanWriteLine[] {
  const seq = (id: string) => { const i = services.findIndex((s) => s.serviceId === id); return i < 0 ? 999 : i; };
  const ordered = [...lines].sort((a, b) => seq(a.serviceId) - seq(b.serviceId));
  const lastOf = new Map<string, string>(); const out: PlanWriteLine[] = [];
  for (const l of ordered) {
    let timing = l.timing; let afterServiceId = l.afterServiceId ?? null;
    if (!timing) {
      const svc = services.find((s) => s.serviceId === l.serviceId);
      const parent = svc?.isAddon && svc.parentServiceId && lines.some((x) => x.serviceId === svc.parentServiceId) ? svc.parentServiceId : null;
      const prev = lastOf.get(l.technicianId) ?? null;
      timing = parent || prev ? 'after' : 'parallel'; afterServiceId = parent ?? prev;
    }
    lastOf.set(l.technicianId, l.serviceId);
    out.push({ serviceId: l.serviceId, technicianId: l.technicianId, expectedTechnicianId: l.expectedTechnicianId ?? null, timing, afterServiceId: timing === 'after' ? afterServiceId : null, plannedStartOffsetMin: l.plannedStartOffsetMin ?? null });
  }
  return out;
}
/** The lead: the technician of the earliest-starting line (planner offset; else a side-by-side line starts first), tie →
 *  the most minutes on the visit → the lowest sequence. pos_queue_items.assigned_technician_id = the lead. */
export function leadOfLines(services: QueueRequestedService[], lines: PlanWriteLine[]): string {
  const seq = (id: string) => { const i = services.findIndex((s) => s.serviceId === id); return i < 0 ? 999 : i; };
  const mins = new Map<string, number>();
  for (const l of lines) mins.set(l.technicianId, (mins.get(l.technicianId) ?? 0) + services.filter((s) => s.serviceId === l.serviceId).reduce((n, s) => n + (Number(s.estimatedDurationMinutes) || 0), 0));
  const start = (l: PlanWriteLine) => (l.plannedStartOffsetMin != null ? l.plannedStartOffsetMin : l.timing === 'after' ? 100000 : 0);
  return [...lines].sort((a, b) => start(a) - start(b) || (mins.get(b.technicianId)! - mins.get(a.technicianId)!) || seq(a.serviceId) - seq(b.serviceId))[0].technicianId;
}
const durationOf = (svcs: QueueRequestedService[]) => svcs.reduce((n, s) => n + (Number(s.estimatedDurationMinutes) || 0), 0);
const iso = (ms: number | null | undefined) => (ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

export class QueueService {
  /** In-process trace of this instance's actions (reads included). The durable record is pos_queue_audit (repository). */
  private trace: POSQueueAuditLog[] = [];
  constructor(
    private readonly repo: QueueRepositoryPort, private readonly realtime?: RealtimeEmitter, private readonly push?: QueuePushLike,
    private readonly identity?: IdentityLinkLike, private readonly recommender?: QueueRecommenderSource,
  ) {}

  /** §7/§8: a walk-in that creates a brand-new customers row gets its global identity resolved immediately.
   *  Best-effort — a queue add never fails because of identity linking. Only the link is written. */
  private async linkWalkIn(ctx: QueueContext, customerId: string, name?: string | null, phone?: string | null): Promise<void> {
    if (!this.identity) return;
    try { await this.identity.ensureLinked({ tenantId: ctx.tenantId, customerId, fullName: name ?? null, phoneRaw: phone ?? null }, 'realtime'); }
    catch { /* never blocks the queue */ }
  }

  private assertUser(ctx: QueueContext) {
    if (ctx?.system && ctx.tenantId) return;   // the AI auto-run's background job (in-process only — controllers never set it)
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Queue is not available for this role');
  }
  private need(ctx: QueueContext, perm: string) { this.assertUser(ctx); if (ctx.system) return; if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  /** The ONE manager-override rule (appointments/manager-override.ts) + this module's own ai_queue_assignment.override: an
   *  honoured override is audited (`manager_override_used`); one requested without either permission → 403. Never for the
   *  system / auto-run principal. */
  private override(ctx: QueueContext, requested: unknown, action: string): boolean {
    if (!requested || ctx.system) return false;
    if (hasPermission(ctx as any, 'ai_queue_assignment.override')) { this.log(ctx, 'manager_override_used', 'manager_override', undefined, undefined, undefined, { action, userId: ctx.userId, role: ctx.role, permission: 'ai_queue_assignment.override' }); return true; }
    try { return resolveManagerOverride(ctx, requested, (m) => this.log(ctx, 'manager_override_used', 'manager_override', undefined, undefined, undefined, { ...m }), action); }
    catch (e) { if (e instanceof ManagerOverrideForbiddenError) throw new ForbiddenError(e.message); throw e; }
  }
  private log(ctx: QueueContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.trace.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): POSQueueAuditLog[] { return this.trace.slice(); }
  /** Realtime fallback when the repository's outbox projection is not delivering (in-memory / publisher off). */
  private announce(ctx: QueueContext, event: EventName, payload: Record<string, unknown>) {
    if (this.repo.emitsDomainEvents?.()) return;
    try { this.realtime?.toTenant(ctx, event, payload); } catch { /* best-effort */ }
  }
  private async itemOr404(ctx: QueueContext, id: string) { const q = await this.repo.item(ctx, id); if (!q) throw new ValidationError('Queue item not found'); return q; }
  private async detailOf(ctx: QueueContext, id: string): Promise<POSQueueItemDetail> { const d = await this.repo.detail(ctx, id); if (!d) throw new ValidationError('Queue item not found'); return d; }
  /** A context whose branch is the guest's own when the caller has none (bug 14: '' must never reach a UUID column). */
  private branchCtx(ctx: QueueContext, branchId: string | null | undefined): QueueContext { return ctx.branchId ? ctx : { ...ctx, branchId: branchId || '' }; }
  private meta(action: string, auditAction: string, extra: Partial<QueueWriteMeta> = {}): QueueWriteMeta { return { action, auditAction, ...extra }; }
  // Oct 1 2026: the ONE shared rule (@aipowersalon/appointments resolveCatalogLines). The Sep 28 developer tree saved an
  // unknown id as a $0, 30-minute "Archived/Custom Service". Unknown ids are refused now, except one already on this
  // record (an archived service stays exactly as it was); a catalog service takes the catalog's name, duration and price.
  private async resolveServices(ctx: QueueContext, ids: string[], existing: QueueRequestedService[] = []): Promise<QueueRequestedService[]> {
    const catalog = (await this.repo.serviceCatalog(ctx)).map((c: any) => ({ serviceId: c.serviceId, name: c.name, durationMinutes: c.durationMinutes, priceCents: c.priceCents }));
    const kept = existing.map((e) => ({ ...e, durationMinutes: e.estimatedDurationMinutes, priceCents: e.priceCents ?? 0 }));
    try {
      return resolveCatalogLines({ catalog, ids, mayOverride: false, existing: kept as any })
        .map(({ durationMinutes, ...rest }) => ({ ...rest, estimatedDurationMinutes: durationMinutes }) as QueueRequestedService);
    } catch (e) { if (e instanceof CatalogLineError) throw new ValidationError(e.message); throw e; }
  }
  private async categoriesFor(ctx: QueueContext, services: { serviceId: string }[]): Promise<string[]> {
    const cat = await this.repo.serviceCatalog(ctx);
    return [...new Set(cat.filter((s) => services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName))];
  }
  private async rule<T>(fn: () => Promise<T>): Promise<T> { try { return await fn(); } catch (e) { if (e instanceof QueueRuleError) throw new ValidationError(e.message); throw e; } }

  // ---- read ----
  /** "Best Match" comes from the AI engine only (BUILD_PLAN Phase 6). No bound engine → no suggestion, never a guess. */
  private async fillBestMatch(ctx: QueueContext, rows: POSQueueItemRow[]): Promise<void> {
    const rec = resolveRecommender(this.recommender); if (!rec) return;
    const ids = rows.filter((r) => !r.assignedTechnicianId && (r.status === 'waiting' || r.status === 'called')).map((r) => r.queueItemId);
    if (!ids.length) return;
    try {
      const m = await rec.suggest(ctx, ids);
      for (const r of rows) {
        const s = m?.[r.queueItemId];
        if (s?.technicianId && s.name) {
          r.bestMatchTechnicianName = s.name; r.bestMatchTechnicianId = s.technicianId;
          // multi-technician routing: a Best Match that is a split names every technician (the board opens the visit plan)
          if (s.mode) { r.bestMatchMode = s.mode; r.bestMatchTechnicianNames = s.technicianNames?.length ? s.technicianNames : [s.name]; }
        }
      }
    } catch { /* the board never fails because the engine could not answer */ }
  }
  async getState(ctx: QueueContext, f: QueueFilters = {}): Promise<POSQueueFullState> {
    this.need(ctx, 'pos.queue.view'); const st = await this.repo.query(ctx, f); await this.fillBestMatch(ctx, st.queue.items);
    this.log(ctx, 'pos_queue_viewed', 'pos_queue', undefined, undefined, undefined, { filters: f }); return st;
  }
  async getKpis(ctx: QueueContext) { return (await this.getState(ctx)).kpis; }
  async items(ctx: QueueContext, f: QueueFilters = {}): Promise<{ items: POSQueueItemRow[]; pagination: any }> { this.need(ctx, 'pos.queue.view'); const q = (await this.repo.query(ctx, f)).queue; await this.fillBestMatch(ctx, q.items); return q; }
  async detail(ctx: QueueContext, id: string): Promise<POSQueueItemDetail> { this.need(ctx, 'pos.queue.view'); const d = await this.detailOf(ctx, id); this.log(ctx, 'pos_queue_item_viewed', 'pos_queue_item', id); return d; }
  async waitEstimate(ctx: QueueContext) { this.need(ctx, 'pos.queue.view'); return this.repo.waitEstimate(ctx); }
  async technicians(ctx: QueueContext) { this.need(ctx, 'pos.queue.view'); return (await this.repo.technicians(ctx)).map((t) => ({ technicianId: t.technicianId, name: t.name, available: t.available })); }

  // Read-only inputs for the AI Queue Assignment layer (contract "A → everyone"). The AI module never re-queries queue
  // tables. BUILD_PLAN Phase 6, audit bugs 1 and 4: requested / previous technician are real (they were read from
  // fields detail() never returned), every technician carries their REAL branch, the workload counts ALL active
  // entries (it saw a 20-row page), and the timing / fairness signals are read from schedules, clock-ins, breaks,
  // blocked times, appointments and the services running now. null = truly unknown (no such setting exists).
  async assignmentInputs(ctx: QueueContext, queueItemId: string): Promise<QueueAssignmentInputs> {
    this.need(ctx, 'pos.queue.view');
    const d = await this.detailOf(ctx, queueItemId);
    const bctx = this.branchCtx(ctx, d.branchId);
    const all = await this.repo.activeEntries(bctx);
    const self = all.find((e) => e.queueItemId === queueItemId) ?? null;
    // the guest's own assignment is not "load" when the engine considers re-routing them
    const signals = await this.repo.techSignals(bctx, all.filter((e) => e.queueItemId !== queueItemId));
    const requiredCategories = await this.categoriesFor(ctx, d.requestedServices);
    const prev = d.previousTechnicianId ?? null;
    return {
      entry: {
        queueItemId, branchId: d.branchId ?? (ctx.branchId || null), version: d.version ?? 1, requiredCategories, serviceDurationMinutes: durationOf(d.requestedServices),
        requestedTechnicianId: d.requestedTechnicianId ?? null, previousTechnicianId: prev, isVip: !!d.isVip || d.priority === 'vip',
        isAppointment: d.source === 'appointment' || !!d.appointmentId, appointmentStartAt: d.appointmentStartAt ?? null, lateMinutes: d.lateMinutes ?? null,
        groupId: d.groupId ?? null, groupSize: self?.groupSize ?? null, lock: d.lock ? { technicianId: d.lock.technicianId, reason: d.lock.reason } : null,
        serviceIds: d.requestedServices.map((s) => s.serviceId),
        services: await this.serviceInputs(ctx, d), customerName: d.customerName,
      },
      candidates: signals.map((t) => this.candidate(t, prev)),
    };
  }
  /** Multi-technician routing: every line of the visit for the engine (one line per service — D8: a service twice on a
   *  visit is ONE line, its minutes summed), with its category, the technician on it now and its status. */
  private async serviceInputs(ctx: QueueContext, d: POSQueueItemDetail): Promise<QueueAssignmentServiceInput[]> {
    const cat = await this.repo.serviceCatalog(ctx);
    const lines = d.serviceAssignments ?? [];
    const out: QueueAssignmentServiceInput[] = [];
    d.requestedServices.forEach((s, i) => {
      const cur = out.find((x) => x.serviceId === s.serviceId);
      if (cur) { cur.durationMinutes += Number(s.estimatedDurationMinutes) || 0; return; }
      const line = lines.find((l) => l.serviceId === s.serviceId && l.status !== 'cancelled');
      out.push({ serviceId: s.serviceId, serviceName: s.serviceName, category: cat.find((c) => c.serviceId === s.serviceId)?.categoryName ?? null,
        durationMinutes: Number(s.estimatedDurationMinutes) || 0, sequence: i, isAddon: !!s.isAddon, parentServiceId: s.parentServiceId ?? null,
        assignedTechnicianId: line?.technicianId ?? null, status: line?.status ?? 'pending' });
    });
    return out;
  }
  private candidate(t: TechSignalRow, prev: string | null) {
    return {
      technicianId: t.technicianId, name: t.name, branchId: t.branchId, available: t.available, skills: t.skills, activeAssignments: t.activeAssignments,
      isPrevious: !!prev && t.technicianId === prev, rotationIndex: t.rotationIndex, lastServedAt: t.lastServedAt, assignedMinutes: t.assignedMinutes,
      availableInMinutes: t.signals.availableInMinutes, shiftEndsInMinutes: t.signals.shiftEndsInMinutes, onBreak: t.signals.onBreak, blocked: t.signals.blocked,
      ...(t.signals.clockedIn != null ? { clockedIn: t.signals.clockedIn } : {}),   // merge Oct 12 2026: the REAL clock, when the salon uses it
      maxConcurrent: null as number | null,   // no per-technician capacity setting exists yet — the engine applies its own default
      nextAppointmentInMinutes: t.signals.nextAppointmentInMinutes,
    };
  }

  // Read-only queue snapshot for AI detection (wait / unassigned / stuck / late / long service). ALL active entries, in
  // service included, with the REAL updated_at (audit bugs 3 and 4) and the real status vocabulary.
  async scanEntries(ctx: QueueContext): Promise<QueueScanEntry[]> {
    this.need(ctx, 'pos.queue.view');
    return (await this.repo.activeEntries(ctx)).map((e) => this.scanEntry(e, Date.now()));
  }
  private scanEntry(e: QueueActiveEntry, now: number): QueueScanEntry {
    return {
      queueEntryId: e.queueItemId, version: e.version, waitMinutes: Math.max(0, Math.floor((now - e.checkedInAtMs) / 60000)), status: e.status,
      assignedTechnicianId: e.assignedTechId, requestedTechnicianId: e.requestedTechId, isAppointment: e.source === 'appointment' || !!e.appointmentId,
      appointmentStartAt: iso(e.appointmentStartMs), lateMinutes: e.lateMinutes, isVip: e.isVip, groupId: e.groupId, serviceIds: e.services.map((s) => s.serviceId),
      startedAt: iso(e.startedAtMs), expectedDurationMinutes: durationOf(e.services), updatedAt: e.updatedAt, lock: e.lock,
    };
  }

  /** GET pos/queue/technicians/availability — who can take the next guest, and when. */
  async technicianAvailability(ctx: QueueContext): Promise<TechnicianAvailabilityRow[]> {
    this.need(ctx, 'pos.queue.view');
    const rows = await this.repo.techSignals(ctx);
    return rows.map((t) => ({
      technicianId: t.technicianId, name: t.name, status: t.signals.status, availableInMinutes: t.signals.availableInMinutes, shiftEndsInMinutes: t.signals.shiftEndsInMinutes,
      activeAssignments: t.activeAssignments, onBreak: t.signals.onBreak, nextAppointmentInMinutes: t.signals.nextAppointmentInMinutes,
    }));
  }

  // ---- create / update ----
  async create(ctx: QueueContext, body: CreateQueueItemRequest): Promise<POSQueueItemRow> {
    this.need(ctx, 'pos.queue.create');
    if (!body?.customerName?.trim()) throw new ValidationError('A customer name is required');
    const services = body.serviceIds?.length ? await this.resolveServices(ctx, body.serviceIds) : [];
    const createdWalkIn = !body.customerId;
    const customerId = body.customerId || await this.repo.createWalkInCustomer(ctx, body.customerName, body.customerPhone);
    if (createdWalkIn) await this.linkWalkIn(ctx, customerId, body.customerName, body.customerPhone);
    const row = await this.repo.create(ctx, {
      queueItemId: 'q_' + this.repo.nextSeq(), customerId, customerName: body.customerName, customerPhone: body.customerPhone, isVip: body.priority === 'vip',
      source: body.source || 'manual', appointmentId: body.appointmentId ?? null, ticketId: null, services, priority: body.priority || 'normal', status: 'waiting',
      assignedTechId: null, assignedTechName: null, requestedTechId: body.requestedTechnicianId ?? null, station: undefined, checkedInAtMs: Date.now(), calledAtMs: null, startedAtMs: null, notes: body.notes || '', customerNotifiedAt: null, createdAtMs: Date.now(), updatedAt: new Date().toISOString(),
    });
    this.log(ctx, 'pos_queue_item_created', 'pos_queue_item', row.queueItemId, undefined, row as any);
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: row.queueItemId });   // Constitution 8: projected from queue.* when the repo emits events
    return row;
  }
  async update(ctx: QueueContext, id: string, body: UpdateQueueItemRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.edit'); await this.itemOr404(ctx, id);
    await this.repo.update(ctx, id, { customerName: body.customerName, customerPhone: body.customerPhone, notes: body.notes, station: body.station });
    await this.repo.audit(ctx, id, this.meta('details', 'pos_queue_item_updated', { metadata: { fields: Object.keys(body || {}).filter((k) => (body as any)[k] !== undefined) } }));
    this.log(ctx, 'pos_queue_item_updated', 'pos_queue_item', id);
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });   // §343: the repository recorded the fact; the projection delivers it when the publisher is on
    return this.detailOf(ctx, id);
  }

  // ---- call next ----
  async callNext(ctx: QueueContext, id: string, notify = false): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.call_next'); await this.itemOr404(ctx, id);
    await this.repo.markCalled(ctx, id, this.meta('call', 'pos_queue_called_next')); this.log(ctx, 'pos_queue_called_next', 'pos_queue_item', id);
    if (notify) { try { await this.notifyCustomer(ctx, id, { channel: 'sms' }); } catch { /* honest: surfaced separately */ } }
    // Check-in-ready push to the customer's own device (walk-ins without an account have no user → no push).
    // Best-effort: never fails the call action. dispatchToUser itself never throws.
    if (this.push) {
      try {
        const uid = await this.repo.customerUserId(ctx, id);
        if (uid) await this.push.dispatchToUser(ctx.tenantId, uid, { title: "You're up!", body: 'Please come to the front desk — we are ready for you.', data: { kind: 'checkin_ready', queueItemId: id }, reference: 'checkin_ready', category: 'CHECK_IN_READY' });
      } catch { /* best-effort */ }
    }
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return this.detailOf(ctx, id);
  }

  // ---- Auto Balance: the AI engine's proposals, applied only on confirmation ----
  async previewAutoBalance(ctx: QueueContext): Promise<AutoBalancePreview> {
    this.need(ctx, 'pos.queue.assign_technician');
    const entries = await this.repo.activeEntries(ctx);
    const waiting = entries.filter((e) => !e.assignedTechId && (e.status === 'waiting' || e.status === 'called'));
    const empty = (reason: string): AutoBalancePreview => ({ proposals: [], unassignable: [], summary: { proposed: 0, guestsConsidered: waiting.length, totalWaitAddressedMinutes: 0 }, available: false, unavailableReason: reason });
    const rec = resolveRecommender(this.recommender);
    if (!rec) return empty('AI queue assignment is not available for this salon, so Auto Balance has no suggestions.');
    let r;
    try { r = await rec.balance(ctx); } catch (e: any) { return empty(e?.message ? String(e.message) : 'The assignment engine could not answer right now.'); }
    const byId = new Map(entries.map((e) => [e.queueItemId, e])); const now = Date.now();
    const waitOf = (e?: QueueActiveEntry) => (e ? Math.max(0, Math.floor((now - e.checkedInAtMs) / 60000)) : 0);
    const proposals = (r.proposals || []).filter((p) => byId.has(p.queueItemId)).map((p) => {
      const e = byId.get(p.queueItemId)!;
      // bug 5: the apply must never overwrite — it carries what the preview saw (unassigned, this version)
      return { queueItemId: p.queueItemId, customerName: e.customerName, technicianId: p.technicianId, technicianName: p.technicianName, reason: (p.reasons || []).join(', '),
        addressesWaitMinutes: waitOf(e), confidence: p.confidence, expectedTechnicianId: e.assignedTechId ?? null, expectedVersion: e.version };
    });
    const unassignable = (r.unassignable || []).map((u) => ({ queueItemId: u.queueItemId, customerName: byId.get(u.queueItemId)?.customerName ?? '', reason: u.reason }));
    return { proposals, unassignable, summary: { proposed: proposals.length, guestsConsidered: proposals.length + unassignable.length, totalWaitAddressedMinutes: proposals.reduce((a, p) => a + p.addressesWaitMinutes, 0) }, available: true };
  }

  // Auto Balance (apply) — apply ONLY the confirmed proposals, one assignment each, never silently, NEVER over an
  // existing assignment (audit bug 5: it passed no expectedTechnicianId, so a guest assigned meanwhile was overwritten).
  async applyAutoBalance(ctx: QueueContext, body: { proposals: { queueItemId: string; technicianId: string; expectedTechnicianId?: string | null; expectedVersion?: number }[] }): Promise<{ applied: number; failures: { queueItemId: string; reason: string }[] }> {
    this.need(ctx, 'pos.queue.assign_technician');
    const proposals = Array.isArray(body?.proposals) ? body.proposals : [];
    if (!proposals.length) throw new ValidationError('No proposals to apply');
    let applied = 0; const failures: { queueItemId: string; reason: string }[] = [];
    for (const p of proposals) {
      try {
        await this.assignTechnician(ctx, p.queueItemId, { technicianId: p.technicianId, expectedTechnicianId: p.expectedTechnicianId ?? null, expectedVersion: p.expectedVersion, source: 'ai_suggestion', reason: 'Auto Balance' });
        applied++;
      } catch (e: any) { failures.push({ queueItemId: p.queueItemId, reason: e?.message || 'assignment failed' }); }
    }
    this.log(ctx, 'pos_queue_auto_balance_applied', 'pos_queue', undefined, undefined, undefined, { requested: proposals.length, applied, failures: failures.length });
    return { applied, failures };
  }

  // ---- technician assignment (eligibility, versioned, audited, idempotent, lock-aware) ----
  async assignTechnician(ctx: QueueContext, id: string, body: AssignTechnicianRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.assign_technician');
    if (!body?.technicianId) throw new ValidationError('A technician is required');
    const source: QueueAssignSource = body.source ?? 'staff';
    if (!ASSIGN_SOURCES.includes(source)) throw new ValidationError('Unknown assignment source');
    const ai = AI_SOURCES.includes(source);
    // Same idempotency key → same result, no second write (a retried accept / auto-run).
    if (body.idempotencyKey) {
      const prior = await this.repo.idempotentAssignment(ctx, body.idempotencyKey);
      if (prior) {
        if (prior.queueItemId !== id) throw new ValidationError('This idempotency key was already used for another guest.');
        return this.detailOf(ctx, id);
      }
    }
    const q = await this.itemOr404(ctx, id);
    const currentTech = q.assignedTechId ?? null; const currentVersion = q.version ?? 1;
    // Concurrency/stale-action guard (§40): only items still awaiting a technician may be (re)assigned. If the visit has
    // already started service, moved to the tech queue, or been cancelled/removed since this action was queued, reject
    // rather than silently overwrite. BUILD_PLAN Phase 6, audit bug 5: the AI (suggestion accept, Auto Balance, auto-run)
    // assigns only waiting / called guests (ready_for_tech for re-routing) — never one staff already assigned.
    const ASSIGNABLE = ai ? ['waiting', 'called', 'ready_for_tech'] : ['waiting', 'called', 'assigned', 'ready_for_tech'];
    if (!ASSIGNABLE.includes(q.status)) {
      if (ai && q.status === 'assigned') throw new QueueAssignmentConflict(currentTech, currentVersion, 'This guest already has a technician, so the suggestion was not applied.');
      throw new ValidationError(`This guest is no longer awaiting assignment (status: ${q.status}).`);
    }
    if (ai && body.expectedTechnicianId === undefined) throw new ValidationError('An AI assignment must say which technician it expects the guest to have (expectedTechnicianId).');
    // Spec §77: a stale board (it showed a different assignee / an older version) is refused up front; the repository's
    // compare-and-set on status + assignee + version closes the concurrent window.
    if (body.expectedTechnicianId !== undefined && (body.expectedTechnicianId ?? null) !== currentTech) throw new QueueAssignmentConflict(currentTech, currentVersion);
    if (body.expectedVersion != null && body.expectedVersion !== currentVersion) throw new QueueAssignmentConflict(currentTech, currentVersion);
    if (currentTech === body.technicianId && q.status === 'assigned') return this.detailOf(ctx, id);   // already theirs (a double click) — nothing to write
    // A manager's lock pins the guest (to a technician, or to "nobody yet"). Only a manager override with
    // ai_queue_assignment.override moves a locked guest; the auto-run never does.
    const lock = await this.repo.activeLock(ctx, id);
    const lockOverridden = !!lock && lock.technicianId !== body.technicianId;
    if (lockOverridden && !(source !== 'auto_assign' && !ctx.system && body.managerOverride && hasPermission(ctx as any, 'ai_queue_assignment.override'))) throw new QueueAssignmentLocked(lock!);
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId);
    if (!tech) throw new ValidationError('Technician not found in this tenant');
    // Merge Oct 12 2026 (R1): the availability / category-skill override is a permission-gated, audited act — a session
    // without pos.booking.override_conflict (or this module's own ai_queue_assignment.override) asking for it is refused.
    // The ai_queue_assignment.override lock rule above is unchanged. (The exact-service / certification eligibility engine
    // is the Technician Profile build; until it lands the category-level skill check keeps its authorised override.)
    const override = this.override(ctx, body.managerOverride, 'queue.assign_technician');
    if (!tech.available && !override) throw new ValidationError('Technician is not available — manager override required');
    const eligible = skillMatch(tech.skills, await this.categoriesFor(ctx, q.services));
    if (!eligible && !override) throw new ValidationError('Technician is not skilled for the requested services — manager override required');
    // Fair Turn Engine §68–70: the engine's pick travels with the assignment (the AI paths hand it over; a staff click asks
    // the engine). Choosing someone else under RECOMMEND_AND_CONFIRM / AUTOMATIC needs a reason; MANUAL mode never does.
    let turn = body.turn ?? null;
    if (!turn && source === 'staff') {
      const rec = resolveRecommender(this.recommender);
      let advice: Awaited<ReturnType<NonNullable<NonNullable<typeof rec>['turnDecision']>>> | null = null;
      try { advice = (await rec?.turnDecision?.(ctx as any, id, body.technicianId)) ?? null; } catch { advice = null; }   // the engine is advice; the assignment never fails because it could not answer
      if (advice) {
        if (advice.reasonRequired && !body.overrideReasonCode && !body.reason?.trim()) throw new ValidationError('Choose a reason for assigning someone other than the recommended technician.', 'MANUAL_OVERRIDE_REASON_REQUIRED');
        turn = { recommendedTechnicianId: advice.recommendedTechnicianId, overrideReasonCode: body.overrideReasonCode ?? null, skips: advice.skips, eligiblePool: advice.eligiblePool };
      }
    }
    if (turn && body.overrideReasonCode && !turn.overrideReasonCode) turn = { ...turn, overrideReasonCode: body.overrideReasonCode };
    const meta = this.meta(source === 'auto_assign' ? 'auto_assign' : 'assign', 'pos_queue_technician_assigned', {
      source, reason: body.reason ?? (lockOverridden ? 'manager override of an assignment lock' : null), idempotencyKey: body.idempotencyKey ?? null,
      metadata: { technicianId: body.technicianId, override: !!body.managerOverride, lockOverridden, ...(body.overrideReasonCode ? { overrideReasonCode: body.overrideReasonCode } : {}) },
      turn,
    });
    let assigned: boolean;
    try { assigned = await this.repo.assign(ctx, id, body.technicianId, { status: q.status, technicianId: currentTech, version: body.expectedVersion }, meta); }
    catch (e) {
      if (e instanceof QueueIdempotentReplay) return this.detailOf(ctx, id);
      // a concurrent retry of the SAME decision lost the compare-and-set to its twin: that is a replay, not a conflict
      if (e instanceof QueueAssignmentConflict && body.idempotencyKey && (await this.repo.idempotentAssignment(ctx, body.idempotencyKey))?.queueItemId === id) return this.detailOf(ctx, id);
      throw e;
    }
    if (!assigned) throw new ValidationError('Queue item not found');
    this.log(ctx, 'pos_queue_technician_assigned', 'pos_queue_assignment', id, undefined, undefined, { technicianId: body.technicianId, override: !!body.managerOverride, source });
    // Constitution 8 (Phases 12–14): the repository wrote queue.customer_assigned INSIDE the assignment
    // transaction. The realtime refresh and the technician's push are CONSUMERS of that event — durable,
    // retried, idempotent. When the repo has no outbox (in-memory / DB-less), the direct calls remain the fallback.
    if (!this.repo.emitsDomainEvents?.()) {
      this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
      if (this.push) {
        try {
          const uid = await this.repo.technicianUserId(ctx, body.technicianId);
          if (uid) await this.push.dispatchToUser(ctx.tenantId, uid, { title: 'New assignment', body: 'A guest is waiting for you', data: { kind: 'queue_assignment', queueItemId: id }, reference: 'queue_assignment', category: 'QUEUE_ASSIGNMENT' } /* §61 (Phase 13 D): never the customer's name on a lock screen */);
        } catch { /* best-effort */ }
      }
    }
    return this.detailOf(ctx, id);
  }
  // §32 — change the guest's requested technician (specific) or clear it to Any Available. The previous preference
  // is kept on the history row so the original customer request is never silently lost.
  async changeRequestedTechnician(ctx: QueueContext, id: string, body: ChangeRequestedTechnicianRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.assign_technician'); const q = await this.itemOr404(ctx, id);
    const previousTechnicianId = (q as any).requestedTechId ?? null;
    if (body.technicianId) {
      const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId);
      if (!tech) throw new ValidationError('Technician not found in this tenant');
    }
    const ok = await this.repo.setRequestedTechnician(ctx, id, body.technicianId ?? null,
      this.meta('change_requested_technician', 'pos_queue_requested_technician_changed', { reason: body.reason ?? null, metadata: { previousTechnicianId, technicianId: body.technicianId ?? null } }));
    if (!ok) throw new ValidationError('Could not change the requested technician');
    this.log(ctx, 'pos_queue_requested_technician_changed', 'pos_queue_item', id, undefined, undefined, { previousTechnicianId, technicianId: body.technicianId ?? null, anyAvailable: !body.technicianId, reason: body.reason });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return this.detailOf(ctx, id);
  }
  async unassignTechnician(ctx: QueueContext, id: string, body: UnassignTechnicianRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.assign_technician'); const q = await this.itemOr404(ctx, id);
    if (q.assignedTechId && !body?.reason?.trim()) throw new ValidationError('A reason is required to unassign an assigned technician');
    const source = body?.source ?? 'staff';
    if (!ASSIGN_SOURCES.includes(source)) throw new ValidationError('Unknown assignment source');
    // round 2 (the ops repair path): the same stale-board / version rules as assign — a repair never clears an
    // assignment someone changed after the alert was raised
    const currentTech = q.assignedTechId ?? null; const currentVersion = q.version ?? 1;
    if (body?.expectedTechnicianId !== undefined && (body.expectedTechnicianId ?? null) !== currentTech) throw new QueueAssignmentConflict(currentTech, currentVersion);
    if (body?.expectedVersion != null && body.expectedVersion !== currentVersion) throw new QueueAssignmentConflict(currentTech, currentVersion);
    const expect = body?.expectedTechnicianId !== undefined || body?.expectedVersion != null ? { status: q.status, technicianId: currentTech, version: body?.expectedVersion } : undefined;
    await this.repo.unassign(ctx, id, this.meta('unassign', 'pos_queue_technician_unassigned', { source, reason: body?.reason ?? null }), expect);
    this.log(ctx, 'pos_queue_technician_unassigned', 'pos_queue_assignment', id, undefined, undefined, { reason: body?.reason, source });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return this.detailOf(ctx, id);
  }

  // ---- services / priority ----
  async updateServices(ctx: QueueContext, id: string, body: UpdateServicesRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.edit'); await this.itemOr404(ctx, id);
    if (!body?.serviceIds?.length) throw new ValidationError('At least one service is required');
    await this.repo.setServices(ctx, id, await this.resolveServices(ctx, body.serviceIds, (await this.repo.item(ctx, id))?.services ?? []), this.meta('services', 'pos_queue_services_updated', { metadata: { serviceIds: body.serviceIds } }));
    this.log(ctx, 'pos_queue_services_updated', 'pos_queue_services', id, undefined, undefined, { serviceIds: body.serviceIds });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return this.detailOf(ctx, id);
  }
  async updatePriority(ctx: QueueContext, id: string, body: UpdatePriorityRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.update_priority'); await this.itemOr404(ctx, id);
    if (!body?.priority) throw new ValidationError('A priority is required');
    await this.repo.setPriority(ctx, id, body.priority, this.meta('priority', 'pos_queue_priority_updated', { reason: body.reason ?? null, metadata: { priority: body.priority } }));
    this.log(ctx, 'pos_queue_priority_updated', 'pos_queue_priority', id, undefined, undefined, { priority: body.priority, reason: body.reason });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return this.detailOf(ctx, id);
  }

  // ---- customer notification (honest) ----
  async notifyCustomer(ctx: QueueContext, id: string, body: NotifyCustomerRequest): Promise<{ channel: string; configured: boolean; disabledReason?: string }> {
    this.need(ctx, 'pos.queue.edit'); const q = await this.itemOr404(ctx, id); const channel = body?.channel || 'front_desk';
    if (channel === 'sms') { if (!q.customerPhone) throw new ValidationError('A valid phone is required for an SMS notification'); this.log(ctx, 'pos_queue_customer_notified', 'pos_customer_notification', id, undefined, undefined, { channel, status: 'not_configured' }); return { channel, configured: false, disabledReason: 'Customer notification is not configured yet.' }; }
    if (channel === 'app') { if (!q.customerId) throw new ValidationError('A customer app profile is required for an app notification'); }
    await this.repo.markNotified(ctx, id); this.log(ctx, 'pos_queue_customer_notified', 'pos_customer_notification', id, undefined, undefined, { channel }); return { channel, configured: true };
  }

  // ---- move to tech queue (idempotent) ----
  async moveToTechQueue(ctx: QueueContext, id: string): Promise<{ moved: boolean; duplicate: boolean; techQueueItemId: string; techQueueTicketId?: string; techQueueTicketIds?: string[]; idempotencyKey: string }> {
    this.need(ctx, 'pos.queue.move_to_tech_queue'); const q = await this.itemOr404(ctx, id); const key = buildTechQueueIdempotencyKey(id);
    if ((await this.repo.getTechQueueKey(ctx, id)) === key && q.status === 'moved_to_tech_queue') { const ex = await this.repo.projectToTechQueue(ctx, id); this.log(ctx, 'pos_queue_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, techQueueItemId: id, techQueueTicketId: ex.techQueueTicketId, ...(ex.techQueueTicketIds ? { techQueueTicketIds: ex.techQueueTicketIds } : {}), idempotencyKey: key }; }
    const gate = canMoveToTechQueue(q.status, !!q.assignedTechId); if (!gate.ok) throw new ValidationError('Cannot move to Tech Queue: ' + gate.reason);
    await this.repo.setStatus(ctx, id, 'moved_to_tech_queue', this.meta('move_to_tech_queue', 'pos_queue_moved_to_tech_queue')); await this.repo.setTechQueueKey(ctx, id, key);
    const projected = await this.repo.projectToTechQueue(ctx, id);
    this.log(ctx, 'pos_queue_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key, techQueueTicketId: projected.techQueueTicketId });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id, techQueueTicketId: projected.techQueueTicketId });
    return { moved: true, duplicate: false, techQueueItemId: id, techQueueTicketId: projected.techQueueTicketId, ...(projected.techQueueTicketIds ? { techQueueTicketIds: projected.techQueueTicketIds } : {}), idempotencyKey: key };
  }

  /** "Start party": each member's own idempotent move to the Tech Queue (a split member becomes its parts). */
  async moveGroupToTechQueue(ctx: QueueContext, groupId: string): Promise<MoveGroupToTechQueueResult> {
    this.need(ctx, 'pos.queue.move_to_tech_queue');
    const g = (await this.repo.groups(ctx)).find((x) => x.groupId === groupId);
    if (!g) throw new ValidationError('That party is not in the queue.');
    const moved: MoveGroupToTechQueueResult['moved'] = [];
    for (const m of g.members) {
      if (!['assigned', 'ready_for_tech', 'moved_to_tech_queue', 'called', 'waiting'].includes(m.status)) continue;
      const r = await this.moveToTechQueue(ctx, m.queueItemId);
      moved.push({ queueItemId: m.queueItemId, techQueueTicketIds: (r as any).techQueueTicketIds ?? (r.techQueueTicketId ? [r.techQueueTicketId] : []), duplicate: r.duplicate });
    }
    return { moved };
  }

  // ---- start service / move to serving (idempotent) ----
  async moveToServing(ctx: QueueContext, id: string): Promise<{ moved: boolean; duplicate: boolean; servingTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.queue.move_to_serving'); this.need(ctx, 'pos.serving.view'); const q = await this.itemOr404(ctx, id);
    const settings = await this.repo.settings(ctx); const key = buildServingIdempotencyKey(id);
    if ((await this.repo.getServingKey(ctx, id)) === key && q.status === 'in_service') { this.log(ctx, 'pos_queue_moved_to_serving', 'pos_serving_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, servingTicketId: q.ticketId || id, idempotencyKey: key }; }
    const gate = canMoveToServing({ status: q.status, hasTechnician: !!q.assignedTechId, serviceCount: q.services.length, allowWithoutTech: settings.allowMoveToServingWithoutTech });
    if (!gate.ok) throw new ValidationError('Cannot start service: ' + gate.reason);
    await this.repo.setStatus(ctx, id, 'in_service', this.meta('start_service', 'pos_queue_started_service')); const servingTicketId = await this.repo.createTicketFromQueueItem(ctx, q); await this.repo.setServingKey(ctx, id, key);
    this.log(ctx, 'pos_queue_started_service', 'pos_serving_transfer', id, undefined, undefined, { idempotencyKey: key });
    this.log(ctx, 'pos_queue_moved_to_serving', 'pos_serving_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key, servingTicketId });
    this.announce(ctx, EVENTS.serviceStarted, { ticketId: servingTicketId });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return { moved: true, duplicate: false, servingTicketId, idempotencyKey: key };
  }

  // ---- cancel / remove ----
  async cancel(ctx: QueueContext, id: string, body: CancelQueueItemRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.cancel'); await this.itemOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('Cancelling requires a reason');
    await this.repo.setStatus(ctx, id, 'cancelled', this.meta('cancel', 'pos_queue_cancelled', { reason: body.reason })); this.log(ctx, 'pos_queue_cancelled', 'pos_queue_item', id, undefined, undefined, { reason: body.reason });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return this.detailOf(ctx, id);
  }
  async remove(ctx: QueueContext, id: string, body: RemoveQueueItemRequest): Promise<{ removed: boolean }> {
    this.need(ctx, 'pos.queue.remove'); await this.itemOr404(ctx, id);
    await this.repo.setStatus(ctx, id, 'removed', this.meta('remove', 'pos_queue_removed', { reason: body?.reason ?? null })); this.log(ctx, 'pos_queue_removed', 'pos_queue_item', id, undefined, undefined, { reason: body?.reason });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return { removed: true };
  }

  // ==== BUILD_PLAN Phase 6 — history, locks, reorder, parties, multi-technician visits ====
  async history(ctx: QueueContext, id: string): Promise<{ queueItemId: string; history: QueueHistoryRow[] }> {
    this.need(ctx, 'pos.queue.view'); await this.itemOr404(ctx, id);
    return { queueItemId: id, history: await this.repo.history(ctx, id) };
  }

  /** Pin a guest to a technician (or to "nobody yet"). The engine, the boards and the auto-run all respect it. */
  async lock(ctx: QueueContext, id: string, body: LockQueueItemRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.assign_technician'); this.need(ctx, 'ai_queue_assignment.override');
    if (!body?.reason?.trim()) throw new ValidationError('A reason is required to lock a guest.');
    if (body.expiresInMinutes != null && !(Number.isFinite(body.expiresInMinutes) && body.expiresInMinutes >= 1 && body.expiresInMinutes <= 1440)) throw new ValidationError('A lock can last 1 to 1440 minutes.');
    const q = await this.itemOr404(ctx, id);
    if (!isActiveQueueStatus(q.status)) throw new ValidationError('This guest is no longer in the queue.');
    if (body.technicianId && !(await this.repo.technicians(ctx)).some((t) => t.technicianId === body.technicianId)) throw new ValidationError('Technician not found in this tenant');
    const reason = body.reason.trim();
    const lock = await this.rule(() => this.repo.lock(this.branchCtx(ctx, q.branchId), id, { technicianId: body.technicianId ?? null, reason, expiresInMinutes: body.expiresInMinutes },
      this.meta('lock', 'pos_queue_assignment_locked', { reason, metadata: { technicianId: body.technicianId ?? null } })));
    this.log(ctx, 'pos_queue_assignment_locked', 'pos_queue_item', id, undefined, undefined, { technicianId: lock.technicianId, reason });
    this.announce(ctx, EVENTS.queueAssignmentLocked, { queueItemId: id, technicianId: lock.technicianId });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return this.detailOf(ctx, id);
  }
  async unlock(ctx: QueueContext, id: string, body: UnlockQueueItemRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.assign_technician'); this.need(ctx, 'ai_queue_assignment.override');
    if (!body?.reason?.trim()) throw new ValidationError('A reason is required to unlock a guest.');
    await this.itemOr404(ctx, id);
    const ok = await this.rule(() => this.repo.unlock(ctx, id, body.reason.trim(), this.meta('unlock', 'pos_queue_assignment_unlocked', { reason: body.reason.trim() })));
    if (!ok) throw new ValidationError('This guest is not locked.');
    this.log(ctx, 'pos_queue_assignment_unlocked', 'pos_queue_item', id, undefined, undefined, { reason: body.reason });
    this.announce(ctx, EVENTS.queueAssignmentUnlocked, { queueItemId: id });
    this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return this.detailOf(ctx, id);
  }

  /** Drag-to-reorder: positions 1..n, all or nothing; a guest that changed meanwhile (expectedVersion) → 409. */
  async reorder(ctx: QueueContext, body: ReorderQueueRequest): Promise<{ order: { queueItemId: string; position: number; version: number }[] }> {
    this.need(ctx, 'pos.queue.update_priority');
    const order = Array.isArray(body?.order) ? body.order : [];
    if (!order.length) throw new ValidationError('Send the new order of the queue.');
    if (order.length > 200) throw new ValidationError('A queue order can hold at most 200 guests.');
    if (new Set(order.map((o) => o?.queueItemId)).size !== order.length || order.some((o) => !o?.queueItemId)) throw new ValidationError('Each guest may appear once in the new order.');
    const out = await this.rule(() => this.repo.reorder(ctx, order.map((o) => ({ queueItemId: String(o.queueItemId), expectedVersion: o.expectedVersion != null ? Number(o.expectedVersion) : undefined })),
      this.meta('reorder', 'pos_queue_reordered')));
    this.log(ctx, 'pos_queue_reordered', 'pos_queue', undefined, undefined, undefined, { count: out.length });
    this.announce(ctx, EVENTS.queueReordered, { order: out.map((o) => o.queueItemId) });
    return { order: out };
  }

  /** A party (2–20 guests) checked in together, assigned side by side. */
  async createGroup(ctx: QueueContext, body: CreateQueueGroupRequest): Promise<QueueGroupView> {
    this.need(ctx, 'pos.queue.edit');
    const label = String(body?.label ?? '').trim();
    if (!label) throw new ValidationError('A party needs a name.');
    if (label.length > 60) throw new ValidationError('A party name can be at most 60 characters.');
    const ids = Array.isArray(body?.queueItemIds) ? [...new Set(body.queueItemIds.map(String))] : [];
    if (ids.length < 2 || ids.length > 20) throw new ValidationError('A party has 2 to 20 guests.');
    const g = await this.rule(() => this.repo.createGroup(ctx, { label, queueItemIds: ids, together: body.together !== false }, this.meta('group', 'pos_queue_group_created', { metadata: { size: ids.length } })));
    this.log(ctx, 'pos_queue_group_created', 'pos_queue_group', g.groupId, undefined, undefined, { size: ids.length });
    this.announce(ctx, EVENTS.queueGroupCreated, { groupId: g.groupId, queueItemIds: ids });
    for (const id of ids) this.announce(ctx, EVENTS.queueUpdated, { queueItemId: id });
    return g;
  }
  async groups(ctx: QueueContext): Promise<QueueGroupView[]> { this.need(ctx, 'pos.queue.view'); return this.repo.groups(ctx); }

  /** A multi-technician visit (old clients): each requested service on its own technician. Kept for compatibility —
   *  it DELEGATES to assignPlan (staff source, expectations = what the queue shows now) so there is ONE writer. Services
   *  not sent keep their current technician (or the lead); a null technician is not a plan line (all or none). */
  async setServiceAssignments(ctx: QueueContext, id: string, body: ServiceAssignmentsRequest): Promise<POSQueueItemDetail> {
    this.need(ctx, 'pos.queue.assign_technician');
    const rows = Array.isArray(body?.assignments) ? body.assignments : [];
    if (!rows.length) throw new ValidationError('Choose a technician for at least one service.');
    if (new Set(rows.map((r) => r?.serviceId)).size !== rows.length) throw new ValidationError('Each service may appear once.');
    const d = await this.detailOf(ctx, id);
    if (!isActiveQueueStatus(d.status)) throw new ValidationError('This guest is no longer in the queue.');
    for (const r of rows) if (!d.requestedServices.some((s) => s.serviceId === r?.serviceId)) throw new ValidationError('That service is not on this visit.');
    const current = new Map((d.serviceAssignments ?? []).filter((a) => a.status !== 'cancelled').map((a) => [a.serviceId, a.technicianId ?? null]));
    const ids = [...new Set(d.requestedServices.map((s) => s.serviceId))];
    const lines = ids.map((serviceId) => {
      const sent = rows.find((r) => r.serviceId === serviceId);
      const technicianId = (sent ? sent.technicianId : null) ?? current.get(serviceId) ?? d.assignedTechnicianId ?? null;
      return { serviceId, technicianId, expectedTechnicianId: current.get(serviceId) ?? null };
    });
    if (lines.some((l) => !l.technicianId)) throw new ValidationError('Choose a technician for every service of the visit (all or none).');
    await this.assignPlan(ctx, { items: [{ queueItemId: id, expectedVersion: d.version ?? 1, expectedTechnicianId: d.assignedTechnicianId ?? null, lines: lines as any }],
      idempotencyKey: `svcassign:${id}:${d.version ?? 1}:${lines.map((l) => l.technicianId).join(',')}`, source: 'staff', reason: null });
    return this.detailOf(ctx, id);
  }

  /**
   * Multi-technician routing (contract §3) — the ONE canonical writer of a multi-line assignment: AI accept / adjust, the
   * auto-run, staff manual, a party. All or none: every guest and every line must still be what the caller saw (409
   * VERSION_CONFLICT naming the guest / line), the lock is respected exactly as assignTechnician, each line's technician
   * must be in the salon, available and skilled for THAT service (or a manager override with ai_queue_assignment.override),
   * and every service of each visit must be covered. Same idempotency key → the same answer (replayed: true), no second write.
   */
  async assignPlan(ctx: QueueContext, body: AssignPlanRequest & { items: (AssignPlanRequest['items'][number] & { lines: (AssignPlanRequest['items'][number]['lines'][number] & Partial<Pick<PlanWriteLine, 'timing' | 'afterServiceId' | 'plannedStartOffsetMin'>>)[] })[] }): Promise<AssignPlanResult> {
    this.need(ctx, 'pos.queue.assign_technician');
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length || items.length > 20) throw new ValidationError('A plan assigns 1 to 20 guests.');
    const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (!key || key.length > 200) throw new ValidationError('An idempotency key (up to 200 characters) is required.');
    const source: QueueAssignSource = body.source ?? 'staff';
    if (!ASSIGN_SOURCES.includes(source)) throw new ValidationError('Unknown assignment source');
    const ai = AI_SOURCES.includes(source);
    if (new Set(items.map((i) => i?.queueItemId)).size !== items.length || items.some((i) => !i?.queueItemId)) throw new ValidationError('Each guest may appear once in a plan.');
    for (const it of items) {
      if (!Array.isArray(it.lines) || !it.lines.length || it.lines.length > 20) throw new ValidationError('Each guest needs 1 to 20 service lines.');
      if (!Number.isFinite(Number(it.expectedVersion))) throw new ValidationError('Send the version of the guest you saw (expectedVersion).');
      if (it.expectedTechnicianId === undefined) throw new ValidationError('Send the technician you saw on the guest (expectedTechnicianId, null = unassigned).');
      if (it.lines.some((l) => !l?.serviceId || !l?.technicianId || l.expectedTechnicianId === undefined)) throw new ValidationError('Every line needs a service, a technician and the technician you saw on it (expectedTechnicianId).');
    }
    const groupId = body.groupId ? String(body.groupId) : null;
    if (items.length > 1 && !groupId) throw new ValidationError('A plan for several guests is a party plan — send its groupId.');
    // 1. idempotency: the key of the first guest's history row answers a retry
    const first = items[0].queueItemId;
    const prior = await this.repo.idempotentAssignment(ctx, `${key}:${first}`);
    if (prior) { if (prior.queueItemId !== first) throw new ValidationError('This idempotency key was already used for another guest.'); return this.planResult(ctx, items.map((i) => i.queueItemId), true); }
    // 2. what the service checks before the transaction (the repository re-checks state under row locks)
    const techs = await this.repo.technicians(ctx);
    const cat = await this.repo.serviceCatalog(ctx);
    const overrideAllowed = !!body.managerOverride && source !== 'auto_assign' && !ctx.system && hasPermission(ctx as any, 'ai_queue_assignment.override');
    const write: PlanWriteItem[] = [];
    for (const it of items) {
      const q = await this.itemOr404(ctx, it.queueItemId);
      const lock = await this.repo.activeLock(ctx, it.queueItemId);
      if (lock && it.lines.some((l) => l.technicianId !== lock.technicianId) && !overrideAllowed) throw new QueueAssignmentLocked(lock);
      for (const l of it.lines) {
        if (!q.services.some((s) => s.serviceId === l.serviceId)) throw new ValidationError('That service is not on this visit.');
        const tech = techs.find((t) => t.technicianId === l.technicianId);
        if (!tech) throw new ValidationError('Technician not found in this tenant');
        const category = cat.find((c) => c.serviceId === l.serviceId)?.categoryName;
        const needsOverride = !tech.available || !skillMatch(tech.skills, category ? [category] : []);
        if (needsOverride && !overrideAllowed) throw new ValidationError(`${tech.name} is not ${!tech.available ? 'available' : 'skilled for ' + (q.services.find((s) => s.serviceId === l.serviceId)?.serviceName ?? 'this service')} — manager override required`);
      }
      const lines = derivePlanLines(q.services, it.lines);
      const lineTechs = [...new Set(lines.map((l) => l.technicianId))];
      const lead = it.leadTechnicianId ?? leadOfLines(q.services, lines);
      if (!lineTechs.includes(lead)) throw new ValidationError('The lead technician must be one of the visit\'s technicians.');
      write.push({ queueItemId: it.queueItemId, expectedVersion: Number(it.expectedVersion), expectedTechnicianId: it.expectedTechnicianId ?? null, leadTechnicianId: lead, lines });
    }
    // 3. the all-or-none write
    try {
      await this.rule(() => this.repo.assignPlan(ctx, { items: write, groupId, source, ai, keyBase: key, reason: body.reason ?? null, metadata: { override: !!body.managerOverride } }));
    } catch (e) {
      if (e instanceof QueueIdempotentReplay) return this.planResult(ctx, items.map((i) => i.queueItemId), true);
      // a concurrent retry of the SAME plan lost the race to its twin: a replay, not a conflict
      if (e instanceof QueueAssignmentConflict && (await this.repo.idempotentAssignment(ctx, `${key}:${first}`))?.queueItemId === first) return this.planResult(ctx, items.map((i) => i.queueItemId), true);
      throw e;
    }
    this.log(ctx, 'pos_queue_plan_assigned', 'pos_queue_assignment', first, undefined, undefined, { items: write.length, groupId, source });
    if (!this.repo.emitsDomainEvents?.()) {
      for (const w of write) {
        this.announce(ctx, EVENTS.queueUpdated, { queueItemId: w.queueItemId, reason: 'service_lines' });
        if (this.push) for (const t of new Set(w.lines.map((l) => l.technicianId))) {
          try { const uid = await this.repo.technicianUserId(ctx, t); if (uid) await this.push.dispatchToUser(ctx.tenantId, uid, { title: 'New assignment', body: 'A guest is waiting for you', data: { kind: 'queue_assignment', queueItemId: w.queueItemId }, reference: 'queue_assignment', category: 'QUEUE_ASSIGNMENT' }); } catch { /* best-effort */ }
        }
      }
    }
    return this.planResult(ctx, items.map((i) => i.queueItemId), false);
  }
  private async planResult(ctx: QueueContext, ids: string[], replayed: boolean): Promise<AssignPlanResult> {
    const out: AssignPlanResult['items'] = [];
    for (const id of ids) {
      const d = await this.detailOf(ctx, id);
      out.push({ queueItemId: id, version: d.version ?? 1, assignedTechnicianId: d.assignedTechnicianId ?? '', serviceAssignments: (d.serviceAssignments ?? []) as any });
    }
    return { applied: true, replayed, items: out };
  }

  // ==== customer-facing (the customer's own visit only; never another guest's data) ====
  private async ownVisit(ctx: QueueContext, id: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    const tctx: QueueContext = { ...ctx, branchId: '' };
    const customerId = await this.repo.customerIdForUser(tctx);
    const q = customerId ? await this.repo.item(tctx, id) : null;
    if (!q || q.customerId !== customerId) throw new ValidationError('We could not find this visit.');   // the same answer for "not yours" — nothing leaks
    return { q, bctx: { ...tctx, branchId: q.branchId || '' } as QueueContext };
  }
  /** Technicians the customer may switch to (skill-matched, soonest first) — the explicit list, always answered. */
  async customerAlternates(ctx: QueueContext, id: string): Promise<CustomerAlternatesView> {
    const { q, bctx } = await this.ownVisit(ctx, id);
    const { rows, cats } = await this.alternatesBasis(bctx, q);
    const requested = q.requestedTechId ? rows.find((t) => t.technicianId === q.requestedTechId) : undefined;
    return { queueItemId: id, requestedTechnicianId: q.requestedTechId ?? null, requestedTechnicianName: requested?.name ?? null,
      requestedAvailableInMinutes: requested ? this.waitFor(requested) : null, alternates: this.eligibleAlternates(rows, cats, q.requestedTechId ?? null) };
  }
  /** GET customer/queue additions (round 2): is the requested technician busy, and who else could take the guest. */
  async customerQueueExtras(ctx: QueueContext, id: string): Promise<QueueAlternatesView> {
    const { bctx } = await this.ownVisit(ctx, id);
    return this.alternatesForItem(bctx, id);
  }
  // A technician's real wait: what is left of the service now + the guests already queued for them.
  private waitFor(t: TechSignalRow): number | null { return t.signals.availableInMinutes == null ? null : Math.max(t.signals.availableInMinutes, t.assignedMinutes); }
  private async alternatesBasis(bctx: QueueContext, q: { queueItemId: string; services: { serviceId: string }[] }) {
    const entries = (await this.repo.activeEntries(bctx)).filter((e) => e.queueItemId !== q.queueItemId);   // the guest is not their own load
    return { rows: await this.repo.techSignals(bctx, entries), cats: await this.categoriesFor(bctx, q.services) };
  }
  private eligibleAlternates(rows: TechSignalRow[], cats: string[], requestedId: string | null) {
    return rows.filter((t) => t.technicianId !== requestedId && t.available && !t.signals.onBreak && !t.signals.blocked && t.signals.status !== 'off_shift' && skillMatch(t.skills, cats))
      .map((t) => ({ technicianId: t.technicianId, name: t.name, availableInMinutes: this.waitFor(t) }))
      .sort((a, b) => (a.availableInMinutes ?? 9999) - (b.availableInMinutes ?? 9999) || a.name.localeCompare(b.name)).slice(0, 5);
  }
  /**
   * IN-PROCESS ONLY (never routed): the requested technician's state + alternates for one guest. The caller has already
   * proved the guest is theirs (the customer session, or the kiosk session that checked them in). Alternates are offered
   * only when the requested technician is busy.
   */
  async alternatesForItem(ctx: QueueContext, queueItemId: string): Promise<QueueAlternatesView> {
    const q = await this.itemOr404(ctx, queueItemId);
    if (!q.requestedTechId) return { requestedTechnician: null, alternates: [] };
    const bctx = this.branchCtx(ctx, q.branchId);
    const { rows, cats } = await this.alternatesBasis(bctx, q);
    const t = rows.find((x) => x.technicianId === q.requestedTechId);
    const wait = t ? this.waitFor(t) : null;
    const busy = !t || !t.available || t.signals.status !== 'available' || wait !== 0;
    return {
      requestedTechnician: { technicianId: q.requestedTechId, name: t?.name ?? q.requestedTechName ?? '', busy, availableInMinutes: wait },
      alternates: busy ? this.eligibleAlternates(rows, cats, q.requestedTechId) : [],
    };
  }
  /**
   * IN-PROCESS ONLY: the guest (customer app or kiosk) agrees to another technician. 409 when that technician was
   * taken meanwhile (no longer free to take them) or the desk already assigned the guest.
   */
  async acceptAlternateForItem(ctx: QueueContext, queueItemId: string, technicianId: string, source: 'customer' | 'kiosk'): Promise<AcceptAlternateResult> {
    if (!technicianId) throw new ValidationError('Choose a technician.');
    const q = await this.itemOr404(ctx, queueItemId);
    const bctx = this.branchCtx(ctx, q.branchId);
    const taken = () => new QueueAssignmentConflict(q.assignedTechId ?? null, q.version ?? 1, 'That technician was just taken — please choose another, or keep waiting.');
    if (!['waiting', 'called'].includes(q.status) || (q.assignedTechId && q.assignedTechId !== technicianId)) {
      throw new QueueAssignmentConflict(q.assignedTechId ?? null, q.version ?? 1, 'Your visit already has a technician — please see the front desk to change it.');
    }
    const { rows, cats } = await this.alternatesBasis(bctx, q);
    const tech = rows.find((t) => t.technicianId === technicianId);
    if (!tech) throw new ValidationError('That technician is not available at this salon.');
    if (q.requestedTechId !== technicianId && !this.eligibleAlternates(rows, cats, q.requestedTechId ?? null).some((a) => a.technicianId === technicianId)) throw taken();
    if (q.requestedTechId !== technicianId) {
      const ok = await this.repo.setRequestedTechnician(bctx, queueItemId, technicianId, this.meta('accept_alternate', 'pos_queue_customer_accepted_alternate', {
        source, reason: source === 'kiosk' ? 'The guest accepted another technician at the kiosk' : 'The customer accepted another technician',
        metadata: { previousRequestedTechnicianId: q.requestedTechId ?? null, technicianId } }));
      if (!ok) throw new ValidationError('We could not update your visit. Please see the front desk.');
      this.announce(bctx, EVENTS.queueUpdated, { queueItemId });
    }
    const after = await this.repo.item(bctx, queueItemId);
    return { ok: true, queueItemId, requestedTechnicianId: technicianId, requestedTechnicianName: tech.name, technicianName: tech.name, version: after?.version ?? 1 };
  }
  /** POST customer/queue/:id/accept-alternate — the customer agrees to another technician; history source 'customer'. */
  async acceptAlternate(ctx: QueueContext, id: string, body: AcceptAlternateRequest): Promise<AcceptAlternateResult> {
    const { bctx } = await this.ownVisit(ctx, id);
    return this.acceptAlternateForItem(bctx, id, body?.technicianId, 'customer');
  }
}
