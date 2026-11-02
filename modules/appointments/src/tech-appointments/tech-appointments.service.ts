// tech-appointments.service.ts — tenant POS Tech Appointments. Resolves tenant/role from session; enforces per-action
// permissions; create/reschedule run conflict + skill + store-hours checks (manager override audited); check-in and
// move-to-queue / move-to-tech-queue / start-service are idempotent; everything is audited.
// ASYNC: the repository is async (Postgres/Kysely or in-memory). Pure counters/date helpers (nextSeq/today) stay sync.
import { type RealtimeEmitter, EVENTS, makeEnvelope, type EventName } from '@aipowersalon/realtime-contracts';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { resolveCatalogLines, CatalogLineError } from '../appointments/catalog-lines';
import { AppointmentSlotConflict, AppointmentVersionConflict } from '../appointments/appointment-slot-guard';
import { resolveManagerOverride, ManagerOverrideForbiddenError } from '../appointments/manager-override';
import {
  POSTechAppointmentsFullState, TechApptFilters, POSTechAppointmentItem, CreateAppointmentRequest, UpdateAppointmentRequest,
  RescheduleRequest, AssignTechnicianRequest, CancelAppointmentRequest, ConflictCheckRequest, TAService,
  addMinutesToTime, durationOfServices, withinStoreHours, detectTechnicianConflict, detectCustomerOverlap,
  canCheckIn, canStartService, buildQueueIdempotencyKey, buildTechQueueIdempotencyKey, buildServingIdempotencyKey,
} from './tech-appointments.dto';
import { TechApptContext, TechApptRepositoryPort } from './tech-appointments.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

/** 200-technician §2 (Oct 26 2026): the POS Tech Appointments board drew one lane per technician of the salon and its
 *  Assign select listed every technician's name — at 1,000 technicians a 1,000-lane, 1,000-name response on every refresh.
 *  With `lanePage` the state carries ONE page of lanes (name order; `laneSearch` by name or "#n", n = place in that order),
 *  only the appointments on those lanes plus the unassigned ones, and the lane totals. `roster: 'none'` drops
 *  filters.technicians (the screen picks technicians through the server-paged picker). The KPIs stay the whole day's.
 *  Without either the state is unchanged. Pure; exported for tests. */
export const TECH_APPT_LANE_PAGE_SIZE = 12;
export const TECH_APPT_LANE_PAGE_SIZE_MAX = 48;
export function pageTechApptLanes(st: POSTechAppointmentsFullState, f: TechApptFilters): POSTechAppointmentsFullState {
  let out = st;
  if (f.lanePage !== undefined || f.lanePageSize !== undefined || f.laneSearch) {
    const pageSize = Math.min(TECH_APPT_LANE_PAGE_SIZE_MAX, Math.max(1, Math.trunc(Number(f.lanePageSize)) || TECH_APPT_LANE_PAGE_SIZE));
    const ordered = st.technicians.slice().sort((a, b) => a.displayName.localeCompare(b.displayName) || a.technicianId.localeCompare(b.technicianId));
    const term = String(f.laneSearch ?? '').trim().toLowerCase();
    const num = /^#?\d{1,6}$/.test(term) ? Number(term.replace('#', '')) : null;
    const hit = term ? ordered.filter((t, i) => (num != null && i + 1 === num) || t.displayName.toLowerCase().includes(term)) : ordered;
    const totalPages = Math.max(1, Math.ceil(hit.length / pageSize));
    const page = Math.min(totalPages, Math.max(1, Math.trunc(Number(f.lanePage)) || 1));
    const lanes = hit.slice((page - 1) * pageSize, page * pageSize);
    const ids = new Set(lanes.map((t) => t.technicianId));
    out = { ...st, technicians: lanes, appointments: st.appointments.filter((a) => !a.technicianId || ids.has(a.technicianId)),
      lanes: { page, pageSize, total: hit.length, totalPages, totalAll: st.technicians.length } };
  }
  if (f.roster === 'none') out = { ...out, filters: { ...out.filters, technicians: [] } };
  return out;
}

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export type TechApptConflictCode = 'APPOINTMENT_CONFLICT' | 'VERSION_CONFLICT';
export class ConflictError extends Error {
  conflictingAppointmentId?: string; code: TechApptConflictCode; currentVersion?: number | null;
  constructor(msg: string, conflictingAppointmentId?: string, code: TechApptConflictCode = 'APPOINTMENT_CONFLICT', currentVersion?: number | null) {
    super(msg); this.name = 'ConflictError'; this.conflictingAppointmentId = conflictingAppointmentId; this.code = code; this.currentVersion = currentVersion;
  }
}
/** appointment-slot-guard errors → this module's 409 (never a 500, never a silent success) — merge Oct 12 2026. */
function slotGuard<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (e instanceof AppointmentSlotConflict) throw withCode(new ConflictError('This time was just booked or changed on another device. The schedule has been refreshed.', e.conflictingAppointmentId), 'SCHEDULE_CHANGED_ELSEWHERE');
    if (e instanceof AppointmentVersionConflict) throw new ConflictError(e.message, undefined, 'VERSION_CONFLICT', e.currentVersion);
    throw e;
  });
}


