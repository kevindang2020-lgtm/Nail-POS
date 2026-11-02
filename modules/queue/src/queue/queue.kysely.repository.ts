// queue.kysely.repository.ts — production QueueRepositoryPort over Postgres (Kysely).
// Real, tenant/branch-scoped over pos_queue_items; technicians/serviceCatalog read from technicians/services.
// Wait math reuses the same dto helper. Scope is session-derived (tenant_id + branch_id), never the client.
//
// Schema notes (honest — pos_queue_items has no columns for these, so NOT faked):
//  - move-to-serving / move-to-tech-queue idempotency keys are held in-process (no key columns on the table), so
//    dedupe holds within a running server; persisting them is a follow-up.
//  - technician `skills` are derived from technician_services → service categories (eligibility works without override
//    when the tech is mapped to the requested service's category); `available` is derived
//    from technician_statuses where present, else is_active. createdAt uses checked_in_at; settings = defaults.
import { branchTimeZone, assertTransition, canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET } from '@aipowersalon/appointments';
import { QUEUE_SERVICE_ASSIGNMENT } from '../queue-lifecycles';
import { businessDate, localDateTimeToEpochMs, zonedParts } from '@aipowersalon/date-time';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { buildMediaUrl } from '@aipowersalon/media';
import { sql, type Kysely } from 'kysely';
import { toStoredCustomerPhone } from '@aipowersalon/customers';
import { nextTicketNumber } from './ticket-number';
import type { DB } from '@aipowersalon/database';
import { lineFields, holdsSlot, minutesFor, type QueueContext, type QueueRepositoryPort, type QueueActiveEntry, type TechSignalRow, type QueueDetailOptions } from './queue.repository';
import { computeTechSignals, rotationOrder, assignedMinutesFor, lateMinutesAt, FINISHED_QUEUE_STATUSES } from './queue-signals';
import {
  type QueueWriteMeta, type QueueItemLock, type LockQueueItemRequest, type QueueHistoryRow, type QueueGroupView, type CreateQueueGroupRequest,
  type QueueServiceAssignmentView, type PlanWriteItem, QueueIdempotentReplay, QueueRuleError } from './queue.dto';
import { ensureVisitTicket } from './visit-ticket';
import { buildQueueFloor, projectedServiceCents } from './queue-floor';
import {
  POSQueueFullState, POSQueueItemRow, POSQueueItemDetail, POSQueueKpisFull, QueueFilters, QueueItemStatus, QueuePriority,
  QueueRequestedService, QueueWorkflowSettings, DEFAULT_QUEUE_SETTINGS, estimateWaitMinutes, computeReturnRatePercent,
  QueueAnalytics, QueueStaffRow, QueueInsight, buildTopWaitingServices, buildVisitSourceMix, buildCustomerTypeMix, buildQueuePotentialRevenue,
  QueueConversion, computeQueueConversion, QUEUE_CONVERSION_GOAL_PERCENT, QueueAssignmentConflict, type QueueAssignExpectation } from './queue.dto';
import { PosKpiSnapshots } from '@aipowersalon/reports';
import { DEFAULT_TQ_SETTINGS } from '../tech-queue/tech-queue.dto';
import { clampPageSize, clampPage, foldVi, withCode } from '@aipowersalon/api-contracts';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { turnAssign, turnUnassign, turnServiceStart, openAssignments, type SkipReason, type TurnActor } from '@aipowersalon/workforce';

interface QItem {
  queueItemId: string; customerId: string; customerName: string; customerAvatarUrl?: string | null; customerPhone?: string; isVip: boolean; source: any;
  appointmentId: string | null; ticketId: string | null; services: QueueRequestedService[]; priority: QueuePriority; status: QueueItemStatus;
  assignedTechId: string | null; assignedTechName: string | null; requestedTechId?: string | null; requestedTechName?: string | null; station?: string; checkedInAtMs: number; calledAtMs: number | null;
  startedAtMs: number | null; notes: string; customerNotifiedAt: string | null; servingKey?: string; techQueueKey?: string; createdAtMs: number; updatedAt: string;
  branchId?: string | null; version?: number; position?: number | null; groupId?: string | null; lateMinutes?: number | null; previousTechId?: string | null;
}
interface TechRec { technicianId: string; name: string; avatarUrl?: string | null; available: boolean; employed?: boolean; skills: string[]; branchId: string | null; rosterActive: boolean; }
interface SvcRec { serviceId: string; name: string; categoryName: string; durationMinutes: number; priceCents: number; }
const ms = (v: any) => (v ? new Date(v).getTime() : 0);
const ACTIVE: QueueItemStatus[] = ['waiting', 'called', 'assigned', 'ready_for_tech'];
const FINISHED = [...FINISHED_QUEUE_STATUSES] as string[];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const ITEM_COLS = ['id', 'branch_id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'source', 'appointment_id', 'ticket_id', 'requested_services', 'priority', 'status', 'assigned_technician_id', 'requested_technician_id', 'station', 'checked_in_at', 'called_at', 'started_at', 'notes', 'customer_notified_at', 'updated_at', 'version', 'position', 'group_id', 'late_minutes', 'previous_technician_id', 'serving_idempotency_key', 'tech_queue_idempotency_key'] as const;
const parseSvcs = (v: any): QueueRequestedService[] => { if (Array.isArray(v)) return v; if (typeof v === 'string') { try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } } return []; };
const durationOf = (svcs: QueueRequestedService[]) => svcs.reduce((n, s) => n + (Number(s.estimatedDurationMinutes) || 0), 0);
const isUniqueViolation = (e: any) => String(e?.code ?? '') === '23505' || /duplicate key|unique constraint/i.test(String(e?.message ?? ''));

