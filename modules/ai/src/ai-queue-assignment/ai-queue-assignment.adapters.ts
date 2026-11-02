// ai-queue-assignment.adapters.ts — production adapters wiring the AI layer to existing platform services. The data
// adapter delegates to QueueService.assignmentInputs (the queue domain owns queue data); the assign adapter calls the
// queue's own assignTechnician (its version / lock / history / audit guards intact); the emitter adapter publishes on
// the existing realtime bus, tenant+branch scoped. None re-implements queue behaviour.
//
// BUILD_PLAN Phase 6: the auto-config and rotation adapters (KyselyAutoConfig / KyselyRotationSettings) are gone — both
// read the ONE settings source now (ai-queue-assignment-settings.ts). The tech-queue workload adapter is gone too: the
// queue's assignmentInputs carries every technician's load, minutes, availability, break and shift end. The appointment
// adapter reads the appointments domain's `startAt` (audit bug 2); the emitter maps the decision / settings / lock events
// it used to drop (bug 8).
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { QueueService } from '@aipowersalon/queue';
import { EVENTS, type EventName, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { TechAppointmentsService } from '@aipowersalon/appointments';
import { minutesUntil } from './ai-queue-assignment-appointment';
import type {
  QueueDataPort, QueueEntryInputs, AssignmentEmitterPort, AppointmentDataPort, UpcomingAppointment,
  QueueScanPort, ScanEntryData, AssignExecutionPort, AssignOptions, AssignResult, QueueItemSnapshot, QueueCandidateInput,
  PlanAssignOptions, PlanAssignResult, QueueGroupInput,
} from './ai-queue-assignment.ports';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';
import { workerPrincipal } from '@aipowersalon/permissions';
import { readTurnDay, declinedTechniciansFor, loadTurnRules, languageCode } from '@aipowersalon/workforce';
import type { TurnReadPort } from './ai-queue-assignment.ports';

/** The permissions a SYSTEM run (the background auto-run, Agent C's job) acts with at the queue layer. */
// BUILD_PLAN Phase 9: worker:ai-queue-auto-assign — the named principal, only queue.view / queue.manage (what
// pos.queue.view / pos.queue.assign_technician resolve to).

/** The queue domain's context from ours. A system run carries no user (the queue records actor null, source auto_assign). */
export function queueCtx(ctx: QueueAssignmentContext, system = false): any {
  // §72: the platform's system context (role SYSTEM, named actor); the queue records no user for it (actor null, source auto_assign)
  if (system) return { ...workerPrincipal('ai-queue-auto-assign', { tenantId: ctx.tenantId, branchId: ctx.branchId }), userId: ctx.userId || null, system: true };
  return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions };
}
const isConflict = (e: any) => e?.name === 'QueueAssignmentConflict' || e?.code === 'VERSION_CONFLICT' || e?.status === 409 || e?.getStatus?.() === 409;
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

// Executes real assignments through the queue's own action. A stale guest → { conflict } (never overwritten).
export class QueueAssignExecutionAdapter implements AssignExecutionPort {
  constructor(private readonly queue: QueueService) {}
  async assign(ctx: QueueAssignmentContext, queueEntryId: string, o: AssignOptions): Promise<AssignResult> {
    try {
      const item: any = await this.queue.assignTechnician(queueCtx(ctx, !!o.system), queueEntryId, {
        technicianId: o.technicianId, expectedTechnicianId: o.expectedTechnicianId ?? null,
        ...(o.expectedVersion != null ? { expectedVersion: o.expectedVersion } : {}),
        ...(o.managerOverride ? { managerOverride: true } : {}),
        source: o.source, ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}), ...(o.reason ? { reason: o.reason } : {}),
        ...(o.turn ? { turn: o.turn } : {}),
      });
      return { ok: true, item: item ?? null };
    } catch (e: any) {
      if (isConflict(e)) return { ok: false, conflict: true, currentTechnicianId: e?.currentTechnicianId ?? null, error: String(e?.message || 'conflict') };
      return { ok: false, error: String(e?.message || 'assign_failed') };
    }
  }
  /** Multi-technician routing: the queue's ONE multi-line writer (all or none). A stale guest / line → { conflict }. */
  async assignPlan(ctx: QueueAssignmentContext, o: PlanAssignOptions): Promise<PlanAssignResult> {
    try {
      const result: any = await this.queue.assignPlan(queueCtx(ctx, !!o.system), {
        items: o.items, groupId: o.groupId ?? null, idempotencyKey: o.idempotencyKey, source: o.source,
        ...(o.managerOverride ? { managerOverride: true } : {}), ...(o.reason ? { reason: o.reason } : {}),
      });
      return { ok: true, result: result ?? null };
    } catch (e: any) {
      if (isConflict(e)) return { ok: false, conflict: true, currentTechnicianId: e?.currentTechnicianId ?? null, queueItemId: e?.queueItemId, serviceId: e?.serviceId, error: String(e?.message || 'conflict') };
      return { ok: false, error: String(e?.message || 'assign_failed') };
    }
  }
  async current(ctx: QueueAssignmentContext, queueEntryId: string, opts: { system?: boolean } = {}): Promise<QueueItemSnapshot | null> {
    try {
      const d: any = await this.queue.detail(queueCtx(ctx, !!opts.system), queueEntryId);
      if (!d) return null;
      return { queueEntryId, status: d.status ?? null, assignedTechnicianId: d.assignedTechnicianId ?? null, version: num(d.version), item: d };
    } catch { return null; }
  }
}