export interface POSTechApptAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

export class TechAppointmentsService {
  private audit: POSTechApptAuditLog[] = [];
  constructor(private readonly repo: TechApptRepositoryPort, private readonly realtime?: RealtimeEmitter) {}

  /** Realtime standard (Jul 27, 2026) — same discipline as BookingService.announce: after the write, §12-minimal,
   *  best-effort. Tech-appointment changes drive the same Booking/schedule screens. */
  private announce(ctx: TechApptContext, event: EventName, appointmentId: string, extra: Record<string, unknown> = {}): void {
    // Constitution 8: the repository emits appointment.* for the same table the booking module writes, so the
    // projection consumer carries these. Legacy path kept for in-memory / DB-less modes.
    if (this.repo.emitsDomainEvents?.()) return;
    try {
      this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId },
        event,
        makeEnvelope({ eventType: event, tenantId: ctx.tenantId, branchId: ctx.branchId, resourceType: 'appointment', resourceId: appointmentId, data: extra }));
    } catch { /* never load-bearing */ }
  }

  private assertUser(ctx: TechApptContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Tech Appointments is not available for this role');
  }
  private need(ctx: TechApptContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  /** The ONE manager-override rule (appointments/manager-override.ts): honoured only with pos.booking.override_conflict
   *  (audited `manager_override_used`); requested without it → 403. It never bypasses skills (a hard rule). */
  private override(ctx: TechApptContext, requested: unknown, action: string): boolean {
    try { return resolveManagerOverride(ctx, requested, (m) => this.log(ctx, 'manager_override_used', 'manager_override', undefined, undefined, undefined, { ...m }), action); }
    catch (e) { if (e instanceof ManagerOverrideForbiddenError) throw new ForbiddenError(e.message); throw e; }
  }
  private overbookOpts(settings: { bufferMinutes: number; allowOverbooking: boolean }, override: boolean, expectedVersion?: number | null) {
    return { bufferMinutes: settings.bufferMinutes, allowOverbook: !!(settings.allowOverbooking || override), overbookReason: override ? 'manager_override' : 'salon_allows_overbooking', expectedVersion };
  }
  private log(ctx: TechApptContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): POSTechApptAuditLog[] { return this.audit.slice(); }
  private async apptOr404(ctx: TechApptContext, id: string) { const a = await this.repo.appointment(ctx, id); if (!a) throw withCode(new ValidationError('Appointment not found'), 'APPOINTMENT_NOT_FOUND'); return a; }
  // Oct 1 2026: the ONE shared rule (../appointments/catalog-lines). The Sep 28 developer tree saved an unknown id as a $0,
  // 30-minute "Archived/Custom Service". Unknown ids are refused now, except one already on this appointment.
  private async resolveServices(ctx: TechApptContext, ids: string[], existing: TAService[] = []): Promise<TAService[]> {
    const catalog = (await this.repo.serviceCatalog(ctx)).map((c: any) => ({ serviceId: c.serviceId, name: c.name, durationMinutes: c.durationMinutes, priceCents: c.priceCents }));
    try {
      return resolveCatalogLines({ catalog, ids, mayOverride: false, existing: existing.map((e) => ({ ...e, priceCents: e.priceCents ?? 0 })) })
        .map((l) => ({ serviceId: l.serviceId, serviceName: l.serviceName, durationMinutes: l.durationMinutes, priceCents: l.priceCents }));
    } catch (e) { if (e instanceof CatalogLineError) throw new ValidationError(e.message); throw e; }
  }

  private async techSkilledFor(ctx: TechApptContext, technicianId: string, services: TAService[]): Promise<boolean> {
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === technicianId); if (!tech) return false;
    const cat = await this.repo.serviceCatalog(ctx);
    const cats = new Set(cat.filter((s) => services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    return [...cats].every((c) => tech.skills.includes(c));
  }

  // ---- read ----
  async getState(ctx: TechApptContext, f: TechApptFilters = {}): Promise<POSTechAppointmentsFullState> { this.need(ctx, 'pos.tech_appointments.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_tech_appointments_viewed', 'pos_tech_appointment', undefined, undefined, undefined, { filters: f }); return pageTechApptLanes(st, f); }
  async getKpis(ctx: TechApptContext) { return (await this.getState(ctx)).kpis; }
  async technicians(ctx: TechApptContext) { this.need(ctx, 'pos.tech_appointments.view'); return (await this.repo.query(ctx, {})).technicians; }
  async appointments(ctx: TechApptContext, f: TechApptFilters = {}): Promise<POSTechAppointmentItem[]> { this.need(ctx, 'pos.tech_appointments.view'); return (await this.repo.query(ctx, f)).appointments; }
  async detail(ctx: TechApptContext, id: string): Promise<POSTechAppointmentItem> { this.need(ctx, 'pos.tech_appointments.view'); const d = await this.repo.detail(ctx, id); if (!d) throw withCode(new ValidationError('Appointment not found'), 'APPOINTMENT_NOT_FOUND'); this.log(ctx, 'pos_tech_appointment_viewed', 'pos_tech_appointment', id); return d; }

  // ---- conflict check (§14) ----
  async checkConflict(ctx: TechApptContext, body: ConflictCheckRequest, date?: string): Promise<{ status: string; conflictingAppointmentId?: string }> {
    this.need(ctx, 'pos.tech_appointments.view'); const d = date || (this.repo.todayFor ? await this.repo.todayFor(ctx) : this.repo.today());   // the branch's day (BUILD_PLAN Phase 6, bug 2)
    const res = detectTechnicianConflict(await this.repo.existingForConflict(ctx, d), body.technicianId, body.startTime, body.endTime, (await this.repo.settings(ctx)).bufferMinutes, body.appointmentId);
    return res;
  }

  // ---- create / edit ----
  async create(ctx: TechApptContext, body: CreateAppointmentRequest): Promise<POSTechAppointmentItem> {
    this.need(ctx, 'pos.tech_appointments.create');
    body = { ...body, managerOverride: this.override(ctx, body?.managerOverride, 'tech_appointments.create') };
    if (!body?.customerName?.trim()) throw withCode(new ValidationError('A customer (or walk-in name) is required'), 'CUSTOMER_OR_WALKIN_REQUIRED');
    if (!body?.serviceIds?.length) throw withCode(new ValidationError('At least one service is required'), 'SERVICES_REQUIRED');
    if (!body?.technicianId) throw withCode(new ValidationError('A technician is required'), 'TECHNICIAN_REQUIRED');
    if (!body?.startTime || !body?.date) throw withCode(new ValidationError('A date and start time are required'), 'DATE_START_REQUIRED');
    const services = await this.resolveServices(ctx, body.serviceIds);
    const duration = durationOfServices(services); if (duration <= 0) throw withCode(new ValidationError('Duration must be greater than 0'), 'DURATION_INVALID');
    const endTime = addMinutesToTime(body.startTime, duration);
    const settings = await this.repo.settings(ctx);
    if (!withinStoreHours(body.startTime, endTime, settings.openTime, settings.closeTime) && !body.managerOverride) throw withCode(new ValidationError('Appointment is outside store hours — manager override required'), 'OUTSIDE_STORE_HOURS');
    if (!(await this.techSkilledFor(ctx, body.technicianId, services))) throw withCode(new ValidationError('Technician is not skilled for the selected services'), 'TECHNICIAN_NOT_SKILLED_FOR_SERVICES');   // hard rule: never overridable
    const existing = await this.repo.existingForConflict(ctx, body.date);
    const conf = detectTechnicianConflict(existing, body.technicianId, body.startTime, endTime, settings.bufferMinutes);
    if (conf.status === 'conflict' && !(settings.allowOverbooking || body.managerOverride)) throw withCode(new ConflictError('Technician is double-booked at that time', conf.conflictingAppointmentId), 'TECHNICIAN_DOUBLE_BOOKED');
    if (detectCustomerOverlap(existing, body.customerId, body.startTime, endTime) && !body.managerOverride) throw withCode(new ConflictError('Customer already has an overlapping appointment'), 'CUSTOMER_OVERLAPPING_APPOINTMENT');
    if (body.managerOverride && conf.status === 'conflict') this.log(ctx, 'pos_tech_appointment_conflict_override', 'pos_appointment_conflict', undefined, undefined, undefined, { conflictingAppointmentId: conf.conflictingAppointmentId });
    const item = await slotGuard(this.repo.create(ctx, {
      appointmentId: 'ta_' + this.repo.nextSeq(), technicianId: body.technicianId, customerId: body.customerId, customerName: body.customerName, customerPhone: body.customerPhone, isVip: !!body.isVip,
      source: body.source || 'manual', services, date: body.date, startTime: body.startTime, endTime, status: 'booked', depositStatus: settings.requireDeposit ? 'required' : 'not_required', notes: body.notes || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }, this.overbookOpts(settings, !!body.managerOverride)));
    this.log(ctx, 'pos_tech_appointment_created', 'pos_tech_appointment', item.appointmentId, undefined, item as any);
    this.announce(ctx, EVENTS.appointmentCreated, item.appointmentId, { startTime: item.startTime, technicianId: item.technicianId ?? null });
    return item;
  }
  async update(ctx: TechApptContext, id: string, body: UpdateAppointmentRequest): Promise<POSTechAppointmentItem> {
    this.need(ctx, 'pos.tech_appointments.edit'); await this.apptOr404(ctx, id);
    const patch: any = { customerName: body.customerName, customerPhone: body.customerPhone, notes: body.notes, isVip: body.isVip };
    if (body.serviceIds?.length) patch.services = await this.resolveServices(ctx, body.serviceIds, (await this.repo.appointment(ctx, id))?.services ?? []);
    const settings = await this.repo.settings(ctx);
    await slotGuard(this.repo.update(ctx, id, patch, this.overbookOpts(settings, false, body.expectedVersion))); this.log(ctx, 'pos_tech_appointment_updated', 'pos_tech_appointment', id, undefined, undefined, { expectedVersion: body.expectedVersion ?? null });
    const updated = (await this.repo.detail(ctx, id))!;
    this.announce(ctx, EVENTS.appointmentUpdated, id, { startTime: updated.startTime, technicianId: updated.technicianId ?? null });
    return updated;
  }

  // ---- reschedule (§15) ----
  async reschedule(ctx: TechApptContext, id: string, body: RescheduleRequest): Promise<POSTechAppointmentItem> {
    this.need(ctx, 'pos.tech_appointments.reschedule'); const a = await this.apptOr404(ctx, id);
    body = { ...body, managerOverride: this.override(ctx, body?.managerOverride, 'tech_appointments.reschedule') };
    if (!body?.startTime) throw withCode(new ValidationError('A new start time is required'), 'NEW_START_REQUIRED');
    const settings = await this.repo.settings(ctx); const date = body.date || a.date; const techId = body.technicianId || a.technicianId;
    const endTime = addMinutesToTime(body.startTime, durationOfServices(a.services));
    if (!withinStoreHours(body.startTime, endTime, settings.openTime, settings.closeTime) && !body.managerOverride) throw withCode(new ValidationError('New time is outside store hours — manager override required'), 'OUTSIDE_STORE_HOURS');
    const conf = detectTechnicianConflict(await this.repo.existingForConflict(ctx, date), techId, body.startTime, endTime, settings.bufferMinutes, id);
    if (conf.status === 'conflict' && !(settings.allowOverbooking || body.managerOverride)) throw withCode(new ConflictError('Technician is double-booked at that time', conf.conflictingAppointmentId), 'TECHNICIAN_DOUBLE_BOOKED');
    if (body.managerOverride && conf.status === 'conflict') this.log(ctx, 'pos_tech_appointment_conflict_override', 'pos_appointment_conflict', id, undefined, undefined, { conflictingAppointmentId: conf.conflictingAppointmentId });
    // a reschedule onto a DIFFERENT technician re-checks skills (hard rule)
    if (body.technicianId && body.technicianId !== a.technicianId && !(await this.techSkilledFor(ctx, body.technicianId, a.services))) throw withCode(new ValidationError('Technician is not skilled for the selected services'), 'TECHNICIAN_NOT_SKILLED_FOR_SERVICES');
    await slotGuard(this.repo.reschedule(ctx, id, body.technicianId, body.startTime, body.date, this.overbookOpts(settings, !!body.managerOverride, body.expectedVersion)));
    this.log(ctx, 'pos_tech_appointment_rescheduled', 'pos_tech_appointment', id, undefined, undefined, { startTime: body.startTime, technicianId: body.technicianId, expectedVersion: body.expectedVersion ?? null });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- assign / check-in / cancel / no-show ----
  async assignTechnician(ctx: TechApptContext, id: string, body: AssignTechnicianRequest): Promise<POSTechAppointmentItem> {
    this.need(ctx, 'pos.tech_appointments.assign_technician'); const a = await this.apptOr404(ctx, id);
    body = { ...body, managerOverride: this.override(ctx, body?.managerOverride, 'tech_appointments.assign_technician') };
    if (!body?.technicianId) throw withCode(new ValidationError('A technician is required'), 'TECHNICIAN_REQUIRED');
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId); if (!tech) throw withCode(new ValidationError('Technician not found in this tenant'), 'TECHNICIAN_NOT_FOUND');
    if (!(await this.techSkilledFor(ctx, body.technicianId, a.services))) throw withCode(new ValidationError('Technician is not skilled for the selected services'), 'TECHNICIAN_NOT_SKILLED_FOR_SERVICES');   // hard rule: never overridable
    // the NEW technician's day is checked for an overlap (it was unchecked, and the database refusal was swallowed)
    const settings = await this.repo.settings(ctx);
    const conf = detectTechnicianConflict(await this.repo.existingForConflict(ctx, a.date), body.technicianId, a.startTime, a.endTime, settings.bufferMinutes, id);
    if (conf.status === 'conflict' && !(settings.allowOverbooking || body.managerOverride)) throw withCode(new ConflictError('That technician is already booked at this time', conf.conflictingAppointmentId), 'TECHNICIAN_DOUBLE_BOOKED');
    if (body.managerOverride && conf.status === 'conflict') this.log(ctx, 'pos_tech_appointment_conflict_override', 'pos_appointment_conflict', id, undefined, undefined, { conflictingAppointmentId: conf.conflictingAppointmentId, action: 'assign_technician' });
    await slotGuard(this.repo.assign(ctx, id, body.technicianId, this.overbookOpts(settings, !!body.managerOverride, body.expectedVersion)));
    this.log(ctx, 'pos_tech_appointment_technician_assigned', 'pos_tech_appointment', id, undefined, undefined, { technicianId: body.technicianId, override: !!body.managerOverride });
    return (await this.repo.detail(ctx, id))!;
  }
  async checkIn(ctx: TechApptContext, id: string): Promise<POSTechAppointmentItem> {
    this.need(ctx, 'pos.tech_appointments.check_in'); const a = await this.apptOr404(ctx, id);
    if (!canCheckIn(a.status)) throw withCode(new ValidationError('Only a booked or confirmed appointment can be checked in'), 'APPOINTMENT_CANNOT_CHECK_IN');
    await this.repo.setStatus(ctx, id, 'checked_in'); this.log(ctx, 'pos_tech_appointment_checked_in', 'pos_tech_appointment', id); return (await this.repo.detail(ctx, id))!;
  }
  async cancel(ctx: TechApptContext, id: string, body: CancelAppointmentRequest): Promise<POSTechAppointmentItem> {
    this.need(ctx, 'pos.tech_appointments.cancel'); await this.apptOr404(ctx, id);
    if (!body?.reason?.trim()) throw withCode(new ValidationError('Cancelling requires a reason'), 'CANCEL_REASON_REQUIRED');
    await this.repo.setStatus(ctx, id, 'cancelled'); this.log(ctx, 'pos_tech_appointment_cancelled', 'pos_tech_appointment', id, undefined, undefined, { reason: body.reason });
    this.announce(ctx, EVENTS.appointmentCancelled, id);
    return (await this.repo.detail(ctx, id))!;
  }
  async noShow(ctx: TechApptContext, id: string): Promise<POSTechAppointmentItem> {
    this.need(ctx, 'pos.tech_appointments.no_show'); await this.apptOr404(ctx, id);
    await this.repo.setStatus(ctx, id, 'no_show'); this.log(ctx, 'pos_tech_appointment_no_show', 'pos_tech_appointment', id); return (await this.repo.detail(ctx, id))!;
  }

  // ---- transfers (idempotent) ----
  async moveToQueue(ctx: TechApptContext, id: string): Promise<{ moved: boolean; duplicate: boolean; queueItemId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.queue.create'); const a = await this.apptOr404(ctx, id); const key = buildQueueIdempotencyKey(id);
    if ((await this.repo.getKey(ctx, id, 'queue')) === key) { this.log(ctx, 'pos_tech_appointment_moved_to_queue', 'pos_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, queueItemId: id, idempotencyKey: key }; }
    if (['cancelled', 'no_show'].includes(a.status)) throw withCode(new ValidationError('A cancelled or no-show appointment cannot be moved to the queue'), 'BOOKING_CANCELLED_CANNOT_MOVE');
    await this.repo.setKey(ctx, id, 'queue', key); if (a.status === 'booked' || a.status === 'confirmed') await this.repo.setStatus(ctx, id, 'checked_in');
    this.log(ctx, 'pos_tech_appointment_moved_to_queue', 'pos_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    return { moved: true, duplicate: false, queueItemId: id, idempotencyKey: key };
  }
  async moveToTechQueue(ctx: TechApptContext, id: string): Promise<{ moved: boolean; duplicate: boolean; techQueueTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.tech_queue.create'); const a = await this.apptOr404(ctx, id); const key = buildTechQueueIdempotencyKey(id);
    if ((await this.repo.getKey(ctx, id, 'techQueue')) === key) { this.log(ctx, 'pos_tech_appointment_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, techQueueTicketId: id, idempotencyKey: key }; }
    if (['cancelled', 'no_show'].includes(a.status)) throw withCode(new ValidationError('A cancelled or no-show appointment cannot be moved to the tech queue'), 'BOOKING_CANCELLED_CANNOT_MOVE');
    if (!a.technicianId) throw withCode(new ValidationError('An assigned technician is required to move to the tech queue'), 'TECHNICIAN_REQUIRED_FOR_TECH_QUEUE');
    await this.repo.setKey(ctx, id, 'techQueue', key);
    this.log(ctx, 'pos_tech_appointment_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    return { moved: true, duplicate: false, techQueueTicketId: id, idempotencyKey: key };
  }
  async startService(ctx: TechApptContext, id: string): Promise<{ moved: boolean; duplicate: boolean; servingTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.serving.start'); const a = await this.apptOr404(ctx, id); const key = buildServingIdempotencyKey(id);
    if ((await this.repo.getKey(ctx, id, 'serving')) === key && a.status === 'in_service') { this.log(ctx, 'pos_tech_appointment_started_service', 'pos_serving_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, servingTicketId: id, idempotencyKey: key }; }
    const gate = canStartService(a.status); if (!gate.ok) throw withCode(new ValidationError('Cannot start service: ' + gate.reason), 'CANNOT_START_SERVICE');
    if (a.services.length <= 0) throw withCode(new ValidationError('Requested services are required to start service'), 'SERVICES_REQUIRED_TO_START');
    await this.repo.setStatus(ctx, id, 'in_service'); await this.repo.setKey(ctx, id, 'serving', key);
    this.log(ctx, 'pos_tech_appointment_started_service', 'pos_serving_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    return { moved: true, duplicate: false, servingTicketId: id, idempotencyKey: key };
  }
}