export class KyselyQueueRepository implements QueueRepositoryPort {
  private seq = Date.now() % 1000000;
  // Constitution 8 §18: queue.customer_assigned is written with the assignment. Optional and null-safe.
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) {}
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }   // not merely "has an outbox": the publisher must be ON
  nextSeq() { return ++this.seq; }
  /** The clock (tests set it). */
  now: () => number = Date.now;

  // ---- BUILD_PLAN Phase 6: every write is DESCRIBED inside its transaction ----
  // Migration 525's triggers bump pos_queue_items.version, stamp the real updated_at and write pos_queue_status_history
  // for EVERY writer (five modules update this table). The app tells them who / why / which action through
  // transaction-local settings; pos_queue_audit (written by nobody before — audit bug 15) gets its row here, in the same
  // transaction. An action label also forces a version bump for writes that change no queue column (lock, unlock …).
  private async describe(trx: any, ctx: QueueContext, meta?: QueueWriteMeta): Promise<void> {
    if (!meta) return;
    await sql`select set_config('app.queue_action', ${meta.action}, true), set_config('app.queue_source', ${meta.source ?? (ctx.system ? 'system' : 'staff')}, true),
      set_config('app.queue_actor', ${isUuid(ctx.userId) ? ctx.userId : ''}, true), set_config('app.queue_reason', ${meta.reason ?? ''}, true),
      set_config('app.queue_idempotency_key', ${meta.idempotencyKey ?? ''}, true)`.execute(trx);
  }
  private async undescribe(trx: any): Promise<void> {
    await sql`select set_config('app.queue_action', '', true), set_config('app.queue_idempotency_key', '', true)`.execute(trx);
  }
  private async auditRow(trx: any, ctx: QueueContext, id: string | null, meta: QueueWriteMeta, before?: unknown, after?: unknown): Promise<void> {
    await trx.insertInto('pos_queue_audit').values({
      tenant_id: ctx.tenantId, branch_id: isUuid(ctx.branchId) ? ctx.branchId : null, user_id: isUuid(ctx.userId) ? ctx.userId : null,
      role: ctx.system ? 'SYSTEM' : (ctx.role || 'UNKNOWN'), action_type: meta.auditAction ?? 'pos_queue_' + meta.action, entity_type: 'pos_queue_item', entity_id: id,
      before: before === undefined ? null : JSON.stringify(before), after: after === undefined ? null : JSON.stringify(after),
      metadata: JSON.stringify({ source: meta.source ?? (ctx.system ? 'system' : 'staff'), reason: meta.reason ?? null, idempotencyKey: meta.idempotencyKey ?? null, ...(meta.metadata || {}) }),
    }).execute();
  }
  async audit(ctx: QueueContext, id: string | null, meta: QueueWriteMeta): Promise<void> {
    await this.db.transaction().execute((trx) => this.auditRow(trx, ctx, id, meta));
  }
  private event(trx: any, ctx: QueueContext, eventType: any, aggregateId: string, payload: Record<string, unknown>, branchId?: string | null) {
    if (!this.outbox) return Promise.resolve();
    return this.outbox.write(trx, createDomainEvent({ eventType, tenantId: ctx.tenantId, branchId: (branchId ?? ctx.branchId) || undefined, aggregateType: 'queue_item', aggregateId,
      actorId: ctx.userId || undefined, actorType: ctx.system ? 'system' : 'user', payload }));
  }
  private async branchClock(tenantId: string, branchId: string | null): Promise<{ tz: string; date: string; nowMinutes: number; dayStartMs: number; nowMs: number }> {
    const tz = await branchTimeZone(this.db, tenantId, branchId);
    const nowMs = this.now(); const p = zonedParts(new Date(nowMs), tz); const date = businessDate(tz, new Date(nowMs));
    return { tz, date, nowMinutes: p.hour * 60 + p.minute, dayStartMs: localDateTimeToEpochMs(date, '00:00', tz), nowMs };
  }

  private scoped(qb: any, ctx: QueueContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }
  private _settings(): QueueWorkflowSettings { return DEFAULT_QUEUE_SETTINGS; }
  async settings(_ctx: QueueContext) { return this._settings(); }

  private async _techs(ctx: QueueContext): Promise<TechRec[]> {
    const rows = await this.scoped(this.db.selectFrom('technicians as tech'), ctx, 'tech')
      .leftJoin('users as u', 'u.id', 'tech.user_id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`tech.user_id`)
        ]))
      )
      .where('tech.status', '!=', 'archived').where('tech.archived_at', 'is', null)
      .select(['tech.id', 'tech.full_name', 'tech.status', 'tech.is_active', 'tech.branch_id', 'tech.avatar_url as tech_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'u.avatar_url as user_avatar_url'])
      .execute().catch(() => []);
    const ids = rows.map((r: any) => r.id);
    // Merge Oct 12 2026 (workforce audit P1 #21): employment is a hard gate — a suspended / inactive / terminated row is never
    // available (whatever the presence flag says) and is not in the ASSIGNABLE roster at all (names for history still resolve).
    const employed = (r: any) => r.is_active !== false && !['suspended', 'inactive', 'terminated'].includes(String(r.status || '').toLowerCase());
    // latest status wins (several rows per technician exist on older data)
    const stat = ids.length ? await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', ids).select(['technician_id', 'status']).orderBy('changed_at', 'asc').execute().catch(() => []) : [];
    const statBy: Record<string, string> = {}; for (const s of stat) statBy[s.technician_id] = s.status;
    // Skills = category names of the services each technician is mapped to (technician_services → services → categories),
    // so the assignment skill-gate works without a manager override when the tech can perform the requested service.
    const maps = ids.length ? await this.scoped(this.db.selectFrom('technician_services'), ctx).where('technician_id', 'in', ids).select(['technician_id', 'service_id']).execute().catch(() => []) : [];
    const catByService: Record<string, string> = {}; for (const s of await this._catalog(ctx)) if (s.categoryName) catByService[s.serviceId] = s.categoryName;
    const skillsBy: Record<string, Set<string>> = {};
    for (const m of maps) { const cn = catByService[m.service_id]; if (cn) (skillsBy[m.technician_id] = skillsBy[m.technician_id] || new Set()).add(cn); }
    return rows.map((r: any) => {
      const photo = r.tech_avatar_url || r.gtp_avatar_url || r.user_avatar_url;
      return {
        technicianId: r.id, name: r.full_name || r.id, avatarUrl: photo ? buildMediaUrl(photo) : null,
        available: employed(r) && (statBy[r.id] ? statBy[r.id] === 'available' : r.status === 'active'), employed: employed(r), skills: [...(skillsBy[r.id] || [])],
        branchId: r.branch_id ?? null, rosterActive: r.status === 'active',   // the technician's REAL branch (audit bug 1/4: it was the caller's)
      };
    });
  }
  /** The ASSIGNABLE roster: suspended / inactive technicians are not offered (merge Oct 12 2026). */
  async technicians(ctx: QueueContext) { return (await this._techs(ctx)).filter((t) => t.employed !== false); }
  async technicianUserId(ctx: QueueContext, technicianId: string): Promise<string | null> {
    const r = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', technicianId).select(['user_id']).executeTakeFirst().catch(() => undefined);
    return r?.user_id ?? null;
  }
  async customerUserId(ctx: QueueContext, queueItemId: string): Promise<string | null> {
    const q = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', queueItemId).select(['customer_id']).executeTakeFirst().catch(() => undefined);
    const cid = q?.customer_id; if (!cid) return null;
    const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', cid).select(['user_id']).executeTakeFirst().catch(() => undefined);
    return c?.user_id ?? null;
  }

  private async _catalog(ctx: QueueContext): Promise<SvcRec[]> {
    // Service catalog is loaded tenant-wide (no branch filter) so cross-branch bookings always resolve correctly.
    const rows = await this.db.selectFrom('services as s').where('s.tenant_id', '=', ctx.tenantId).leftJoin('service_categories as c', 'c.id', 's.category_id')
      .select(['s.id as serviceId', 's.name as name', 'c.name as categoryName', 's.duration_minutes as dur', 's.price_cents as price']).execute().catch(() => []);
    return rows.map((r: any) => ({ serviceId: r.serviceId, name: r.name, categoryName: r.categoryName || 'General', durationMinutes: Number(r.dur || 0), priceCents: Number(r.price || 0) }));
  }
  async serviceCatalog(ctx: QueueContext) { return this._catalog(ctx); }

  private async loadOne(ctx: QueueContext, id: string): Promise<QItem | null> {
    const r = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', id)
      .select(ITEM_COLS).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    let techName: string | null = null;
    if (r.assigned_technician_id) { const t = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', r.assigned_technician_id).select('full_name').executeTakeFirst().catch(() => undefined); techName = t?.full_name || null; }
    let reqTechName: string | null = null;
    if (r.requested_technician_id) { const t = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', r.requested_technician_id).select('full_name').executeTakeFirst().catch(() => undefined); reqTechName = t?.full_name || null; }
    let custAvatar: string | null = null;
    if (r.customer_id) { const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', r.customer_id).select('avatar_url').executeTakeFirst().catch(() => undefined); custAvatar = c?.avatar_url || null; }
    return this.rowToQItem(r, techName, reqTechName, custAvatar);
  }
  private rowToQItem(r: any, techName: string | null, reqTechName: string | null = null, customerAvatarUrl?: string | null): QItem {
    return {
      queueItemId: r.id, customerId: r.customer_id || '', customerName: r.customer_name || '', customerAvatarUrl: customerAvatarUrl || null, customerPhone: r.customer_phone || undefined, isVip: !!r.is_vip, source: r.source,
      appointmentId: r.appointment_id || null, ticketId: r.ticket_id || null, services: parseSvcs(r.requested_services), priority: r.priority, status: r.status, assignedTechId: r.assigned_technician_id || null,
      assignedTechName: techName, requestedTechId: r.requested_technician_id || null, requestedTechName: reqTechName, station: r.station || undefined, checkedInAtMs: ms(r.checked_in_at), calledAtMs: r.called_at ? ms(r.called_at) : null, startedAtMs: r.started_at ? ms(r.started_at) : null,
      notes: r.notes || '', customerNotifiedAt: r.customer_notified_at ? new Date(r.customer_notified_at).toISOString() : null, servingKey: r.serving_idempotency_key || undefined, techQueueKey: r.tech_queue_idempotency_key || undefined,
      // audit bug 3: the row's REAL updated_at (it was "now" for every row, so nothing ever looked stuck)
      createdAtMs: ms(r.checked_in_at), updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date(ms(r.checked_in_at)).toISOString(),
      branchId: r.branch_id ?? null, version: r.version != null ? Number(r.version) : 1, position: r.position ?? null, groupId: r.group_id ?? null,
      lateMinutes: r.late_minutes ?? null, previousTechId: r.previous_technician_id ?? null,
    };
  }
  /** The board's rows: every ACTIVE guest plus today's finished ones (a filter may ask for them) — never the branch's
   *  whole history (audit bug 4: every board read loaded every queue row the branch ever had). */
  private async loadAll(ctx: QueueContext): Promise<QItem[]> {
    const clock = await this.branchClock(ctx.tenantId, ctx.branchId || null);
    const rows = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx)
      .where((eb: any) => eb.or([eb('status', 'not in', FINISHED), eb('checked_in_at', '>=', new Date(clock.dayStartMs))]))
      .select(ITEM_COLS).execute().catch(() => []);
    const techs = await this._techs(ctx); const tn: Record<string, string> = {}; for (const t of techs) tn[t.technicianId] = t.name;
    const customerIds = [...new Set((rows as any[]).map((r) => r.customer_id).filter(Boolean))];
    const custRows = customerIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', customerIds).select(['id', 'avatar_url']).execute().catch(() => []) : [];
    const custAvatarMap: Record<string, string> = {};
    for (const c of custRows) { if (c.id && c.avatar_url) custAvatarMap[c.id] = c.avatar_url; }
    return rows.map((r: any) => this.rowToQItem(r, r.assigned_technician_id ? tn[r.assigned_technician_id] || null : null, r.requested_technician_id ? tn[r.requested_technician_id] || null : null, r.customer_id ? custAvatarMap[r.customer_id] : null));
  }

  async item(ctx: QueueContext, id: string) { return this.loadOne(ctx, id); }

  // Project a queue item into the technician queue. Reads the queue item (tenant/branch scoped), then inserts a
  // pos_tech_queue_tickets row the tech app + tech-queue board read from. Idempotent on queue_item_id so a repeated
  // move-to-tech-queue (or a process without the in-memory idempotency key) never creates a duplicate ticket. Source
  // and priority are coerced to the tech-queue CHECK domains so an out-of-domain queue value can't fail the insert.
  async projectToTechQueue(ctx: QueueContext, id: string): Promise<{ created: boolean; techQueueTicketId?: string; techQueueTicketIds?: string[] }> {
    // Multi-technician routing: a SPLIT visit (≥2 line technicians) is projected as one ticket per technician (its parts);
    // every other visit takes the legacy path below, unchanged.
    if (isUuid(id)) { const split = await this.projectSplit(ctx, id); if (split) return split; }
    const existing: any = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('queue_item_id', '=', id).select('id').executeTakeFirst().catch(() => undefined);
    if (existing?.id) return { created: false, techQueueTicketId: existing.id };
    const q: any = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', id)
      .select(['id', 'branch_id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'source', 'appointment_id', 'ticket_id', 'requested_services', 'priority', 'assigned_technician_id'])
      .executeTakeFirst().catch(() => undefined);
    if (!q || !q.assigned_technician_id) return { created: false };
    const services = typeof q.requested_services === 'string' ? q.requested_services : JSON.stringify(q.requested_services ?? []);
    const source = ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'].includes(q.source) ? q.source : 'manual';
    const priority = ['normal', 'high', 'vip', 'urgent'].includes(q.priority) ? q.priority : 'normal';
    // §12 — stamp the server-side acceptance deadline so the sweep can auto-expire an offer the technician never answers.
    // 0 disables the timer (deadline stays NULL → never auto-expires). The Tech App surfaces this for its countdown.
    const timeoutS = Number(DEFAULT_TQ_SETTINGS.acceptanceTimeoutSeconds) || 0;
    const deadlineExpr = timeoutS > 0 ? sql`now() + (${timeoutS} * interval '1 second')` : null;
    const ins: any = await this.db.transaction().execute(async (trx) => {
      const r: any = await trx.insertInto('pos_tech_queue_tickets').values({
        tenant_id: ctx.tenantId, branch_id: q.branch_id ?? ctx.branchId ?? null, queue_item_id: q.id, ticket_id: q.ticket_id ?? null,
        customer_id: q.customer_id ?? null, customer_name: q.customer_name, customer_phone: q.customer_phone ?? null,
        is_vip: !!q.is_vip, source, appointment_id: q.appointment_id ?? null, requested_services: services,
        priority, status: 'assigned', assigned_technician_id: q.assigned_technician_id, assigned_at: sql`now()`, acceptance_deadline: deadlineExpr,
      } as any).returning('id').executeTakeFirst();
      // technician.assigned — declared since Constitution 8, recorded by nothing until now: the offer to a technician
      // exists from this row on. Ids only (no customer name / phone), in the insert's own transaction.
      if (this.outbox && r?.id) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.TECHNICIAN_ASSIGNED, tenantId: ctx.tenantId,
        branchId: q.branch_id ?? ctx.branchId ?? undefined, aggregateType: 'tech_queue_ticket', aggregateId: String(r.id), actorId: ctx.userId || undefined, actorType: 'user',
        correlationId: q.ticket_id ? `ticket:${q.ticket_id}` : undefined,
        payload: { techQueueTicketId: String(r.id), queueItemId: String(q.id), ticketId: q.ticket_id ?? null, technicianId: String(q.assigned_technician_id), acceptanceTimeoutSeconds: timeoutS } }));
      return r;
    });
    return { created: true, techQueueTicketId: ins?.id };
  }

  /** A split visit → one pos_tech_queue_tickets row per line technician (visit_part 1..n by first line start), each with
   *  only that technician's services; the lines record the part they are served on. Idempotent (uq_pos_tech_queue_visit_part).
   *  null = not a split visit (the caller takes the whole-visit path). */
  private async projectSplit(ctx: QueueContext, id: string): Promise<{ created: boolean; techQueueTicketId?: string; techQueueTicketIds: string[] } | null> {
    const lines: any[] = await this.db.selectFrom('queue_service_assignments').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id)
      .where('status', 'in', ['assigned', 'in_service', 'pending']).where('technician_id', 'is not', null)
      .select(['service_id', 'technician_id', 'sequence', 'timing', 'planned_start_offset_min']).execute();
    const techs = [...new Set(lines.map((l) => String(l.technician_id)))];
    if (techs.length < 2) return null;
    const existingParts = async (db: any) => (await db.selectFrom('pos_tech_queue_tickets').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id)
      .where('visit_part', 'is not', null).select(['id', 'visit_part']).orderBy('visit_part', 'asc').execute()) as any[];
    const have = await existingParts(this.db);
    if (have.length) return { created: false, techQueueTicketId: String(have[0].id), techQueueTicketIds: have.map((r) => String(r.id)) };
    const q: any = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', id)
      .select(['id', 'branch_id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'source', 'appointment_id', 'ticket_id', 'requested_services', 'priority']).executeTakeFirst();
    if (!q) return null;
    const svcs = parseSvcs(q.requested_services);
    // the part order: first line start (the planner's offset; an 'after' line without one starts later), then sequence
    const startOf = (l: any) => (l.planned_start_offset_min != null ? Number(l.planned_start_offset_min) : l.timing === 'after' ? 100000 : 0);
    const firstStart = (t: string) => Math.min(...lines.filter((l) => String(l.technician_id) === t).map((l) => startOf(l) * 1000 + Number(l.sequence)));
    const ordered = [...techs].sort((a, b) => firstStart(a) - firstStart(b));
    const source = ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'].includes(q.source) ? q.source : 'manual';
    const priority = ['normal', 'high', 'vip', 'urgent'].includes(q.priority) ? q.priority : 'normal';
    const timeoutS = Number(DEFAULT_TQ_SETTINGS.acceptanceTimeoutSeconds) || 0;
    try {
      const ids: string[] = await this.db.transaction().execute(async (trx) => {
        const out: string[] = [];
        for (let i = 0; i < ordered.length; i++) {
          const tech = ordered[i];
          const mine = new Set(lines.filter((l) => String(l.technician_id) === tech).map((l) => String(l.service_id)));
          const r: any = await trx.insertInto('pos_tech_queue_tickets').values({
            tenant_id: ctx.tenantId, branch_id: q.branch_id ?? ctx.branchId ?? null, queue_item_id: q.id, ticket_id: q.ticket_id ?? null,
            customer_id: q.customer_id ?? null, customer_name: q.customer_name, customer_phone: q.customer_phone ?? null, is_vip: !!q.is_vip, source,
            appointment_id: q.appointment_id ?? null, requested_services: JSON.stringify(svcs.filter((s) => mine.has(String(s.serviceId)))),
            priority, status: 'assigned', assigned_technician_id: tech, assigned_at: sql`now()`, visit_part: i + 1,
            acceptance_deadline: timeoutS > 0 ? sql`now() + (${timeoutS} * interval '1 second')` : null,
          } as any).returning('id').executeTakeFirstOrThrow();
          await trx.updateTable('queue_service_assignments').set({ tech_queue_ticket_id: r.id, updated_at: sql`now()` })
            .where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id).where('technician_id', '=', tech).where('status', '!=', 'cancelled').execute();
          if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.TECHNICIAN_ASSIGNED, tenantId: ctx.tenantId,
            branchId: q.branch_id ?? ctx.branchId ?? undefined, aggregateType: 'tech_queue_ticket', aggregateId: String(r.id), actorId: ctx.userId || undefined, actorType: 'user',
            correlationId: q.ticket_id ? `ticket:${q.ticket_id}` : undefined,
            payload: { techQueueTicketId: String(r.id), queueItemId: String(q.id), ticketId: q.ticket_id ?? null, technicianId: tech, acceptanceTimeoutSeconds: timeoutS, visitPart: i + 1, partCount: ordered.length } }));
          out.push(String(r.id));
        }
        return out;
      });
      return { created: true, techQueueTicketId: ids[0], techQueueTicketIds: ids };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;   // a concurrent move projected the parts first — theirs stand
      const now = await existingParts(this.db);
      return { created: false, techQueueTicketId: now[0] ? String(now[0].id) : undefined, techQueueTicketIds: now.map((r) => String(r.id)) };
    }
  }

  private waited(q: QItem) { return Math.max(0, Math.floor((Date.now() - q.checkedInAtMs) / 60000)); }
  private avgServiceMin(cat: SvcRec[]) { return cat.length ? Math.round(cat.reduce((a, s) => a + s.durationMinutes, 0) / cat.length) : 45; }
  private toRow(ctx: QueueContext, q: QItem, all: QItem[], cat: SvcRec[], availTechs: number, locks?: Map<string, { technicianId: string | null; reason: string | null }>): POSQueueItemRow {
    const waited = this.waited(q); const waitingCount = all.filter((x) => ACTIVE.includes(x.status)).length;
    const avatar = q.customerAvatarUrl ? buildMediaUrl(q.customerAvatarUrl) : null;
    return {
      queueItemId: q.queueItemId, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: q.customerId, customerName: q.customerName, avatarUrl: avatar, customerAvatarUrl: avatar, customerPhone: q.customerPhone, isVip: q.isVip,
      source: q.source, appointmentId: q.appointmentId, ticketId: q.ticketId, requestedServices: q.services, serviceCount: q.services.length, priority: q.priority, status: q.status, requestedTechnicianName: q.requestedTechName || undefined,
      assignedTechnicianId: q.assignedTechId, assignedTechnicianName: q.assignedTechName, station: q.station, checkedInAt: new Date(q.checkedInAtMs).toISOString(),
      quotedWaitMinutes: estimateWaitMinutes(waitingCount, this.avgServiceMin(cat), availTechs), actualWaitMinutes: waited, notes: q.notes, createdAt: new Date(q.createdAtMs).toISOString(), updatedAt: q.updatedAt,
      version: q.version ?? 1, requestedTechnicianId: q.requestedTechId ?? null, position: q.position ?? null, groupId: q.groupId ?? null,
      ...(locks ? { locked: locks.has(q.queueItemId), lock: locks.get(q.queueItemId) ?? null } : {}),
    };
  }
  private filtered(all: QItem[], f: QueueFilters, cat: SvcRec[]): QItem[] {
    let rows = all.slice();
    if (f.search) { const s = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ rows = rows.filter((q) => [q.customerName, q.customerPhone, q.assignedTechName, q.notes, ...q.services.map((x) => x.serviceName)].some((x) => foldVi(x).includes(s))); }
    if (f.status && f.status !== 'all') {
      if (f.status === 'active') rows = rows.filter((q) => ACTIVE.includes(q.status));
      else rows = rows.filter((q) => q.status === f.status);
    } else if (!f.status) {
      rows = rows.filter((q) => ACTIVE.includes(q.status));
    }
    if (f.source) rows = rows.filter((q) => q.source === f.source);
    if (f.priority) rows = rows.filter((q) => q.priority === f.priority);
    if (f.technicianId) rows = rows.filter((q) => q.assignedTechId === f.technicianId);
    if (f.serviceCategory) rows = rows.filter((q) => q.services.some((rs) => cat.find((s) => s.serviceId === rs.serviceId)?.categoryName === f.serviceCategory));
    if (f.station) rows = rows.filter((q) => q.station === f.station);
    if (f.waitMin != null) rows = rows.filter((q) => this.waited(q) >= Number(f.waitMin));
    if (f.waitMax != null) rows = rows.filter((q) => this.waited(q) <= Number(f.waitMax));
    // the board's order (BUILD_PLAN Phase 6 reorder): a manager's position first, then first come first served
    return rows.sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.checkedInAtMs - b.checkedInAtMs);
  }
  /** Multi-technician routing: board rows say whether the visit is shared and who holds its lines (lead first). */
  private async fillLineFields(ctx: QueueContext, rows: POSQueueItemRow[]): Promise<void> {
    const ids = rows.map((r) => r.queueItemId).filter(isUuid);
    if (!ids.length) return;
    const lines: any[] = await this.db.selectFrom('queue_service_assignments').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', 'in', ids)
      .where('status', 'in', ['pending', 'assigned', 'in_service', 'done']).where('technician_id', 'is not', null).select(['queue_item_id', 'service_id', 'technician_id']).execute().catch(() => []);
    for (const r of rows) {
      const mine = lines.filter((l) => String(l.queue_item_id) === r.queueItemId).map((l) => ({ serviceId: String(l.service_id), technicianId: String(l.technician_id) }));
      if (!mine.length) continue;
      const f = lineFields(r.assignedTechnicianId ?? null, r.requestedServices, mine);
      r.lineTechnicianIds = f.lineTechnicianIds; r.sharedVisit = f.lineTechnicianIds.length >= 2;
    }
  }
  /** Active locks of these guests (round 2: the board row carries the lock, not only a flag). */
  private async activeLocks(ctx: QueueContext, ids: string[]): Promise<Map<string, { technicianId: string | null; reason: string | null }>> {
    const out = new Map<string, { technicianId: string | null; reason: string | null }>();
    if (!ids.length) return out;
    const rows = await this.db.selectFrom('queue_assignment_locks').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', 'in', ids).where('released_at', 'is', null)
      .where((eb: any) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql`now()`)])).select(['queue_item_id', 'technician_id', 'reason']).execute().catch(() => []);
    for (const r of rows) out.set(String(r.queue_item_id), { technicianId: r.technician_id ?? null, reason: r.reason ?? null });
    return out;
  }

  // Canonical Queue Conversion for the business day (+ delta vs yesterday, in points).
  private async conversionToday(ctx: QueueContext): Promise<QueueConversion> {
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null), businessDay = businessDate(tz);   // the branch's business day (Oct 3 2026 — was UTC)
    const dayExpr = (offset: number) => sql`(checked_in_at at time zone ${tz})::date = (${businessDay}::date - ${offset}::int)`;
    const countFor = async (offset: number): Promise<{ eligible: number; converted: number }> => {
      const r = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx)
        .where(dayExpr(offset))
        .select([
          sql<number>`count(*) filter (where status <> 'cancelled')`.as('eligible'),
          sql<number>`count(*) filter (where status <> 'cancelled' and started_at is not null)`.as('converted'),
        ]).executeTakeFirst().catch(() => undefined);
      return { eligible: Number(r?.eligible || 0), converted: Number(r?.converted || 0) };
    };
    const today = await countFor(0); const yest = await countFor(1);
    const percent = computeQueueConversion(today.eligible, today.converted);
    const yPercent = computeQueueConversion(yest.eligible, yest.converted);
    const deltaPercent = percent != null && yPercent != null ? percent - yPercent : null;
    return { percent, goalPercent: QUEUE_CONVERSION_GOAL_PERCENT, deltaPercent };
  }

  async query(ctx: QueueContext, f: QueueFilters): Promise<POSQueueFullState> {
    const all = await this.loadAll(ctx); const cat = await this._catalog(ctx); const techs = await this._techs(ctx); const availTechs = techs.filter((t) => t.available).length;
    const matched = this.filtered(all, f, cat);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageSlice = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const locks = await this.activeLocks(ctx, pageSlice.map((q) => q.queueItemId).filter(isUuid));
    const pageRows = pageSlice.map((q) => this.toRow(ctx, q, all, cat, availTechs, locks));
    await this.fillLineFields(ctx, pageRows);
    // "Best Match" is no longer computed here (BUILD_PLAN Phase 6, audit parallel implementation 1): QueueService fills
    // it from the AI engine (QUEUE_RECOMMENDER) — the queue keeps no scorer of its own.
    const active = all.filter((q) => ACTIVE.includes(q.status)); const waits = active.map((q) => this.waited(q)); const avg = this.avgServiceMin(cat);
    // Return rate: of the distinct customers currently waiting, the share with >=1 prior paid visit (tenant/branch scoped).
    const queueCustomerIds = [...new Set(active.map((q) => q.customerId).filter(Boolean))];
    const returnVisits: Record<string, number> = {};
    if (queueCustomerIds.length) {
      const vrows = await this.scoped(this.db.selectFrom('tickets'), ctx)
        .where('customer_id', 'in', queueCustomerIds).where('paid_at', 'is not', null)
        .select('customer_id').select(sql<number>`count(*)`.as('n')).groupBy('customer_id')
        .execute().catch(() => []);
      for (const r of vrows) returnVisits[r.customer_id] = Number(r.n || 0);
    }
    // §15: null (shown as —) when no identified customer is waiting — computeReturnRatePercent's 0 read as "nobody returns"
    const returnRatePercent = queueCustomerIds.length ? computeReturnRatePercent(active.map((q) => ({ customerId: q.customerId })), returnVisits) : null;
    const kpis: POSQueueKpisFull = {
      waitingGuests: active.length, averageWaitMinutes: waits.length ? Math.round(waits.reduce((a, w) => a + w, 0) / waits.length) : null, longestWaitMinutes: waits.length ? Math.max(...waits) : 0,
      vipWaiting: active.filter((q) => q.isVip || q.priority === 'vip').length, appointmentsWaiting: active.filter((q) => q.source === 'appointment').length, walkInsWaiting: active.filter((q) => q.source === 'walk_in').length,
      readyForTech: all.filter((q) => q.status === 'ready_for_tech').length, assignedTechnicians: new Set(active.filter((q) => q.assignedTechId).map((q) => q.assignedTechId)).size, delayedQueueItems: active.filter((q) => this.waited(q) > avg).length,
      readyForAssignment: active.filter((q) => !q.assignedTechId && (q.status === 'waiting' || q.status === 'called')).length,
      estQueueRevenueCents: active.reduce((a, q) => a + q.services.reduce((b, rs) => b + projectedServiceCents(rs), 0), 0),   // §42: approved override, else catalog
      readyForService: all.filter((q) => q.status === 'ready_for_tech' || q.status === 'assigned').length,
      noShowRisk: active.filter((q) => q.source === 'appointment' && this.waited(q) > Math.max(15, avg)).length,
      returnRatePercent,
    };
    // ---- Reference-module aggregations (real, fail-soft) ----
    const aggItems = active.map((q) => ({ source: q.source, isVip: q.isVip, priority: q.priority, customerId: q.customerId, requestedServices: q.services.map((rs) => ({ serviceName: rs.serviceName, priceCents: projectedServiceCents(rs) })) }));
    // Queue Trend: active arrivals bucketed by check-in hour.
    const trendBy: Record<number, number> = {};
    const trendTz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null);   // the branch's hour (it read the API server's zone)
    for (const q of active) { const h = zonedParts(new Date(q.checkedInAtMs), trendTz).hour; trendBy[h] = (trendBy[h] || 0) + 1; }
    const queueTrend = Object.keys(trendBy).map(Number).sort((a, b) => a - b).map((hour) => ({ hour, count: trendBy[hour] }));
    const potRev = buildQueuePotentialRevenue(aggItems);
    const conv = await this.conversionToday(ctx);
    const analytics: QueueAnalytics = {
      queueTrend, customerTypeMix: buildCustomerTypeMix(aggItems, returnVisits), visitSourceMix: buildVisitSourceMix(aggItems), topWaitingServices: buildTopWaitingServices(aggItems),
      conversion: conv, potentialRevenueByService: potRev.byService, potentialRevenueTotalCents: potRev.totalCents, potentialRevenueDeltaPercent: null,
    };
    // Customer Queue mandate (Oct 28 2026) §20–§29: the board, the priority panel, the technician panel and the insights are
    // ONE server projection (queue-floor.ts) over canonical state — the technicians from their real signals (clock-in,
    // schedule, breaks, services in progress) instead of every roster row with available = active
    const signals = await this.techSignals(ctx);
    const peak = queueTrend.length ? queueTrend.reduce((m, p) => (p.count > m.count ? p : m), queueTrend[0]).hour : null;
    const floor = buildQueueFloor({
      items: all.filter((q) => !FINISHED.includes(q.status) && q.status !== 'in_service').map((q) => ({ queueItemId: q.queueItemId, status: q.status, priority: q.priority, isVip: q.isVip, source: String(q.source), customerName: q.customerName, assignedTechId: q.assignedTechId, checkedInAtMs: q.checkedInAtMs, services: q.services })),
      techs: signals.map((t) => ({ technicianId: t.technicianId, name: t.name, avatarUrl: techs.find((x) => x.technicianId === t.technicianId)?.avatarUrl ?? null, skills: t.skills, activeAssignments: t.activeAssignments, rotationIndex: t.rotationIndex, signals: t.signals })),
      vipPriorityEnabled: this._settings().vipPriorityEnabled, avgServiceMinutes: avg, peakHour: peak, nowMs: Date.now(),   // the same clock as waited() / actualWaitMinutes
    });
    const byId = new Map(all.map((q) => [q.queueItemId, q]));
    const rowOf = (qid: string) => { const q = byId.get(qid)!; const r = this.toRow(ctx, q, all, cat, availTechs); r.waitLevel = floor.waitLevel[qid] ?? 'normal'; return r; };
    for (const r of pageRows) r.waitLevel = floor.waitLevel[r.queueItemId] ?? 'normal';
    const flow = { counts: floor.flowCounts, top: Object.fromEntries(Object.entries(floor.flowTop).map(([k, ids]) => [k, ids.map(rowOf)])) };
    const waitingByPriority = floor.priorityOrder.map(rowOf);
    const staff: QueueStaffRow[] = floor.staff; const insights: QueueInsight[] = floor.insights;
    const snap: Record<string, number> = { waiting: kpis.waitingGuests, walkIns: kpis.walkInsWaiting, vip: kpis.vipWaiting, readyForAssignment: kpis.readyForAssignment, estRevenue: kpis.estQueueRevenueCents, readyForService: kpis.readyForService, noShowRisk: kpis.noShowRisk };
    if (kpis.averageWaitMinutes != null) snap.avgWait = kpis.averageWaitMinutes;
    if (kpis.returnRatePercent != null) snap.returnRate = kpis.returnRatePercent;
    const kpiTrends = await new PosKpiSnapshots(this.db).snapshotAndTrends(ctx.tenantId, ctx.branchId, 'queue', snap, ['avgWait', 'noShowRisk']);
    return {
      kpis, kpiTrends, analytics, staff, insights, queue: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      flow, waitingByPriority, priorityCounts: floor.priorityCounts, staffSummary: floor.staffSummary,
      filters: {
        statuses: ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue', 'in_service', 'cancelled', 'removed'],
        sources: ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'], technicians: [...new Set(all.map((q) => q.assignedTechName || ''))].filter(Boolean),
        serviceCategories: [...new Set(cat.map((s) => s.categoryName))], priorityLevels: ['normal', 'high', 'vip', 'urgent'], stations: [...new Set(all.map((q) => q.station || ''))].filter(Boolean),
      },
      workflowSettings: this._settings(),
    };
  }

  async detail(ctx: QueueContext, id: string, opts?: QueueDetailOptions): Promise<POSQueueItemDetail | null> {
    const q = await this.loadOne(ctx, id); if (!q) return null;
    // M4: a batch (the board's Best Match for every waiting guest) shares the scope-wide reads instead of re-reading the
    // active queue, the catalog and the 200-technician roster once per guest
    const m = opts?.memo as { all?: QItem[]; cat?: SvcRec[]; techs?: TechRec[] } | undefined;
    const all = m ? (m.all ??= await this.loadAll(ctx)) : await this.loadAll(ctx);
    const cat = m ? (m.cat ??= await this._catalog(ctx)) : await this._catalog(ctx);
    const techs = m ? (m.techs ??= await this._techs(ctx)) : await this._techs(ctx);
    const tech = techs.find((t) => t.technicianId === q.assignedTechId);
    const cats = new Set(cat.filter((s) => q.services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    const eligible = !!tech && [...cats].every((c) => tech.skills.includes(c));
    // Customer Profile Preview enrichment (loyalty / visits / spend / birthday / preferred tech / notes).
    let email: string | undefined, loyaltyPoints: number | undefined, visitCount: number | undefined, totalSpendCents: number | undefined, birthday: string | null | undefined, preferredTechName: string | undefined, allergies: string | undefined;
    if (q.customerId && !opts?.lean) {
      const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', q.customerId).select(['email', 'birthday', 'preferred_technician_id', 'notes']).executeTakeFirst().catch(() => undefined);
      if (c) {
        email = c.email || undefined; birthday = c.birthday || undefined; allergies = c.notes || undefined;
        const ptid = c.preferred_technician_id;
        if (ptid) { const pt = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', ptid).select(['full_name']).executeTakeFirst().catch(() => undefined); preferredTechName = pt?.full_name || undefined; }
      }
      const lp = await this.scoped(this.db.selectFrom('customer_loyalty_profiles'), ctx).where('customer_id', '=', q.customerId).select(['points_balance']).executeTakeFirst().catch(() => undefined);
      if (lp) loyaltyPoints = Number(lp.points_balance || 0);
      const agg = await this.scoped(this.db.selectFrom('tickets'), ctx).where('customer_id', '=', q.customerId).where('paid_at', 'is not', null)
        .select([sql<number>`count(*)`.as('n'), sql<number>`coalesce(sum(total_cents),0)`.as('spend')]).executeTakeFirst().catch(() => undefined);
      if (agg) { visitCount = Number(agg.n || 0); totalSpendCents = Math.round(Number(agg.spend || 0)); }
    }
    // BUILD_PLAN Phase 6 (audit bug 1): requested + previous technician reach the engine. previous_technician_id is
    // stamped at check-in (migration 525); a row checked in before that falls back to computing it.
    const previousTechnicianId = q.previousTechId ?? (q.customerId ? await this.previousTechnicianFor(ctx, q.customerId) : null);
    const previousTechnicianName = previousTechnicianId ? (techs.find((t) => t.technicianId === previousTechnicianId)?.name ?? null) : null;
    const appointmentStartMs = q.appointmentId ? await this.appointmentStartMs(ctx.tenantId, q.appointmentId, q.branchId ?? null) : null;
    const lock = isUuid(id) ? await this.activeLock(ctx, id) : null;
    const serviceAssignments = await this.serviceAssignments(ctx, id);
    const lineIds = lineFields(q.assignedTechId, q.services, serviceAssignments.filter((a) => a.technicianId && a.status !== 'cancelled').map((a) => ({ serviceId: a.serviceId, technicianId: a.technicianId! }))).lineTechnicianIds;
    return {
      ...this.toRow(ctx, q, all, cat, techs.filter((t) => t.available).length, new Map(lock ? [[id, { technicianId: lock.technicianId, reason: lock.reason }]] : [])), technicianEligible: eligible, customerNotifiedAt: q.customerNotifiedAt, email, loyaltyPoints, visitCount, totalSpendCents, birthday, preferredTechName, allergies,
      auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: q.updatedAt }],
      previousTechnicianId, previousTechnicianName, lock, lateMinutes: q.lateMinutes ?? lateMinutesAt(q.checkedInAtMs, appointmentStartMs),
      appointmentStartAt: appointmentStartMs != null ? new Date(appointmentStartMs).toISOString() : null, serviceAssignments,
      ...(lineIds.length ? { lineTechnicianIds: lineIds, sharedVisit: lineIds.length >= 2 } : {}),
    };
  }
  /** appt_date + 'HH:MM' read in the BRANCH's zone (audit bug 2: 'HH:MM' was parsed as an instant → NaN). */
  private async appointmentStartMs(tenantId: string, appointmentId: string, branchId: string | null): Promise<number | null> {
    if (!isUuid(appointmentId)) return null;
    const a: any = await this.db.selectFrom('pos_tech_appointments').where('tenant_id', '=', tenantId).where('id', '=', appointmentId)
      .select([sql<string>`appt_date::text`.as('appt_date'), 'start_time', 'branch_id']).executeTakeFirst().catch(() => undefined);   // ::text — a DATE parsed into a JS Date shifts with the server's zone
    if (!a?.appt_date || !a?.start_time) return null;
    const tz = await branchTimeZone(this.db, tenantId, a.branch_id ?? branchId);
    const date = String(a.appt_date).slice(0, 10);
    const t = localDateTimeToEpochMs(date, String(a.start_time).slice(0, 5), tz);
    return Number.isFinite(t) ? t : null;
  }

  async create(ctx: QueueContext, item: QItem): Promise<POSQueueItemRow> {
    // Constitution 8 §18/§63: the queue row and queue.customer_joined commit together (this was a bare INSERT).
    // Customer Queue mandate §53/§76: one ACTIVE entry per appointment / identified walk-in (migration 503's unique
    // indexes). A second add for the same guest — a double tap, two devices — answers the entry that already exists
    // (duplicate: true) instead of a 500 from the unique violation.
    let newId: string;
    try { newId = await this.insertItem(ctx, item); }
    catch (e) {
      if (!isUniqueViolation(e)) throw e;
      let q = this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('status', 'not in', FINISHED).select('id');
      q = item.appointmentId ? q.where('appointment_id', '=', item.appointmentId) : q.where('appointment_id', 'is', null).where('customer_id', '=', item.customerId);
      const ex: { id: string } | undefined = await q.executeTakeFirst();
      if (!ex) throw e;
      const cur = (await this.loadOne(ctx, String(ex.id)))!; const all0 = await this.loadAll(ctx); const cat0 = await this._catalog(ctx); const techs0 = await this._techs(ctx);
      return Object.assign(this.toRow(ctx, cur, all0, cat0, techs0.filter((t) => t.available).length), { duplicate: true });
    }
    const q = (await this.loadOne(ctx, newId))!; const all = await this.loadAll(ctx); const cat = await this._catalog(ctx); const techs = await this._techs(ctx);
    return this.toRow(ctx, q, all, cat, techs.filter((t) => t.available).length);
  }
  private async insertItem(ctx: QueueContext, item: QItem): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const ins = await trx.insertInto('pos_queue_items').values({
        tenant_id: ctx.tenantId, branch_id: ctx.branchId, customer_id: item.customerId || null, customer_name: item.customerName, customer_phone: item.customerPhone || null, is_vip: item.isVip,
        source: item.source, appointment_id: item.appointmentId, ticket_id: item.ticketId, requested_services: JSON.stringify(item.services), priority: item.priority, status: item.status,
        assigned_technician_id: item.assignedTechId, requested_technician_id: item.requestedTechId || null, station: item.station || null, checked_in_at: new Date(item.checkedInAtMs).toISOString(), notes: item.notes || null,
      }).returning(['id']).executeTakeFirstOrThrow();
      const id = ins.id as string;
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.QUEUE_CUSTOMER_JOINED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'queue_item', aggregateId: id, actorId: ctx.userId, actorType: 'user',
        // §95: ids + queue facts only — never the guest's name or phone
        payload: { queueItemId: id, customerId: item.customerId || null, source: item.source, priority: item.priority, status: item.status, isVip: !!item.isVip, appointmentId: item.appointmentId ?? null, requestedTechnicianId: item.requestedTechId || null, serviceCount: (item.services || []).length } }));
      return id;
    });
  }

  // Materialize the queue item into the central `tickets` row (+ service lines) that serving/service-done/checkout read.
  // Multi-technician routing: ONE helper (visit-ticket.ts) — each line carries its LINE technician and the commission rule
  // resolved for them (it stamped the lead on every line); the visit's existing ticket is reused.
  async createTicketFromQueueItem(ctx: QueueContext, item: QItem): Promise<string> {
    return (await this.db.transaction().execute((trx) => ensureVisitTicket(trx, ctx, item.queueItemId))).ticketId;
  }
  // Walk-in with no pre-existing customer: create a real customers row (tickets.customer_id is NOT NULL) and return
  // its UUID. customerName is guaranteed non-empty by the service; split into first/last for the row.
  async createWalkInCustomer(ctx: QueueContext, customerName: string, customerPhone?: string): Promise<string> {
    const name = (customerName || '').trim();
    const sp = name.indexOf(' ');
    const firstName = sp === -1 ? name : name.slice(0, sp);
    const lastName = sp === -1 ? '' : name.slice(sp + 1).trim();
    const phone = (customerPhone || '').trim();
    const ins = await this.db.insertInto('customers').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, first_name: firstName, last_name: lastName, full_name: name,
      normalized_phone: toStoredCustomerPhone(phone), phone_display: phone || null, status: 'active',
    } as any).returning(['id']).executeTakeFirstOrThrow();
    return ins.id as string;
  }
  /** §63 / §343 — a generic queue-item change (details, services, priority, technician cleared, called) recorded with the
   *  write; BUILD_PLAN Phase 6: described (version + history by migration 525's trigger) and audited in the same transaction. */
  private async itemUpdated(ctx: QueueContext, run: (trx: any) => Promise<boolean>, id: string, reason: string, extra: Record<string, unknown> = {}, meta?: QueueWriteMeta): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      await this.describe(trx, ctx, meta);
      const ok = await run(trx);
      if (ok && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.QUEUE_ITEM_UPDATED, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined, aggregateType: 'queue_item', aggregateId: id, actorId: ctx.userId || undefined, actorType: ctx.system ? 'system' : 'user',
        payload: { queueItemId: id, reason, ...extra } }));
      if (ok && meta) await this.auditRow(trx, ctx, id, meta, undefined, extra);
      return ok;
    });
  }
  private n(res: any): number { return Number(res?.numUpdatedRows ?? 0); }
  async update(ctx: QueueContext, id: string, patch: Partial<QItem>): Promise<boolean> {
    const details: any = {};
    if (patch.customerName !== undefined) details.customer_name = patch.customerName; if (patch.customerPhone !== undefined) details.customer_phone = patch.customerPhone || null;
    if (patch.notes !== undefined) details.notes = patch.notes || null; if (patch.station !== undefined) details.station = patch.station || null;
    if (!Object.keys(details).length) return !!(await this.loadOne(ctx, id));
    details.updated_at = sql`now()`;
    // a details edit is not a queue transition: no version bump (a stale-version refusal over a phone-number edit would
    // be noise); the service audits it.
    return this.itemUpdated(ctx, async (trx) => this.n(await this.scoped(trx.updateTable('pos_queue_items'), ctx).set(details).where('id', '=', id).executeTakeFirst()) > 0, id, 'details');
  }
  async setStatus(ctx: QueueContext, id: string, st: QueueItemStatus, meta?: QueueWriteMeta): Promise<boolean> {
    const set: any = { status: st }; if (st === 'in_service') set.started_at = sql`now()`;
    // Phase 12 (#27): through the QUEUE_ITEM machine — 409 on a move it does not list (cancelling a completed visit, whose
    // cascade also cancelled the paid ticket; reviving a cancelled / removed guest) — and conditional on the status read,
    // so a concurrent writer gets 409 instead of a lost update. The cascades move only what their own machines allow.
    const before: any = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).select(['status']).where('id', '=', id).executeTakeFirst();
    if (before?.status) assertTransition(QUEUE_ITEM, before.status, st);
    // Constitution 8 §63: the status change and its past-tense fact commit together. in_service = the guest was
    // CALLED to a technician; cancelled / removed / moved_to_tech_queue = the guest LEFT this queue (moved_to_tech_queue
    // carries the reason so consumers can tell a hand-off from a walk-out).
    const eventType = st === 'in_service' ? DOMAIN_EVENTS.QUEUE_CUSTOMER_CALLED
      : (st === 'cancelled' || st === 'removed' || st === 'moved_to_tech_queue') ? DOMAIN_EVENTS.QUEUE_CUSTOMER_REMOVED : null;
    return this.db.transaction().execute(async (trx) => {
      await this.describe(trx, ctx, meta);
      const res: any = await this.scoped(trx.updateTable('pos_queue_items'), ctx).set(set).where('id', '=', id).where('status', '=', before?.status ?? st).where(canMoveToSql(QUEUE_ITEM, st)).returning(['appointment_id', 'branch_id', 'assigned_technician_id']).executeTakeFirst();
      const ok = !!res;
      if (!ok && before?.status) { const now: any = await this.scoped(trx.selectFrom('pos_queue_items'), ctx).select(['status']).where('id', '=', id).executeTakeFirst(); if (now) throw new InvalidStateTransitionError(QUEUE_ITEM, now.status, st, 'concurrent'); }
      // Developer (Sep 2026): the queue status cascades to the linked appointment and, on cancel, to the tech-queue
      // ticket and the checkout ticket — in the SAME transaction as the queue update and its event.
      const apptId = res?.appointment_id;
      if (ok && apptId) {
        const apptStatus = st === 'in_service' || (st as string) === 'serving' ? 'in_service' : st === 'cancelled' ? 'cancelled' : (st as string) === 'completed' || (st as string) === 'service_done' ? 'completed' : 'checked_in';
        await this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ status: apptStatus, updated_at: sql`now()` }).where('id', '=', apptId).where(canMoveToSql(APPOINTMENT, apptStatus)).executeTakeFirst().catch(() => undefined);
      }
      if (ok && st === 'cancelled') {
        await this.scoped(trx.updateTable('pos_tech_queue_tickets'), ctx).set({ status: 'cancelled', updated_at: sql`now()` }).where(canMoveToSql(TECH_QUEUE_TICKET, 'cancelled')).where((eb: any) => eb.or([eb('id', '=', id), eb('queue_item_id', '=', id), apptId ? eb('appointment_id', '=', apptId) : eb('id', '=', id)])).executeTakeFirst().catch(() => undefined);
        await this.scoped(trx.updateTable('tickets'), ctx).set({ status: 'cancelled', updated_at: sql`now()` }).where((eb: any) => eb.or([eb('id', '=', id), eb('queue_item_id', '=', id)])).executeTakeFirst().catch(() => undefined);
      }
      // Fair Turn Engine: a guest who left returns every provisional turn (CORRECTION); a start is the technicians' START
      if (ok && isUuid(id) && isUuid(res?.branch_id) && (st === 'cancelled' || st === 'removed')) await turnUnassign(trx, { tenantId: ctx.tenantId, branchId: res.branch_id, queueItemId: id, reason: `guest ${st}`, actor: this.turnActor(ctx) }, { outbox: this.outbox });
      if (ok && isUuid(id) && isUuid(res?.branch_id) && st === 'in_service') {
        const lineTechs: any[] = await trx.selectFrom('queue_service_assignments').select(['technician_id']).where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id).where('status', 'in', ['assigned', 'in_service']).where('technician_id', 'is not', null).execute();
        const techs = [...new Set([res.assigned_technician_id, ...lineTechs.map((l) => l.technician_id)].filter(isUuid))];
        if (techs.length) await turnServiceStart(trx, { tenantId: ctx.tenantId, branchId: res.branch_id, technicianIds: techs, queueItemId: id, actor: this.turnActor(ctx) }, { outbox: this.outbox });
      }
      // a guest who left the queue holds no assignment lock any more
      if (ok && (st === 'cancelled' || st === 'removed')) await trx.updateTable('queue_assignment_locks').set({ released_at: sql`now()`, release_reason: 'guest left the queue' })
        .where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id).where('released_at', 'is', null).execute();
      if (ok && eventType) await this.event(trx, ctx, eventType, id, { queueItemId: id, status: st, reason: st }, res?.branch_id);
      if (ok && meta) await this.auditRow(trx, ctx, id, meta, undefined, { status: st });
      return ok;
    });
  }
  async assign(ctx: QueueContext, id: string, technicianId: string, expect?: QueueAssignExpectation, meta?: QueueWriteMeta): Promise<boolean> {
    const t = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', technicianId).select('id').executeTakeFirst().catch(() => undefined);
    if (!t) return false;
    const cur = await this.loadOne(ctx, id); if (!cur) return false;
    const set: any = { assigned_technician_id: technicianId };
    if (cur.status === 'waiting' || cur.status === 'called') { assertTransition(QUEUE_ITEM, cur.status, 'assigned'); set.status = 'assigned'; }
    // §18: the UPDATE and its queue.customer_assigned event commit together (this was a bare UPDATE before).
    try {
      return await this.db.transaction().execute(async (trx) => {
        await this.describe(trx, ctx, meta);
        let q = this.scoped(trx.updateTable('pos_queue_items'), ctx).set(set).where('id', '=', id);
        // Phase 12 (#27): the waiting → assigned move is conditional on the status read (QUEUE_ITEM machine)
        if (set.status) q = q.where('status', '=', cur.status).where(canMoveToSql(QUEUE_ITEM, set.status));
        // Smooth Refresh spec §77/§106: compare-and-set on what the caller read. Two receptionists assigning the same
        // waiting guest used to BOTH succeed (last write won) and BOTH technicians got the assignment event + push.
        // BUILD_PLAN Phase 6: + the version the caller read (a recommendation's queueVersion).
        if (expect) q = q.where('status', '=', expect.status).where(sql<boolean>`assigned_technician_id is not distinct from ${expect.technicianId}`);
        if (expect?.version != null) q = q.where('version', '=', expect.version);
        const res: any = await q.returning(['version', 'branch_id']).executeTakeFirst();
        const ok = !!res;
        if (!ok && expect) {
          const now: any = await this.scoped(trx.selectFrom('pos_queue_items'), ctx).select(['assigned_technician_id', 'version']).where('id', '=', id).executeTakeFirst();
          if (now) throw new QueueAssignmentConflict(now.assigned_technician_id ?? null, now.version != null ? Number(now.version) : null);
        }
        if (ok) {
          await this.undescribe(trx);
          await this.event(trx, ctx, DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED, id,
            { queueItemId: id, technicianId, previousTechnicianId: cur.assignedTechId ?? null, previousStatus: cur.status, status: set.status ?? cur.status, customerId: cur.customerId ?? null, source: meta?.source ?? 'staff', version: Number(res.version) }, res.branch_id);
          if (meta) await this.auditRow(trx, ctx, id, meta, { technicianId: cur.assignedTechId ?? null, status: cur.status, version: cur.version ?? null }, { technicianId, status: set.status ?? cur.status, version: Number(res.version) });
          // Fair Turn Engine (§82–83): the technician turn queue moves in THIS transaction — the previous technician's
          // provisional turn comes back (CORRECTION), the new one is recorded with its units snapshot, skips and pool
          if (cur.assignedTechId && cur.assignedTechId !== technicianId) await turnUnassign(trx, { tenantId: ctx.tenantId, branchId: res.branch_id, queueItemId: id, technicianId: cur.assignedTechId, reason: meta?.reason ?? 'reassigned', actor: this.turnActor(ctx) }, { outbox: this.outbox });
          await turnAssign(trx, { tenantId: ctx.tenantId, branchId: res.branch_id, technicianId, queueItemId: id, source: String(meta?.source ?? 'staff'),
            recommendedTechnicianId: meta?.turn?.recommendedTechnicianId ?? null, overrideReasonCode: meta?.turn?.overrideReasonCode ?? null, reasonText: meta?.reason ?? null,
            eligiblePool: meta?.turn?.eligiblePool ?? null, skips: (meta?.turn?.skips ?? null) as { technicianId: string; reason: SkipReason }[] | null,
            idempotencyKey: meta?.idempotencyKey ? `turn:${meta.idempotencyKey}` : null, actor: this.turnActor(ctx) }, { outbox: this.outbox });
        }
        return ok;
      });
    } catch (e) {
      // the same idempotency key already wrote its assignment (a retry racing the first call): nothing more is written
      if (meta?.idempotencyKey && isUniqueViolation(e)) throw new QueueIdempotentReplay(id);
      throw e;
    }
  }
  private turnActor(ctx: QueueContext): TurnActor { return { userId: ctx.system ? null : (isUuid(ctx.userId) ? ctx.userId : null), type: ctx.system ? 'system' : 'user' }; }
  async setRequestedTechnician(ctx: QueueContext, id: string, technicianId: string | null, meta?: QueueWriteMeta): Promise<boolean> {
    if (technicianId) { const t = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', technicianId).select('id').executeTakeFirst().catch(() => undefined); if (!t) return false; }
    return this.itemUpdated(ctx, async (trx) => this.n(await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ requested_technician_id: technicianId }).where('id', '=', id).executeTakeFirst()) > 0,
      id, 'requested_technician', { requestedTechnicianId: technicianId }, meta);
  }
  async unassign(ctx: QueueContext, id: string, meta?: QueueWriteMeta, expect?: QueueAssignExpectation): Promise<boolean> {
    const cur = await this.loadOne(ctx, id); if (!cur) return false;
    const set: any = { assigned_technician_id: null };
    if (cur.status === 'assigned' || cur.status === 'ready_for_tech') { assertTransition(QUEUE_ITEM, cur.status, 'waiting'); set.status = 'waiting'; }
    return this.itemUpdated(ctx, async (trx) => {
      let q = this.scoped(trx.updateTable('pos_queue_items'), ctx).set(set).where('id', '=', id);
      if (set.status) q = q.where('status', '=', cur.status).where(canMoveToSql(QUEUE_ITEM, 'waiting'));   // Phase 12 (#27)
      // round 2 (the ops repair path): compare-and-set on the assignee / version the caller read
      if (expect) q = q.where(sql<boolean>`assigned_technician_id is not distinct from ${expect.technicianId}`);
      if (expect?.version != null) q = q.where('version', '=', expect.version);
      const ok = this.n(await q.executeTakeFirst()) > 0;
      if (!ok && expect) {
        const now: any = await this.scoped(trx.selectFrom('pos_queue_items'), ctx).select(['assigned_technician_id', 'version']).where('id', '=', id).executeTakeFirst();
        if (now) throw new QueueAssignmentConflict(now.assigned_technician_id ?? null, now.version != null ? Number(now.version) : null);
      }
      // Fair Turn Engine: the provisional turn of every technician on this guest comes back (CORRECTION, history kept)
      if (ok && isUuid(id) && isUuid(cur.branchId ?? ctx.branchId)) await turnUnassign(trx, { tenantId: ctx.tenantId, branchId: cur.branchId ?? ctx.branchId, queueItemId: id, reason: meta?.reason ?? 'unassigned', actor: this.turnActor(ctx) }, { outbox: this.outbox });
      // multi-technician routing: the visit's planned lines go back to "nobody yet" with it (not a started / finished line)
      if (ok && isUuid(id)) await trx.updateTable('queue_service_assignments').set({ technician_id: null, status: 'pending', version: sql`version + 1`, tech_queue_ticket_id: null, updated_at: sql`now()` })
        .where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id).where('status', '=', 'assigned').where(canMoveToSql(QUEUE_SERVICE_ASSIGNMENT, 'pending', 'queue_service_assignments')).execute();
      return ok;
    }, id, 'technician_cleared', { previousTechnicianId: cur.assignedTechId ?? null }, meta);
  }
  async setServices(ctx: QueueContext, id: string, services: QueueRequestedService[], meta?: QueueWriteMeta): Promise<boolean> {
    return this.itemUpdated(ctx, async (trx) => {
      const ok = this.n(await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ requested_services: JSON.stringify(services) }).where('id', '=', id).executeTakeFirst()) > 0;
      // multi-technician routing: a service taken off the visit takes its planned line with it (cancelled, same transaction)
      const keep = services.map((x) => x.serviceId).filter(isUuid);
      if (ok && isUuid(id)) {
        let u = trx.updateTable('queue_service_assignments').set({ status: 'cancelled', version: sql`version + 1`, updated_at: sql`now()` })
          .where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id).where('status', 'in', ['pending', 'assigned']).where(canMoveToSql(QUEUE_SERVICE_ASSIGNMENT, 'cancelled', 'queue_service_assignments'));
        if (keep.length) u = u.where('service_id', 'not in', keep);
        await u.execute();
      }
      return ok;
    }, id, 'services', {}, meta);
  }
  async setPriority(ctx: QueueContext, id: string, priority: QueuePriority, meta?: QueueWriteMeta): Promise<boolean> {
    return this.itemUpdated(ctx, async (trx) => this.n(await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ priority }).where('id', '=', id).executeTakeFirst()) > 0, id, 'priority', { priority }, meta);
  }
  async markCalled(ctx: QueueContext, id: string, meta?: QueueWriteMeta): Promise<boolean> {
    // Phase 12 (#27): calling a guest is a QUEUE_ITEM move — a cancelled / removed / completed guest is not called back
    // into the queue (409), and the write is conditional on the status read
    const cur: any = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).select(['status']).where('id', '=', id).executeTakeFirst();
    if (cur?.status) assertTransition(QUEUE_ITEM, cur.status, 'called');
    return this.itemUpdated(ctx, async (trx) => this.n(await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ status: 'called', called_at: sql`now()` }).where('id', '=', id).where('status', '=', cur?.status ?? 'waiting').where(canMoveToSql(QUEUE_ITEM, 'called')).executeTakeFirst()) > 0, id, 'called', {}, meta);
  }
  async markNotified(ctx: QueueContext, id: string): Promise<void> {
    await this.scoped(this.db.updateTable('pos_queue_items'), ctx).set({ customer_notified_at: sql`now()` }).where('id', '=', id).executeTakeFirst();
  }
  async waitEstimate(ctx: QueueContext) {
    const settings = this._settings();
    if (settings.waitEstimateBasis === 'manual') return { configured: false, basis: 'manual', reason: 'Estimate unavailable — wait estimate is set to manual.' };
    const all = await this.loadAll(ctx); const cat = await this._catalog(ctx); const techs = await this._techs(ctx);
    const active = all.filter((q) => ACTIVE.includes(q.status)).length; const availTechs = techs.filter((t) => t.available).length;
    return { configured: true, quotedWaitMinutes: estimateWaitMinutes(active, this.avgServiceMin(cat), availTechs), basis: settings.waitEstimateBasis };
  }
  // Customer Queue mandate §53/§55: the move keys are the persisted columns (migration 026, unique per tenant) — they were
  // in-process Maps, so a restart, or a second API replica, forgot that a guest had already been started
  async getServingKey(ctx: QueueContext, id: string) { if (!isUuid(id)) return undefined; const r: { serving_idempotency_key: string | null } | undefined = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', id).select('serving_idempotency_key').executeTakeFirst(); return r?.serving_idempotency_key || undefined; }
  async setServingKey(ctx: QueueContext, id: string, key: string) { if (!isUuid(id)) return; await this.scoped(this.db.updateTable('pos_queue_items'), ctx).set({ serving_idempotency_key: key }).where('id', '=', id).where((eb: any) => eb.or([eb('serving_idempotency_key', 'is', null), eb('serving_idempotency_key', '=', key)])).executeTakeFirst(); }
  async getTechQueueKey(ctx: QueueContext, id: string) { if (!isUuid(id)) return undefined; const r: { tech_queue_idempotency_key: string | null } | undefined = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', id).select('tech_queue_idempotency_key').executeTakeFirst(); return r?.tech_queue_idempotency_key || undefined; }
  async setTechQueueKey(ctx: QueueContext, id: string, key: string) { if (!isUuid(id)) return; await this.scoped(this.db.updateTable('pos_queue_items'), ctx).set({ tech_queue_idempotency_key: key }).where('id', '=', id).where((eb: any) => eb.or([eb('tech_queue_idempotency_key', 'is', null), eb('tech_queue_idempotency_key', '=', key)])).executeTakeFirst(); }

  // ==== BUILD_PLAN Phase 6 — the shared queue state model ====
  async activeEntries(ctx: QueueContext): Promise<QueueActiveEntry[]> {
    // ALL active entries, in service included (audit bug 4: the scan / workload saw a 20-row board page)
    const rows: any[] = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('status', 'not in', FINISHED)
      .select(ITEM_COLS).orderBy('checked_in_at', 'asc').execute();
    if (!rows.length) return [];
    const ids = rows.map((r) => String(r.id));
    const lockRows: any[] = await this.db.selectFrom('queue_assignment_locks').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', 'in', ids).where('released_at', 'is', null)
      .where((eb: any) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql`now()`)])).select(['queue_item_id', 'technician_id', 'reason']).execute();
    const lockBy = new Map(lockRows.map((l) => [String(l.queue_item_id), { technicianId: l.technician_id ?? null, reason: String(l.reason) }]));
    const groupIds = [...new Set(rows.map((r) => r.group_id).filter(Boolean))];
    const groupRows: any[] = groupIds.length ? await this.db.selectFrom('queue_groups').where('tenant_id', '=', ctx.tenantId).where('id', 'in', groupIds).select(['id', 'size']).execute() : [];
    const sizeBy = new Map(groupRows.map((g) => [String(g.id), Number(g.size)]));
    // multi-technician routing: the technicians holding a not-finished line of each visit (capacity counts them too)
    const lineRows: any[] = await this.db.selectFrom('queue_service_assignments').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', 'in', ids.filter(isUuid).length ? ids.filter(isUuid) : ['00000000-0000-0000-0000-000000000000'])
      .where('status', 'in', ['pending', 'assigned', 'in_service']).where('technician_id', 'is not', null).select(['queue_item_id', 'service_id', 'technician_id']).execute();
    const linesBy = new Map<string, { serviceId: string; technicianId: string }[]>();
    for (const l of lineRows) { const k = String(l.queue_item_id); if (!linesBy.has(k)) linesBy.set(k, []); linesBy.get(k)!.push({ serviceId: String(l.service_id), technicianId: String(l.technician_id) }); }
    const apptIds = [...new Set(rows.map((r) => r.appointment_id).filter(isUuid))];
    const apptRows: any[] = apptIds.length ? await this.db.selectFrom('pos_tech_appointments').where('tenant_id', '=', ctx.tenantId).where('id', 'in', apptIds)
      .select(['id', sql<string>`appt_date::text`.as('d'), 'start_time', 'branch_id']).execute().catch(() => []) : [];
    const startBy = new Map<string, number>();
    for (const a of apptRows) {
      if (!a.d || !a.start_time) continue;
      const tz = await branchTimeZone(this.db, ctx.tenantId, a.branch_id ?? null);
      const t = localDateTimeToEpochMs(String(a.d).slice(0, 10), String(a.start_time).slice(0, 5), tz);   // the BRANCH's wall clock (audit bug 2)
      if (Number.isFinite(t)) startBy.set(String(a.id), t);
    }
    return rows.map((r) => {
      const q = this.rowToQItem(r, null);
      const apptStart = q.appointmentId ? startBy.get(q.appointmentId) ?? null : null;
      return {
        queueItemId: q.queueItemId, branchId: q.branchId ?? null, version: q.version ?? 1, status: q.status, customerId: q.customerId || null, customerName: q.customerName,
        isVip: q.isVip || q.priority === 'vip', source: q.source, appointmentId: q.appointmentId, services: q.services, assignedTechId: q.assignedTechId,
        requestedTechId: q.requestedTechId ?? null, previousTechId: q.previousTechId ?? null, groupId: q.groupId ?? null, groupSize: q.groupId ? sizeBy.get(q.groupId) ?? null : null,
        position: q.position ?? null, lateMinutes: q.lateMinutes ?? lateMinutesAt(q.checkedInAtMs, apptStart), checkedInAtMs: q.checkedInAtMs, startedAtMs: q.startedAtMs,
        updatedAt: q.updatedAt, appointmentStartMs: apptStart, lock: lockBy.get(q.queueItemId) ?? null,
        ...lineFields(q.assignedTechId, q.services, linesBy.get(q.queueItemId) ?? []),
      };
    });
  }

  async techSignals(ctx: QueueContext, entries?: QueueActiveEntry[]): Promise<TechSignalRow[]> {
    const es = entries ?? await this.activeEntries(ctx);
    const techs = await this._techs(ctx); if (!techs.length) return [];
    const ids = techs.map((t) => t.technicianId);
    const clock = await this.branchClock(ctx.tenantId, ctx.branchId || null);
    const dow = new Date(clock.date + 'T00:00:00Z').getUTCDay();
    const [statRows, schedRows, punchRows, blockRows, apptRows, tqRows, servedRows, ticketServedRows, rotRow] = await Promise.all([
      this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', ids).select(['technician_id', 'status']).orderBy('changed_at', 'asc').execute().catch(() => []),
      this.scoped(this.db.selectFrom('technician_schedules'), ctx).where('technician_id', 'in', ids).where('day_of_week', '=', dow)
        .select(['technician_id', sql<string>`start_time::text`.as('s'), sql<string>`end_time::text`.as('e'), sql<string>`lunch_start_time::text`.as('ls'), sql<string>`lunch_end_time::text`.as('le'), 'is_working']).execute().catch(() => []),
      this.scoped(this.db.selectFrom('technician_shifts'), ctx).where('technician_id', 'in', ids).where(sql<boolean>`shift_date = ${clock.date}::date`).select(['technician_id', 'start_time', 'end_time', 'status']).execute().catch(() => []),
      this.scoped(this.db.selectFrom('technician_blocked_times'), ctx).where('technician_id', 'in', ids).where(sql<boolean>`block_date = ${clock.date}::date`).select(['technician_id', 'start_time', 'end_time']).execute().catch(() => []),
      this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('technician_id', 'in', ids).where(sql<boolean>`appt_date = ${clock.date}::date`).select(['technician_id', 'start_time', 'status']).execute().catch(() => []),
      // a service started from the Tech Queue without a queue row of its own (the queue rows are counted from `es`)
      this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('assigned_technician_id', 'in', ids).where('status', '=', 'in_service').where('queue_item_id', 'is', null)
        .select(['assigned_technician_id', 'started_at', 'requested_services']).execute().catch(() => []),
      this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('assigned_technician_id', 'in', ids).where('started_at', '>=', new Date(clock.dayStartMs))
        .select(['assigned_technician_id', sql<string>`max(started_at)`.as('last')]).groupBy('assigned_technician_id').execute().catch(() => []),
      this.scoped(this.db.selectFrom('tickets'), ctx).where('primary_technician_id', 'in', ids).where('serving_started_at', '>=', new Date(clock.dayStartMs))
        .select(['primary_technician_id', sql<string>`max(serving_started_at)`.as('last')]).groupBy('primary_technician_id').execute().catch(() => []),
      ctx.branchId ? this.db.selectFrom('queue_assignment_rotation_state').where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', ctx.branchId).select(['fixed_order']).executeTakeFirst().catch(() => undefined) : Promise.resolve(undefined),
    ]);
    const statusBy: Record<string, string> = {}; for (const r of statRows) statusBy[r.technician_id] = r.status;
    const schedBy: Record<string, any> = {}; for (const r of schedRows) schedBy[r.technician_id] = { start: r.s, end: r.e, lunchStart: r.ls, lunchEnd: r.le, isWorking: !!r.is_working };
    const punchBy: Record<string, any> = {}; for (const r of punchRows) punchBy[r.technician_id] = { startMs: r.start_time ? ms(r.start_time) : null, endMs: r.end_time ? ms(r.end_time) : null, status: r.status ?? null };
    const blocksBy: Record<string, { start: string; end: string }[]> = {}; for (const r of blockRows) (blocksBy[r.technician_id] ||= []).push({ start: r.start_time, end: r.end_time });
    const apptsBy: Record<string, { start: string; status: string }[]> = {}; for (const r of apptRows) (apptsBy[r.technician_id] ||= []).push({ start: String(r.start_time), status: String(r.status) });
    const tqBy: Record<string, { startedAtMs: number; durationMinutes: number }[]> = {};
    for (const r of tqRows) if (r.started_at) (tqBy[r.assigned_technician_id] ||= []).push({ startedAtMs: ms(r.started_at), durationMinutes: durationOf(parseSvcs(r.requested_services)) });
    const lastBy: Record<string, number> = {};
    for (const r of [...servedRows, ...ticketServedRows]) { const id = r.assigned_technician_id ?? r.primary_technician_id; const t = r.last ? ms(r.last) : 0; if (id && t > (lastBy[id] ?? 0)) lastBy[id] = t; }
    const fixed = Array.isArray(rotRow?.fixed_order) ? (rotRow.fixed_order as unknown[]).map(String) : (typeof rotRow?.fixed_order === 'string' ? (JSON.parse(rotRow.fixed_order) as unknown[]).map(String) : []);
    const rot = rotationOrder(techs.map((t) => ({ technicianId: t.technicianId, name: t.name, lastServedAtMs: lastBy[t.technicianId] ?? null })), fixed);
    return techs.map((t) => {
      // multi-technician routing: a technician holds a slot on every active visit where they are the lead OR hold a
      // not-finished line — once per visit, however many lines — and their minutes are their OWN lines' minutes
      const mine = es.filter((e) => holdsSlot(e, t.technicianId));
      const inService = [
        ...mine.filter((e) => e.status === 'in_service' && e.startedAtMs != null).map((e) => ({ startedAtMs: e.startedAtMs as number, durationMinutes: minutesFor(e, t.technicianId) })),
        ...(tqBy[t.technicianId] || []),
      ];
      const signals = computeTechSignals({ technicianId: t.technicianId, liveStatus: statusBy[t.technicianId] ?? null, schedule: schedBy[t.technicianId] ?? null, punch: punchBy[t.technicianId] ?? null,
        blocks: blocksBy[t.technicianId] || [], appointments: apptsBy[t.technicianId] || [], inService, rosterActive: t.rosterActive }, clock.nowMinutes, clock.nowMs);
      return {
        technicianId: t.technicianId, name: t.name, branchId: t.branchId, available: t.available, skills: t.skills,
        activeAssignments: mine.length + (tqBy[t.technicianId]?.length ?? 0),
        assignedMinutes: assignedMinutesFor(mine.map((e) => ({ status: e.status, durationMinutes: minutesFor(e, t.technicianId), startedAtMs: e.startedAtMs })), clock.nowMs)
          + (tqBy[t.technicianId] || []).reduce((n, x) => n + Math.max(0, Math.ceil((x.startedAtMs + x.durationMinutes * 60000 - clock.nowMs) / 60000)), 0),
        rotationIndex: rot[t.technicianId] ?? null, lastServedAt: lastBy[t.technicianId] ? new Date(lastBy[t.technicianId]).toISOString() : null, signals,
      };
    });
  }

  async previousTechnicianFor(ctx: QueueContext, customerId: string): Promise<string | null> {
    if (!isUuid(customerId)) return null;
    const r: any = await this.db.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', customerId).where('primary_technician_id', 'is not', null)
      .where((eb: any) => eb.or([eb('service_done_at', 'is not', null), eb('paid_at', 'is not', null)])).where('status', 'not in', ['cancelled', 'canceled', 'void', 'voided', 'removed'])
      .select(['primary_technician_id']).orderBy(sql`coalesce(service_done_at, paid_at)`, 'desc').limit(1).executeTakeFirst().catch(() => undefined);
    return r?.primary_technician_id ?? null;
  }
  async idempotentAssignment(ctx: QueueContext, key: string) {
    const r: any = await this.db.selectFrom('pos_queue_status_history').where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', key)   // column: migration 525
      .select(['queue_item_id', 'to_technician', 'version']).executeTakeFirst();
    return r ? { queueItemId: String(r.queue_item_id), technicianId: r.to_technician ?? null, version: Number(r.version) } : null;
  }
  async history(ctx: QueueContext, id: string): Promise<QueueHistoryRow[]> {
    if (!isUuid(id)) return [];
    const rows: any[] = await this.db.selectFrom('pos_queue_status_history').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id)
      .select(['version', 'from_status', 'to_status', 'from_technician', 'to_technician', 'action', 'source', 'actor_id', 'reason', 'created_at']).orderBy('created_at', 'asc').orderBy('version', 'asc').execute();
    return rows.map((r) => ({ version: Number(r.version), fromStatus: r.from_status ?? null, toStatus: r.to_status, fromTechnicianId: r.from_technician ?? null, toTechnicianId: r.to_technician ?? null,
      action: r.action, source: r.source, actorId: r.actor_id ?? null, reason: r.reason ?? null, createdAt: new Date(r.created_at).toISOString() }));
  }
  private lockView(r: any, names: Record<string, string> = {}): QueueItemLock {
    return { lockId: String(r.id), technicianId: r.technician_id ?? null, technicianName: r.technician_id ? names[r.technician_id] ?? null : null, reason: r.reason, lockedBy: r.locked_by ?? null,
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() };
  }
  private async techNames(ctx: QueueContext): Promise<Record<string, string>> { const o: Record<string, string> = {}; for (const t of await this._techs(ctx)) o[t.technicianId] = t.name; return o; }
  async activeLock(ctx: QueueContext, id: string): Promise<QueueItemLock | null> {
    if (!isUuid(id)) return null;
    const r: any = await this.db.selectFrom('queue_assignment_locks').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id).where('released_at', 'is', null)
      .where((eb: any) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', sql`now()`)])).selectAll().executeTakeFirst();
    return r ? this.lockView(r, await this.techNames(ctx)) : null;
  }
  async lock(ctx: QueueContext, id: string, req: LockQueueItemRequest, meta: QueueWriteMeta): Promise<QueueItemLock> {
    const row: any = await this.db.transaction().execute(async (trx) => {
      const item: any = await this.scoped(trx.selectFrom('pos_queue_items'), ctx).where('id', '=', id).select(['id', 'branch_id', 'status']).forUpdate().executeTakeFirst();
      if (!item) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND');
      const branchId = item.branch_id ?? (isUuid(ctx.branchId) ? ctx.branchId : null);
      if (!branchId) throw withCode(new QueueRuleError('Choose a location first — this guest has no branch.'), 'GUEST_NO_BRANCH');
      // one active lock per guest (unique index): the new one replaces an old or expired one
      await trx.updateTable('queue_assignment_locks').set({ released_at: sql`now()`, released_by: isUuid(ctx.userId) ? ctx.userId : null, release_reason: 'replaced by a new lock' })
        .where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id).where('released_at', 'is', null).execute();
      const ins: any = await trx.insertInto('queue_assignment_locks').values({
        tenant_id: ctx.tenantId, branch_id: branchId, queue_item_id: id, technician_id: req.technicianId ?? null, reason: req.reason, locked_by: isUuid(ctx.userId) ? ctx.userId : null,
        expires_at: req.expiresInMinutes ? sql`now() + (${Math.round(req.expiresInMinutes)} * interval '1 minute')` : null,
      }).returningAll().executeTakeFirstOrThrow();
      await this.describe(trx, ctx, meta);
      await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ updated_at: sql`now()` }).where('id', '=', id).execute();   // the trigger bumps the version + writes history
      await this.event(trx, ctx, DOMAIN_EVENTS.QUEUE_ASSIGNMENT_LOCKED, id, { queueItemId: id, lockId: String(ins.id), technicianId: req.technicianId ?? null, expiresAt: ins.expires_at ? new Date(ins.expires_at).toISOString() : null }, branchId);
      await this.auditRow(trx, ctx, id, meta, undefined, { technicianId: req.technicianId ?? null, expiresInMinutes: req.expiresInMinutes ?? null });
      return ins;
    });
    return this.lockView(row, await this.techNames(ctx));
  }
  async unlock(ctx: QueueContext, id: string, reason: string, meta: QueueWriteMeta): Promise<boolean> {
    if (!isUuid(id)) return false;
    return this.db.transaction().execute(async (trx) => {
      const rel: any[] = await trx.updateTable('queue_assignment_locks').set({ released_at: sql`now()`, released_by: isUuid(ctx.userId) ? ctx.userId : null, release_reason: reason })
        .where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id).where('released_at', 'is', null).returning(['id', 'branch_id', 'technician_id']).execute();
      if (!rel.length) return false;
      await this.describe(trx, ctx, meta);
      await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ updated_at: sql`now()` }).where('id', '=', id).execute();
      await this.event(trx, ctx, DOMAIN_EVENTS.QUEUE_ASSIGNMENT_UNLOCKED, id, { queueItemId: id, lockId: String(rel[0].id), technicianId: rel[0].technician_id ?? null }, rel[0].branch_id);
      await this.auditRow(trx, ctx, id, meta, { technicianId: rel[0].technician_id ?? null }, undefined);
      return true;
    });
  }
  async reorder(ctx: QueueContext, order: { queueItemId: string; expectedVersion?: number }[], meta: QueueWriteMeta) {
    return this.db.transaction().execute(async (trx) => {
      await this.describe(trx, ctx, meta);
      const out: { queueItemId: string; position: number; version: number }[] = [];
      let branchId: string | null = null;
      for (let i = 0; i < order.length; i++) {
        const o = order[i];
        if (!isUuid(o.queueItemId)) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND');
        let q = this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ position: i + 1 }).where('id', '=', o.queueItemId).where('status', 'not in', FINISHED);
        if (o.expectedVersion != null) q = q.where('version', '=', o.expectedVersion);
        const r: any = await q.returning(['version', 'branch_id']).executeTakeFirst();
        if (!r) {
          const now: any = await this.scoped(trx.selectFrom('pos_queue_items'), ctx).where('id', '=', o.queueItemId).select(['assigned_technician_id', 'version', 'status']).executeTakeFirst();
          if (!now || FINISHED.includes(now.status)) throw withCode(new QueueRuleError('A guest in this order is no longer in the queue. Refresh and try again.'), 'PLAN_GUEST_NOT_IN_QUEUE');
          throw withCode(new QueueAssignmentConflict(now.assigned_technician_id ?? null, Number(now.version), 'The queue changed on another device. Refresh and drag again.'), 'QUEUE_CHANGED_ELSEWHERE');   // all or nothing
        }
        branchId = branchId ?? r.branch_id ?? null;
        out.push({ queueItemId: o.queueItemId, position: i + 1, version: Number(r.version) });
      }
      await this.event(trx, ctx, DOMAIN_EVENTS.QUEUE_REORDERED, out[0]?.queueItemId ?? 'none', { order: out.map((x) => x.queueItemId) }, branchId);
      await this.auditRow(trx, ctx, null, meta, undefined, { order: out });
      return out;
    });
  }
  async createGroup(ctx: QueueContext, req: CreateQueueGroupRequest, meta: QueueWriteMeta): Promise<QueueGroupView> {
    const groupId: string = await this.db.transaction().execute(async (trx) => {
      if (req.queueItemIds.some((id) => !isUuid(id))) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND');
      const items: any[] = await this.scoped(trx.selectFrom('pos_queue_items'), ctx).where('id', 'in', req.queueItemIds).select(['id', 'branch_id', 'status', 'group_id']).forUpdate().execute();
      if (items.length !== req.queueItemIds.length) throw withCode(new QueueRuleError('A guest in this party is not in the queue.'), 'PLAN_GUEST_NOT_IN_QUEUE');
      if (items.some((i) => FINISHED.includes(i.status) || i.status === 'in_service')) throw withCode(new QueueRuleError('Only waiting guests can be grouped into a party.'), 'PARTY_WAITING_ONLY');
      if (items.some((i) => i.group_id)) throw withCode(new QueueRuleError('A guest in this party already belongs to another party.'), 'PARTY_GUEST_IN_OTHER_PARTY');
      const branches = new Set(items.map((i) => i.branch_id ?? ''));
      const branchId = items[0].branch_id ?? (isUuid(ctx.branchId) ? ctx.branchId : null);
      if (branches.size !== 1 || !branchId) throw withCode(new QueueRuleError('A party must check in at one location.'), 'PARTY_ONE_LOCATION');
      const g: any = await trx.insertInto('queue_groups').values({ tenant_id: ctx.tenantId, branch_id: branchId, label: req.label, size: items.length, together: req.together !== false, created_by: isUuid(ctx.userId) ? ctx.userId : null })
        .returning(['id']).executeTakeFirstOrThrow();
      await this.describe(trx, ctx, meta);
      await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ group_id: g.id }).where('id', 'in', req.queueItemIds).execute();
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.QUEUE_GROUP_CREATED, tenantId: ctx.tenantId, branchId, aggregateType: 'queue_group', aggregateId: String(g.id),
        actorId: ctx.userId || undefined, actorType: ctx.system ? 'system' : 'user', payload: { groupId: String(g.id), queueItemIds: req.queueItemIds, size: items.length, together: req.together !== false } }));
      await this.auditRow(trx, ctx, null, meta, undefined, { groupId: String(g.id), queueItemIds: req.queueItemIds });
      return String(g.id);
    });
    return (await this.groupViews(ctx, [groupId]))[0];
  }
  private async groupViews(ctx: QueueContext, onlyIds?: string[]): Promise<QueueGroupView[]> {
    let q = this.scoped(this.db.selectFrom('queue_groups'), ctx).where('status', 'in', ['waiting', 'in_service']);
    if (onlyIds) q = q.where('id', 'in', onlyIds);
    const groups: any[] = await q.select(['id', 'label', 'size', 'together', 'status', 'created_at']).orderBy('created_at', 'asc').execute();
    if (!groups.length) return [];
    const members: any[] = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('group_id', 'in', groups.map((g) => g.id))
      .select(['id', 'group_id', 'customer_name', 'status', 'assigned_technician_id']).orderBy('checked_in_at', 'asc').execute();
    const names = await this.techNames(ctx);
    return groups.map((g) => {
      const m = members.filter((x) => String(x.group_id) === String(g.id));
      // the party's state follows its guests (nobody had to remember to close the group row)
      const status = m.length && m.every((x) => FINISHED.includes(x.status)) ? 'done' : m.some((x) => x.status === 'in_service') ? 'in_service' : 'waiting';
      return { groupId: String(g.id), label: g.label, size: Number(g.size), together: !!g.together, status, createdAt: new Date(g.created_at).toISOString(),
        members: m.map((x) => ({ queueItemId: String(x.id), customerName: x.customer_name || '', status: x.status, assignedTechnicianId: x.assigned_technician_id ?? null, assignedTechnicianName: x.assigned_technician_id ? names[x.assigned_technician_id] ?? null : null })) };
    }).filter((g) => g.status !== 'done');
  }
  async groups(ctx: QueueContext): Promise<QueueGroupView[]> { return this.groupViews(ctx); }
  async serviceAssignments(ctx: QueueContext, id: string): Promise<QueueServiceAssignmentView[]> {
    if (!isUuid(id)) return [];
    const rows: any[] = await this.db.selectFrom('queue_service_assignments').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', '=', id)
      .select(['service_id', 'technician_id', 'status', 'sequence', 'version', 'timing', 'after_service_id', 'planned_start_offset_min', 'tech_queue_ticket_id', 'started_at', 'completed_at'])
      .orderBy('sequence', 'asc').execute().catch(() => []);
    if (!rows.length) return [];
    const item: any = await this.db.selectFrom('pos_queue_items').where('tenant_id', '=', ctx.tenantId).where('id', '=', id).select(['requested_services']).executeTakeFirst();
    const svcs = parseSvcs(item?.requested_services); const names = await this.techNames(ctx);
    const isoOrNull = (v: any) => (v ? new Date(v).toISOString() : null);
    return rows.map((r) => ({ serviceId: String(r.service_id), serviceName: svcs.find((s) => s.serviceId === String(r.service_id))?.serviceName ?? '', technicianId: r.technician_id ?? null,
      technicianName: r.technician_id ? names[r.technician_id] ?? null : null, status: r.status, sequence: Number(r.sequence),
      timing: r.timing === 'after' ? 'after' as const : 'parallel' as const, afterServiceId: r.after_service_id ?? null, plannedStartOffsetMin: r.planned_start_offset_min ?? null,
      startedAt: isoOrNull(r.started_at), completedAt: isoOrNull(r.completed_at), techQueueTicketId: r.tech_queue_ticket_id ?? null, version: r.version != null ? Number(r.version) : 1 }));
  }
  async setServiceAssignments(ctx: QueueContext, id: string, rows: { serviceId: string; technicianId: string | null }[], meta: QueueWriteMeta): Promise<QueueServiceAssignmentView[]> {
    await this.db.transaction().execute(async (trx) => {
      const item: any = await this.scoped(trx.selectFrom('pos_queue_items'), ctx).where('id', '=', id).select(['id', 'branch_id', 'requested_services']).forUpdate().executeTakeFirst();
      if (!item) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND');
      const branchId = item.branch_id ?? (isUuid(ctx.branchId) ? ctx.branchId : null);
      if (!branchId) throw withCode(new QueueRuleError('Choose a location first — this guest has no branch.'), 'GUEST_NO_BRANCH');
      const svcs = parseSvcs(item.requested_services);
      for (const r of rows) {
        if (!isUuid(r.serviceId)) throw withCode(new QueueRuleError('That service is not on this visit.'), 'SERVICE_NOT_ON_VISIT');
        const seq = svcs.findIndex((s) => s.serviceId === r.serviceId);
        await trx.insertInto('queue_service_assignments').values({ tenant_id: ctx.tenantId, branch_id: branchId, queue_item_id: id, service_id: r.serviceId, technician_id: r.technicianId,
          status: r.technicianId ? 'assigned' : 'pending', sequence: Math.max(0, seq), assigned_by: isUuid(ctx.userId) ? ctx.userId : null })
          .onConflict((oc: any) => oc.columns(['tenant_id', 'queue_item_id', 'service_id']).doUpdateSet({ technician_id: r.technicianId, status: r.technicianId ? 'assigned' : 'pending', assigned_by: isUuid(ctx.userId) ? ctx.userId : null, updated_at: sql`now()` }).where(canMoveToSql(QUEUE_SERVICE_ASSIGNMENT, r.technicianId ? 'assigned' : 'pending', 'queue_service_assignments')))
          .execute();
      }
      await this.describe(trx, ctx, meta);
      await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ updated_at: sql`now()` }).where('id', '=', id).execute();
      await this.event(trx, ctx, DOMAIN_EVENTS.QUEUE_ITEM_UPDATED, id, { queueItemId: id, reason: 'service_assignments', assignments: rows }, branchId);
      await this.auditRow(trx, ctx, id, meta, undefined, { assignments: rows });
    });
    return this.serviceAssignments(ctx, id);
  }
  /**
   * Multi-technician routing — the ONE writer of a multi-line assignment (split visit, party). ALL OR NONE in one
   * transaction: the guests are row-locked in id order, then their lines in id order (a fixed lock order — a party plan
   * and a visit plan sharing a guest never deadlock); every guest's status / version / lead and every line's technician
   * must still be what the caller saw (else QueueAssignmentConflict naming the guest / line — nothing written); then per
   * guest the lead (CAS) with its history row (key `${keyBase}:${queueItemId}`), the lines (version + 1), the audit row,
   * queue.customer_assigned (the lead) and queue.service_lines_assigned.
   */
  async assignPlan(ctx: QueueContext, req: { items: PlanWriteItem[]; groupId: string | null; source: string; ai: boolean; keyBase: string; reason: string | null; metadata?: Record<string, unknown> }): Promise<{ queueItemId: string; version: number; assignedTechnicianId: string }[]> {
    const ids = [...req.items.map((i) => i.queueItemId)].sort();
    if (ids.some((x) => !isUuid(x))) throw withCode(new QueueRuleError('Queue item not found'), 'QUEUE_ITEM_NOT_FOUND');
    const ASSIGNABLE = req.ai ? ['waiting', 'called', 'ready_for_tech'] : ['waiting', 'called', 'assigned', 'ready_for_tech'];
    try {
      return await this.db.transaction().execute(async (trx) => {
        const rows: any[] = await this.scoped(trx.selectFrom('pos_queue_items'), ctx).where('id', 'in', ids)
          .select(['id', 'branch_id', 'status', 'version', 'assigned_technician_id', 'requested_services', 'group_id', 'customer_id']).orderBy('id', 'asc').forUpdate().execute();
        if (rows.length !== ids.length) throw withCode(new QueueRuleError('A guest in this plan is not in the queue.'), 'PLAN_GUEST_NOT_IN_QUEUE');
        const byId = new Map(rows.map((r) => [String(r.id), r]));
        const lineRows: any[] = await trx.selectFrom('queue_service_assignments').where('tenant_id', '=', ctx.tenantId).where('queue_item_id', 'in', ids)
          .select(['id', 'queue_item_id', 'service_id', 'technician_id', 'status', 'version']).orderBy('id', 'asc').forUpdate().execute();
        // ── check everything first (nothing is written unless every guest and every line still holds) ──
        for (const it of req.items) {
          const r = byId.get(it.queueItemId)!;
          const curTech = r.assigned_technician_id ?? null; const curVersion = Number(r.version ?? 1);
          if (req.groupId && String(r.group_id ?? '') !== req.groupId) throw withCode(new QueueRuleError('A guest in this plan is not in that party.'), 'PARTY_GUEST_NOT_IN_PARTY');
          if (!ASSIGNABLE.includes(r.status)) {
            if (req.ai && r.status === 'assigned') throw withCode(new QueueAssignmentConflict(curTech, curVersion, 'This guest already has a technician, so the plan was not applied.', { queueItemId: it.queueItemId }), 'SUGGESTION_NOT_APPLIED');
            throw withCode(new QueueRuleError(`This guest is no longer awaiting assignment (status: ${r.status}).`), 'GUEST_NOT_AWAITING_ASSIGNMENT');
          }
          if (it.expectedVersion !== curVersion || (it.expectedTechnicianId ?? null) !== curTech) throw new QueueAssignmentConflict(curTech, curVersion, undefined, { queueItemId: it.queueItemId });
          const onVisit = new Set(parseSvcs(r.requested_services).map((x) => String(x.serviceId)));
          const sent = new Set(it.lines.map((l) => l.serviceId));
          if (sent.size !== it.lines.length || sent.size !== onVisit.size || [...onVisit].some((x) => !sent.has(x))) throw withCode(new QueueRuleError('Every service of the visit needs a technician (all or none).'), 'VISIT_TECHNICIANS_ALL_OR_NONE');
          for (const l of it.lines) {
            const cur = lineRows.find((x) => String(x.queue_item_id) === it.queueItemId && String(x.service_id) === l.serviceId);
            if (cur && ['in_service', 'done'].includes(cur.status)) throw withCode(new QueueRuleError('A service of this visit has already started — it cannot be re-planned.'), 'VISIT_SERVICE_STARTED');
            const curLineTech = cur && cur.status !== 'cancelled' ? cur.technician_id ?? null : null;
            if ((l.expectedTechnicianId ?? null) !== curLineTech) throw withCode(new QueueAssignmentConflict(curLineTech, cur ? Number(cur.version) : null, 'A service on this guest was just given to another technician on another device. The queue has been refreshed.', { queueItemId: it.queueItemId, serviceId: l.serviceId }), 'QUEUE_CHANGED_ELSEWHERE');
          }
        }
        // ── write ──
        const out: { queueItemId: string; version: number; assignedTechnicianId: string }[] = [];
        for (const it of req.items) {
          const r = byId.get(it.queueItemId)!;
          const branchId = r.branch_id ?? (isUuid(ctx.branchId) ? ctx.branchId : null);
          if (!branchId) throw withCode(new QueueRuleError('Choose a location first — this guest has no branch.'), 'GUEST_NO_BRANCH');
          const set: any = { assigned_technician_id: it.leadTechnicianId };
          if (r.status === 'waiting' || r.status === 'called') { assertTransition(QUEUE_ITEM, r.status, 'assigned'); set.status = 'assigned'; }
          const meta: QueueWriteMeta = { action: 'assign_plan', auditAction: 'pos_queue_plan_assigned', source: req.source as any, reason: req.reason, idempotencyKey: `${req.keyBase}:${it.queueItemId}`,
            metadata: { ...(req.metadata || {}), groupId: req.groupId, lines: it.lines.map((l) => ({ serviceId: l.serviceId, technicianId: l.technicianId })) } };
          await this.describe(trx, ctx, meta);
          let u = this.scoped(trx.updateTable('pos_queue_items'), ctx).set(set).where('id', '=', it.queueItemId).where('version', '=', it.expectedVersion)
            .where(sql<boolean>`assigned_technician_id is not distinct from ${it.expectedTechnicianId ?? null}`);
          if (set.status) u = u.where('status', '=', r.status).where(canMoveToSql(QUEUE_ITEM, set.status));
          const res: any = await u.returning(['version', 'branch_id']).executeTakeFirst();
          if (!res) throw new QueueAssignmentConflict(r.assigned_technician_id ?? null, Number(r.version ?? 1), undefined, { queueItemId: it.queueItemId });
          await this.undescribe(trx);
          const svcs = parseSvcs(r.requested_services);
          const linesOut: { serviceId: string; technicianId: string; previousTechnicianId: string | null; timing: string }[] = [];
          for (const l of it.lines) {
            const cur = lineRows.find((x) => String(x.queue_item_id) === it.queueItemId && String(x.service_id) === l.serviceId);
            const seq = Math.max(0, svcs.findIndex((x) => String(x.serviceId) === l.serviceId));
            const vals = { technician_id: l.technicianId, status: 'assigned', timing: l.timing, after_service_id: l.afterServiceId, planned_start_offset_min: l.plannedStartOffsetMin,
              source: req.source, assigned_by: isUuid(ctx.userId) ? ctx.userId : null, tech_queue_ticket_id: null };
            await trx.insertInto('queue_service_assignments').values({ tenant_id: ctx.tenantId, branch_id: branchId, queue_item_id: it.queueItemId, service_id: l.serviceId, sequence: seq, ...vals })
              .onConflict((oc: any) => oc.columns(['tenant_id', 'queue_item_id', 'service_id']).doUpdateSet({ ...vals, sequence: seq, version: sql`queue_service_assignments.version + 1`, updated_at: sql`now()` })
                .where(canMoveToSql(QUEUE_SERVICE_ASSIGNMENT, 'assigned', 'queue_service_assignments')))
              .execute();
            linesOut.push({ serviceId: l.serviceId, technicianId: l.technicianId, previousTechnicianId: cur && cur.status !== 'cancelled' ? cur.technician_id ?? null : null, timing: l.timing });
          }
          const version = Number(res.version);
          // Fair Turn Engine §80–81: every line is its own turn effect for its own technician. A whole-visit assignment
          // or a line now given to someone else returns its provisional turn first (CORRECTION).
          const turnBranch = res.branch_id ?? branchId;
          for (const o of await openAssignments(trx, ctx.tenantId, { queueItemId: it.queueItemId })) {
            const now = o.lineServiceId ? it.lines.find((l) => l.serviceId === o.lineServiceId)?.technicianId : null;
            if (!o.lineServiceId || now !== o.technicianId) await turnUnassign(trx, { tenantId: ctx.tenantId, branchId: o.branchId, queueItemId: it.queueItemId, technicianId: o.technicianId, lineServiceId: o.lineServiceId, reason: 're-planned', actor: this.turnActor(ctx) }, { outbox: this.outbox });
          }
          for (const l of it.lines) {
            const svc = svcs.find((x) => String(x.serviceId) === l.serviceId);
            await turnAssign(trx, { tenantId: ctx.tenantId, branchId: turnBranch, technicianId: l.technicianId, queueItemId: it.queueItemId, lineServiceId: l.serviceId,
              services: [{ serviceId: l.serviceId, category: null, durationMinutes: Number(svc?.estimatedDurationMinutes ?? 0) }], source: req.source,
              reasonText: req.reason, idempotencyKey: `turn:${req.keyBase}:${it.queueItemId}:${l.serviceId}`, actor: this.turnActor(ctx) }, { outbox: this.outbox });
          }
          await this.auditRow(trx, ctx, it.queueItemId, meta, { technicianId: r.assigned_technician_id ?? null, status: r.status, version: Number(r.version ?? 1) }, { technicianId: it.leadTechnicianId, status: set.status ?? r.status, version, lines: linesOut });
          await this.event(trx, ctx, DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED, it.queueItemId,
            { queueItemId: it.queueItemId, technicianId: it.leadTechnicianId, previousTechnicianId: r.assigned_technician_id ?? null, previousStatus: r.status, status: set.status ?? r.status, customerId: r.customer_id ?? null, source: req.source, version }, res.branch_id);
          await this.event(trx, ctx, DOMAIN_EVENTS.QUEUE_SERVICE_LINES_ASSIGNED, it.queueItemId,
            { queueItemId: it.queueItemId, leadTechnicianId: it.leadTechnicianId, groupId: req.groupId ?? null, source: req.source, version, lines: linesOut }, res.branch_id);
          out.push({ queueItemId: it.queueItemId, version, assignedTechnicianId: it.leadTechnicianId });
        }
        return out;
      });
    } catch (e) {
      // the same key already wrote this plan (a retry racing the first call): nothing more is written
      if (isUniqueViolation(e)) throw new QueueIdempotentReplay(req.items[0]?.queueItemId ?? '');
      throw e;
    }
  }
  async customerIdForUser(ctx: QueueContext): Promise<string | null> {
    if (!isUuid(ctx.userId)) return null;
    const r: any = await this.db.selectFrom('customers').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('archived_at', 'is', null).select(['id']).executeTakeFirst().catch(() => undefined);
    return r?.id ?? null;
  }
}