export class QueueScanAdapter implements QueueScanPort {
  constructor(private readonly queue: QueueService) {}
  async getScanEntries(ctx: QueueAssignmentContext, opts: { system?: boolean } = {}): Promise<ScanEntryData[]> {
    try { return (await this.queue.scanEntries(queueCtx(ctx, !!opts.system))) as ScanEntryData[]; } catch { return []; }
  }
}

/** Maps QueueService.assignmentInputs (the Phase 6 enriched shape) into the engine's inputs. Unknown fields stay null —
 *  never fabricated — so an older queue build degrades to "no signal" rather than a wrong one. */
export function mapAssignmentInputs(r: any): QueueEntryInputs {
  const e = r?.entry ?? {};
  const entry = {
    queueEntryId: String(e.queueItemId ?? e.queueEntryId), branchId: e.branchId ?? null, version: num(e.version),
    requiredCategories: Array.isArray(e.requiredCategories) ? e.requiredCategories : [], serviceDurationMinutes: num(e.serviceDurationMinutes) ?? 0,
    requestedTechnicianId: e.requestedTechnicianId ?? null, previousTechnicianId: e.previousTechnicianId ?? null,
    isVip: !!e.isVip, isAppointment: !!e.isAppointment, appointmentStartAt: e.appointmentStartAt ?? null, lateMinutes: num(e.lateMinutes),
    groupId: e.groupId ?? null, groupSize: num(e.groupSize), lock: e.lock ? { technicianId: e.lock.technicianId ?? null, reason: e.lock.reason ?? null } : null,
    serviceIds: Array.isArray(e.serviceIds) ? e.serviceIds : [],
    // multi-technician routing: the visit's lines (category / minutes / add-on parent / the technician on each now)
    services: (Array.isArray(e.services) ? e.services : []).map((x: any) => ({
      serviceId: String(x.serviceId), serviceName: String(x.serviceName ?? ''), category: x.category ?? null, durationMinutes: num(x.durationMinutes) ?? 0,
      sequence: num(x.sequence) ?? 0, isAddon: !!x.isAddon, parentServiceId: x.parentServiceId ?? null, assignedTechnicianId: x.assignedTechnicianId ?? null, status: String(x.status ?? 'pending'),
    })),
    ...(typeof e.customerName === 'string' ? { customerName: e.customerName } : {}),
    ...(e.assignedTechnicianId !== undefined ? { assignedTechnicianId: e.assignedTechnicianId ?? null } : {}),
    ...(e.status !== undefined ? { status: e.status ?? null } : {}),
  };
  const candidates: QueueCandidateInput[] = (Array.isArray(r?.candidates) ? r.candidates : []).map((c: any) => ({
    technicianId: String(c.technicianId), name: String(c.name ?? ''), branchId: c.branchId ?? null, available: !!c.available,
    skills: Array.isArray(c.skills) ? c.skills : [], activeAssignments: num(c.activeAssignments) ?? 0, isPrevious: !!c.isPrevious,
    rotationIndex: num(c.rotationIndex), assignedMinutes: num(c.assignedMinutes), availableInMinutes: num(c.availableInMinutes),
    shiftEndsInMinutes: num(c.shiftEndsInMinutes), nextAppointmentInMinutes: num(c.nextAppointmentInMinutes),
    onBreak: !!c.onBreak, blocked: !!c.blocked, maxConcurrent: num(c.maxConcurrent), lastServedAt: typeof c.lastServedAt === 'string' ? c.lastServedAt : null,
    ...(typeof c.stationAvailable === 'boolean' ? { stationAvailable: c.stationAvailable } : {}),
    ...(typeof c.clockedIn === 'boolean' ? { clockedIn: c.clockedIn } : {}),   // merge Oct 12 2026: real clock state when the queue knows it
    ...(typeof c.serviceEligible === 'boolean' ? { serviceEligible: c.serviceEligible } : {}),   // deep-scan Oct 22 2026: exact-service eligibility
    ...(Array.isArray(c.eligibleServiceIds) ? { eligibleServiceIds: c.eligibleServiceIds.map(String) } : {}),   // Oct 28 2026: per service, for plan lines
  }));
  return { entry, candidates };
}

export class QueueServiceDataAdapter implements QueueDataPort {
  constructor(private readonly queue: QueueService) {}
  async getInputs(ctx: QueueAssignmentContext, queueEntryId: string, opts: { system?: boolean } = {}): Promise<QueueEntryInputs | null> {
    try { return mapAssignmentInputs(await this.queue.assignmentInputs(queueCtx(ctx, !!opts.system), queueEntryId)); }
    catch { return null; } // not found / not permitted at the queue layer → no inputs
  }
  async getInputsMany(ctx: QueueAssignmentContext, queueEntryIds: string[]): Promise<Record<string, QueueEntryInputs>> {
    // a refusal / failure propagates: the engine's suggest() then lets each guest read alone (getInputs)
    const out: Record<string, QueueEntryInputs> = {};
    const many = await this.queue.assignmentInputsMany(queueCtx(ctx, false), queueEntryIds);
    for (const [id, r] of Object.entries(many)) out[id] = mapAssignmentInputs(r);
    return out;
  }
  async getGroup(ctx: QueueAssignmentContext, groupId: string): Promise<QueueGroupInput | null> {
    try {
      const g: any = (await this.queue.groups(queueCtx(ctx))).find((x: any) => x.groupId === groupId);
      return g ? { groupId: g.groupId, label: g.label, together: !!g.together, members: g.members.map((m: any) => ({ queueItemId: m.queueItemId, customerName: m.customerName, status: m.status })) } : null;
    } catch { return null; }
  }
}

export class RealtimeAssignmentEmitter implements AssignmentEmitterPort {
  /** B-14 remainder (Oct 20 2026): every name below is recorded as a domain event with its write and mapped by the realtime
   *  projection, so when the projection delivers, this emitter pushes nothing; it is the fallback for a publisher that is off. */
  constructor(private readonly realtime?: RealtimeEmitter, private readonly recorded = false, private readonly env: NodeJS.ProcessEnv = process.env) {}
  /** `recorded` = this process records the queue-assignment facts (a database and the outbox writer); the publisher switch
   *  decides the rest — ONE rule for every direct-vs-projection decision (packages/config events-flags). */
  private emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.recorded, this.env); }
  /** Constitution 9 §25/§26: the port speaks in domain-style names; the wire speaks in registry names. Map, never cast. */
  static readonly WIRE: Record<string, EventName> = {
    'queue.alert_raised': EVENTS.queueAlertRaised, 'queue.alert_acknowledged': EVENTS.queueAlertAcknowledged, 'queue.alert_resolved': EVENTS.queueAlertResolved,
    'queue.assignment_recommended': EVENTS.queueAssignmentRecommended, 'queue.auto_assigned': EVENTS.queueAutoAssigned,
    'queue.auto_assignment_killed': EVENTS.queueAutoAssignmentKilled, 'queue.record_repaired': EVENTS.queueRecordRepaired,
    // BUILD_PLAN Phase 6, audit bug 8: decisions were emitted as queue.assignment_<decision> — names not in this map, so
    // every one was silently dropped. One name now, with the decision in the payload.
    'queue.assignment_decided': EVENTS.queueAssignmentDecided,
    'queue.assignment_settings_changed': EVENTS.queueAssignmentSettingsChanged,
    'queue.assignment_locked': EVENTS.queueAssignmentLocked, 'queue.assignment_unlocked': EVENTS.queueAssignmentUnlocked,
  };
  emit(ctx: QueueAssignmentContext, event: string, payload: Record<string, unknown>): void {
    if (this.emitsDomainEvents()) return;
    const wire = RealtimeAssignmentEmitter.WIRE[event];
    if (!wire) return;                                   // an unmapped name never reaches a client unroutable
    try { this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId }, wire, payload); } catch { /* emit is best-effort */ }
  }
}

/** Earliest future confirmed appointment per technician, from items carrying `startAt` — the instant the appointments
 *  domain resolved from appt_date + 'HH:MM' in the BRANCH zone. An item without it is no signal (never a guess). PURE. */
export function upcomingFromAppointments(items: any[], now: number = Date.now()): Record<string, UpcomingAppointment> {
  const best: Record<string, UpcomingAppointment> = {};
  for (const a of items ?? []) {
    if (!['confirmed', 'checked_in'].includes(a?.status)) continue;
    const mins = minutesUntil(typeof a.startAt === 'string' ? a.startAt : null, now);
    if (mins == null || mins < 0) continue; // only future appointments
    const cur = best[a.technicianId];
    if (!cur || (cur.nextAppointmentInMinutes ?? Infinity) > mins) best[a.technicianId] = { technicianId: a.technicianId, nextAppointmentInMinutes: mins, appointmentId: a.appointmentId ?? null };
  }
  return best;
}

// Reads each technician's next confirmed appointment from the tech-appointments domain (source of truth for bookings).
// Audit bug 2: the start was Date.parse('HH:MM') → NaN → every appointment skipped, on the server's UTC day. The
// appointments domain now answers both: its default day is the BRANCH's, and every item carries `startAt`.
export class TechAppointmentsAdapter implements AppointmentDataPort {
  constructor(private readonly appts: TechAppointmentsService) {}
  async getUpcoming(ctx: QueueAssignmentContext): Promise<Record<string, UpcomingAppointment>> {
    try { return upcomingFromAppointments((await this.appts.appointments(queueCtx(ctx), {}))); }
    catch { return {}; }
  }
}

/** Fair Turn Engine: today's technician turn queue (technician_turn_state, 602) through the ONE ledger's reads. */
export class KyselyTurnReadAdapter implements TurnReadPort {
  constructor(private readonly db: any) {}
  private ok(ctx: QueueAssignmentContext): boolean { return /^[0-9a-f-]{36}$/i.test(String(ctx?.tenantId ?? '')) && /^[0-9a-f-]{36}$/i.test(String(ctx?.branchId ?? '')); }
  async day(ctx: QueueAssignmentContext) { if (!this.ok(ctx)) return { rows: [] }; return { rows: (await readTurnDay(this.db, ctx.tenantId, ctx.branchId)).rows }; }
  async declined(ctx: QueueAssignmentContext, queueEntryId: string) { return this.ok(ctx) ? declinedTechniciansFor(this.db, ctx.tenantId, queueEntryId) : []; }
  async specialServiceIds(ctx: QueueAssignmentContext) {
    if (!this.ok(ctx)) return [];
    return (await loadTurnRules(this.db, ctx.tenantId)).filter((r) => r.specialRotation && r.scope === 'service' && r.serviceId).map((r) => r.serviceId as string);
  }
  /** §158: the guest's preferred language comes from her customer record (customers.preferred_language, 490) via the queue entry. */
  async guestLanguage(ctx: QueueAssignmentContext, queueEntryId: string): Promise<string | null> {
    if (!this.ok(ctx) || !/^[0-9a-f-]{36}$/i.test(queueEntryId)) return null;
    const r = await this.db.selectFrom('pos_queue_items as qi').innerJoin('customers as c', 'c.id', 'qi.customer_id')
      .select('c.preferred_language as lang').where('qi.tenant_id', '=', ctx.tenantId).where('qi.id', '=', queueEntryId).executeTakeFirst().catch(() => null);
    return languageCode(r?.lang ?? null);
  }
  /** §158: what each technician speaks — her professional profile's languages (global_tech_profiles.languages) plus her app
   *  language (users.preferred_language, 560). No data at all = unknown (absent from the map), never "does not speak". */
  async technicianLanguages(ctx: QueueAssignmentContext, technicianIds: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    const ids = technicianIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!this.ok(ctx) || !ids.length) return out;
    const rows: any[] = await this.db.selectFrom('technicians as t')
      .leftJoin('users as u', 'u.id', 't.user_id').leftJoin('global_tech_profiles as g', 'g.id', 't.global_tech_profile_id')
      .select(['t.id as id', 'u.preferred_language as user_lang', 'g.languages as languages'])
      .where('t.tenant_id', '=', ctx.tenantId).where('t.id', 'in', ids).execute().catch(() => []);
    for (const r of rows) {
      const codes = new Set<string>();
      const list = Array.isArray(r.languages) ? r.languages : typeof r.languages === 'string' ? (() => { try { return JSON.parse(r.languages); } catch { return []; } })() : [];
      for (const l of list) { const c = languageCode(typeof l === 'string' ? l : l?.code ?? l?.name ?? l?.language); if (c) codes.add(c); }
      const u = languageCode(r.user_lang); if (u) codes.add(u);
      if (codes.size) out.set(String(r.id), codes);
    }
    return out;
  }
}
