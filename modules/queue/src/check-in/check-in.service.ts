// check-in.service.ts — tenant POS Check-In (the front-door). Resolves tenant/role from session; enforces per-action
// permissions; customer/appointment search are tenant-scoped; walk-in creation prevents duplicate customers; appointment
// check-in and move-to-queue / move-to-tech-queue / start-service are idempotent; everything is audited.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { TechnicianEligibilityError, type TechnicianEligibilityService } from '@aipowersalon/workforce';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { resolveCatalogLines, CatalogLineError, PRICE_OVERRIDE_PERMISSION, resolveManagerOverride, ManagerOverrideForbiddenError } from '@aipowersalon/appointments';
import type { RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { type BookingCheckinRecorderPort } from '@aipowersalon/reports';
import {
  POSCheckInFullState, CheckInFilters, POSCheckInRow, POSCheckInCustomerDetail, POSCheckInAppointmentRow,
  WalkInRequest, CreateCustomerRequest, UpdateCheckInServicesRequest, AssignCheckInTechnicianRequest,
  UpdateWaitEstimateRequest, CancelCheckInRequest, CheckInServiceLine, findDuplicateCustomer, canStartFromCheckIn,
  buildQueueIdempotencyKey, buildTechQueueIdempotencyKey, buildServingIdempotencyKey, buildAppointmentCheckInKey,
} from './check-in.dto';
import { CheckInContext, CheckInRepositoryPort } from './check-in.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string, public readonly code?: string, public readonly params?: Record<string, unknown>) { super(msg); this.name = 'ValidationError'; } }   // V-5 (Oct 27 2026): an optional registry code + params beside the English
/** Dual-Screen mandate §104: a second active check-in for the same guest — a ValidationError (every caller that caught it
 *  still does) carrying the standard code; the controllers answer 409 CHECKIN_ALREADY_EXISTS. */
export class CheckInAlreadyExistsError extends ValidationError {
  readonly code = 'CHECKIN_ALREADY_EXISTS' as const; readonly status = 409;
  constructor(msg: string) { super(msg); this.name = 'CheckInAlreadyExistsError'; }
}
export class DuplicateCustomerError extends Error { existingCustomerId: string; constructor(existingCustomerId: string) { super('A customer with that phone or email already exists'); this.name = 'DuplicateCustomerError'; this.existingCustomerId = existingCustomerId; } }


export interface POSCheckInAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

/** Structural port for the global identity service (one-way coupling — see CustomersService). */
export interface IdentityLinkLike {
  ensureLinked(c: { tenantId: string; customerId: string; firstName?: string | null; lastName?: string | null; fullName?: string | null; phoneRaw?: string | null; email?: string | null }, source?: 'realtime' | 'reconciliation' | 'activation' | 'import'): Promise<unknown>;
}

export class CheckInService {
  private audit: POSCheckInAuditLog[] = [];
  private apptCheckInIndex = new Map<string, string>(); // appointmentId -> checkInId (fast path; the DB's active entry is the truth)
  // mandate §31 (Oct 20 2026): the walk-in idempotency key is no longer held in a process Map — it is stored on the queue
  // row (migration 665) and replayed from there, so a retry on another API replica gets the entry it created, not a 409.
  constructor(private readonly repo: CheckInRepositoryPort, private readonly recorder?: BookingCheckinRecorderPort, private readonly identity?: IdentityLinkLike, private readonly realtime?: RealtimeEmitter) {}

  /** §7/§8 real-time duplicate prevention at the check-in desk. Best-effort: identity linking never blocks a
   *  walk-in. Only the global link is written — this salon's customer row is untouched. */
  private async linkGlobalIdentity(ctx: CheckInContext, customerId: string, fullName?: string | null, phone?: string | null, email?: string | null): Promise<void> {
    if (!this.identity) return;
    try { await this.identity.ensureLinked({ tenantId: ctx.tenantId, customerId, fullName: fullName ?? null, phoneRaw: phone ?? null, email: email ?? null }, 'realtime'); }
    catch { /* never blocks check-in */ }
  }

  /** Fail-soft: record a detected duplicate check-in candidate for the Booking & Check-In Monitor (§29). Never blocks
   *  or alters the check-in — a successful/idempotent check-in still returns normally; monitoring errors are swallowed. */
  private emitDuplicateCheckin(ctx: CheckInContext, d: { customerRef?: string | null; appointmentId?: string | null; checkInMethod: string; matchReasons: string[] }) {
    void this.recorder?.recordDuplicateCandidate({
      tenantId: ctx.tenantId, branchId: ctx.branchId || null, customerRef: d.customerRef ?? null, appointmentId: d.appointmentId ?? null,
      checkInMethod: d.checkInMethod, matchReasons: d.matchReasons, confidence: 1, reviewState: 'pending',
    })?.catch(() => undefined);
  }

  private assertUser(ctx: CheckInContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Check-In is not available for this role');
  }
  private need(ctx: CheckInContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private override(ctx: CheckInContext, requested: unknown, action: string): boolean {
    try { return resolveManagerOverride(ctx, requested, (m) => this.log(ctx, 'manager_override_used', 'manager_override', undefined, undefined, undefined, { ...m }), action); }
    catch (e) { if (e instanceof ManagerOverrideForbiddenError) throw new ForbiddenError(e.message); throw e; }
  }
  private log(ctx: CheckInContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): POSCheckInAuditLog[] { return this.audit.slice(); }
  private async recordOr404(ctx: CheckInContext, id: string) { const r = await this.repo.record(ctx, id); if (!r) throw withCode(new ValidationError('Check-in not found'), 'CHECKIN_NOT_FOUND'); return r; }
  // Oct 1 2026: the ONE shared rule (@aipowersalon/appointments resolveCatalogLines). The Sep 28 developer tree saved an
  // unknown id as a $0, 30-minute "Custom Service", trusted the device's duration and recorded any device price as an
  // override with no permission check. Now: unknown ids refused (except one already on this check-in), catalog
  // durations, and a price change or custom service only with the manual-price-override permission and a reason.
  private async resolveServices(ctx: CheckInContext, ids: string[], lines?: any[], overrides?: Record<string, { priceCents: number; reason?: string }>, existing: CheckInServiceLine[] = []): Promise<CheckInServiceLine[]> {
    const catalog = (await this.repo.serviceCatalog(ctx)).map((c: any) => ({ serviceId: c.serviceId, name: c.name, durationMinutes: c.durationMinutes, priceCents: c.priceCents }));
    try {
      return resolveCatalogLines({ catalog, ids, lines, priceOverrides: overrides, mayOverride: hasPermission(ctx as any, PRICE_OVERRIDE_PERMISSION), existing: existing.map((e) => ({ ...e, priceCents: e.priceCents ?? 0 })) as any }) as CheckInServiceLine[];
    } catch (e) { if (e instanceof CatalogLineError) throw new ValidationError(e.message); throw e; }
  }
  /** Lines already approved on the appointment (a manager's price change, a custom line) are carried as they are — the
   *  front desk checking a customer in is not re-authorizing the booking. Only an appointment without lines is resolved. */
  private async appointmentLines(ctx: CheckInContext, appt: any): Promise<CheckInServiceLine[]> {
    const lines: any[] = Array.isArray(appt?.services) ? appt.services : [];
    if (lines.length && lines.every((l) => l && l.serviceId && Number.isFinite(Number(l.durationMinutes)))) {
      return lines.map((l) => ({ serviceId: String(l.serviceId), serviceName: String(l.serviceName ?? l.name ?? 'Service'), durationMinutes: Number(l.durationMinutes), priceCents: l.priceCents ?? 0, ...(l.priceOverrideCents !== undefined ? { priceOverrideCents: l.priceOverrideCents, overrideReason: l.overrideReason } : {}), ...(l.isAddon ? { isAddon: true } : {}), ...(l.parentServiceId ? { parentServiceId: l.parentServiceId } : {}) }));
    }
    return this.resolveServices(ctx, appt.serviceIds ?? []);
  }
  /** B-82 (Oct 23 2026): the exact-service authority (workforce, @Global); null in-memory / dev → the category rule below. */
  eligibility: Pick<TechnicianEligibilityService, 'assert'> | null = null;
  private async techSkilledFor(ctx: CheckInContext, technicianId: string, services: CheckInServiceLine[]): Promise<boolean> {
    // the EXACT service (and certification, branch, employment) — the rule booking and the queue use; never the category
    // when the authority is bound (with all services in one "Nails" category, an unapproved technician was accepted)
    if (this.eligibility && services.length) {
      try { await this.eligibility.assert({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId, serviceIds: services.map((x) => x.serviceId), actor: { userId: ctx.userId ?? null, role: ctx.role ?? null, permissions: ctx.permissions ?? [] } }); return true; }
      catch (e) { if (e instanceof TechnicianEligibilityError) return false; throw e; }
    }
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === technicianId); if (!tech) return false;
    const cat = await this.repo.serviceCatalog(ctx); const cats = new Set(cat.filter((s) => services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    return [...cats].every((c) => tech.skills.includes(c));
  }

  // ---- read ----
  async getState(ctx: CheckInContext, f: CheckInFilters = {}): Promise<POSCheckInFullState> { this.need(ctx, 'pos.check_in.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_check_in_viewed', 'pos_check_in', undefined, undefined, undefined, { filters: f }); return st; }
  async getKpis(ctx: CheckInContext) { return (await this.getState(ctx)).kpis; }
  async recent(ctx: CheckInContext, f: CheckInFilters = {}): Promise<{ items: POSCheckInRow[]; pagination?: any }> { this.need(ctx, 'pos.check_in.view'); return (await this.repo.query(ctx, f)).recentCheckIns; }
  async appointmentsReady(ctx: CheckInContext): Promise<POSCheckInAppointmentRow[]> { this.need(ctx, 'pos.check_in.view'); return this.repo.appointmentsReady(ctx); }
  async detail(ctx: CheckInContext, id: string): Promise<POSCheckInRow> { this.need(ctx, 'pos.check_in.view'); const d = await this.repo.detailRow(ctx, id); if (!d) throw withCode(new ValidationError('Check-in not found'), 'CHECKIN_NOT_FOUND'); return d; }

  async searchCustomers(ctx: CheckInContext, q: string): Promise<POSCheckInCustomerDetail[]> { this.need(ctx, 'pos.customers.view'); const r = await this.repo.customerSearch(ctx, q); this.log(ctx, 'pos_check_in_customer_searched', 'pos_customer', undefined, undefined, undefined, { query: q, results: r.length }); return r; }
  async searchAppointments(ctx: CheckInContext, q: string, date?: string): Promise<POSCheckInAppointmentRow[]> { this.need(ctx, 'pos.check_in.view'); const r = await this.repo.appointmentSearch(ctx, q, date); this.log(ctx, 'pos_check_in_appointment_searched', 'pos_appointment', undefined, undefined, undefined, { query: q, results: r.length }); return r; }
  async waitEstimate(ctx: CheckInContext, serviceIds: string[], technicianId?: string) { this.need(ctx, 'pos.check_in.view'); return this.repo.waitEstimate(ctx, serviceIds, technicianId); }
  // Kiosk place-in-line: scoped by the caller's ctx (the kiosk session's tenant/branch); a public read, no POS permission.
  async placeInLine(ctx: CheckInContext, checkInId: string) { return this.repo.placeInLine(ctx, checkInId); }
  async technicians(ctx: CheckInContext) { this.need(ctx, 'pos.check_in.view'); return (await this.repo.technicians(ctx)).map((t) => ({ technicianId: t.technicianId, name: t.name, available: t.available })); }

  // ---- create customer (dup prevention) ----
  async createCustomer(ctx: CheckInContext, body: CreateCustomerRequest): Promise<POSCheckInCustomerDetail> {
    this.need(ctx, 'pos.customers.create');
    if (!body?.fullName?.trim()) throw new ValidationError('A customer name is required', 'CUSTOMER_NAME_REQUIRED');
    if ((await this.repo.settings(ctx)).requirePhoneForNewCustomer && !body.phone?.trim()) throw withCode(new ValidationError('A phone number is required for a new customer'), 'PHONE_REQUIRED_FOR_NEW_CUSTOMER');
    const dup = findDuplicateCustomer(await this.repo.customerDirectory(ctx), body.phone, body.email);
    if (dup) throw new DuplicateCustomerError(dup);
    const c = await this.repo.createCustomer(ctx, { customerId: 'cust_' + this.repo.nextSeq(), fullName: body.fullName, phone: body.phone, email: body.email, totalVisits: 0, smsOptIn: body.smsOptIn ?? false });
    await this.linkGlobalIdentity(ctx, c.customerId, body.fullName, body.phone, body.email);
    this.log(ctx, 'pos_check_in_customer_created', 'pos_customer', c.customerId, undefined, c);
    return { customerId: c.customerId, fullName: c.fullName, phone: c.phone, email: c.email, totalVisits: 0 };
  }

  // ---- walk-in ----
  async walkIn(ctx: CheckInContext, body: WalkInRequest): Promise<POSCheckInRow> {
    this.need(ctx, 'pos.check_in.walk_in');
    if (!(await this.repo.settings(ctx)).allowWalkIns) throw new ValidationError('Walk-ins are disabled for this tenant', 'WALK_INS_DISABLED');
    if (!body?.customerName?.trim()) throw new ValidationError('A customer name is required', 'CUSTOMER_NAME_REQUIRED');
    // A guest's own check-in (the kiosk / customer display) in a salon that switched service choice off joins the queue
    // without services — the front desk adds them before service starts (the queue refuses to serve with none). It used
    // to be refused here, so such a salon could take no self check-in walk-ins at all. Staff check-ins still need one.
    const noServicesOk = (body as any)?.allowNoServices === true && ctx.role === 'KIOSK';
    if (!body?.serviceIds?.length && !noServicesOk) throw new ValidationError('At least one service is required', 'SERVICES_REQUIRED');
    // Duplicate protection: a client-supplied idempotency key (one per Complete Check-In click) collapses double-clicks
    // and network retries to a single check-in + single queue entry.
    const idemKey = (body as any).idempotencyKey ? String((body as any).idempotencyKey) : null;
    if (idemKey) { const prior = (await this.repo.byCheckInKey(ctx, idemKey))?.checkInId; if (prior) { const ex = await this.repo.detailRow(ctx, prior); if (ex) { this.emitDuplicateCheckin(ctx, { customerRef: prior, checkInMethod: 'walk_in', matchReasons: ['idempotency_replay'] }); this.log(ctx, 'pos_check_in_walk_in_created', 'pos_check_in', prior, undefined, undefined, { duplicate: true, idempotencyKey: idemKey }); return ex; } } }
    const services = await this.resolveServices(ctx, body.serviceIds, body.serviceLines, body.priceOverrides);
    let customerId = body.customerId;
    if (!customerId) {
      // Check-In mandate §112 (Oct 28 2026): an indexed phone lookup when the adapter has one — not the whole directory
      const dup = this.repo.findCustomerByPhone ? await this.repo.findCustomerByPhone(ctx, body.customerPhone) : findDuplicateCustomer(await this.repo.customerDirectory(ctx), body.customerPhone);
      if (dup && !body.isNewCustomer) customerId = dup; // link the existing customer rather than duplicate
      else if (dup && body.isNewCustomer) throw new DuplicateCustomerError(dup);
      else { this.need(ctx, 'pos.check_in.create_customer'); const c = await this.repo.createCustomer(ctx, { customerId: 'cust_' + this.repo.nextSeq(), fullName: body.customerName, phone: body.customerPhone, email: body.customerEmail || undefined, smsOptIn: body.smsOptIn === true, totalVisits: 0 }); customerId = c.customerId; await this.linkGlobalIdentity(ctx, c.customerId, body.customerName, body.customerPhone, body.customerEmail || null); this.log(ctx, 'pos_check_in_customer_created', 'pos_customer', c.customerId); }
    }
    let technicianId: string | null = null; let technicianName: string | null = null;
    if (body.technicianId) { const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId); if (!tech) throw withCode(new ValidationError('Technician not found in this tenant'), 'TECHNICIAN_NOT_FOUND'); technicianId = tech.technicianId; technicianName = tech.name; }
    // One active walk-in per customer (spec §106, §179): the in-process key index cannot see another kiosk or another
    // API instance; the database's partial unique index (migration 503) can. Pre-check for the clear message, and
    // translate the index's refusal when two kiosks race past the pre-check.
    if (customerId && (await this.repo.activeCheckIn(ctx, { customerId }))) {
      // mandate §31: if the active entry is THIS tap's (same key, written by another replica a moment ago) it is the answer
      if (idemKey) { const same = await this.repo.byCheckInKey(ctx, idemKey); if (same) { const ex = await this.repo.detailRow(ctx, same.checkInId); if (ex) return ex; } }
      throw withCode(new CheckInAlreadyExistsError('This customer is already checked in.'), 'CHECKIN_ALREADY_EXISTS');
    }
    const est = await this.repo.waitEstimate(ctx, body.serviceIds, body.technicianId);
    const row = await this.createRecordOrConflict(ctx, { customerId: customerId ?? undefined }, {
      checkInId: 'ci_' + this.repo.nextSeq(), customerId, customerName: body.customerName, customerPhone: body.customerPhone, isVip: !!body.isVip, appointmentId: null,
      source: 'walk_in', services, technicianId, technicianName, checkedInAtMs: Date.now(), quotedWaitMinutes: est.quotedWaitMinutes, status: 'checked_in', notes: body.notes || '', updatedAt: new Date().toISOString(), checkInIdempotencyKey: idemKey,
    });
    this.log(ctx, 'pos_check_in_walk_in_created', 'pos_check_in', row.checkInId, undefined, row);
    await this.ensureQueued(ctx, row); // §2: a successful check-in is automatically placed in Customer Queue
    return (await this.repo.detailRow(ctx, row.checkInId)) ?? row;
  }

  /** Insert the check-in; if the database's one-active-entry index refuses it (another kiosk / instance won the race a
   *  moment ago), answer with the entry that exists: an appointment check-in is idempotent (same visit), a walk-in is
   *  a clear "already checked in". Anything that is not that index's refusal propagates untouched. */
  private async createRecordOrConflict(ctx: CheckInContext, by: { appointmentId?: string; customerId?: string }, rec: Parameters<CheckInRepositoryPort['createRecord']>[1]): Promise<POSCheckInRow> {
    try { return await this.repo.createRecord(ctx, rec); }
    catch (e: any) {
      const msg = String(e?.constraint ?? e?.message ?? '');
      const isOurIndex = e?.code === '23505' && /uq_pos_queue_(active_|checkin_key)/.test(msg);
      if (!isOurIndex) throw e;
      // mandate §31: the same walk-in tap retried at once on several replicas — whichever of our indexes refused it (the
      // one-active-entry index usually fires first), an entry carrying THIS request's key is this request's answer
      if (rec.checkInIdempotencyKey) {
        const same = await this.repo.byCheckInKey(ctx, rec.checkInIdempotencyKey);
        if (same) { const ex = await this.repo.detailRow(ctx, same.checkInId); if (ex) return ex; }
      }
      const winner = await this.repo.activeCheckIn(ctx, by);
      if (by.appointmentId && winner) { const ex = await this.repo.detailRow(ctx, winner.checkInId); if (ex) return ex; }
      throw new CheckInAlreadyExistsError(by.appointmentId ? 'This appointment is already checked in.' : 'This customer is already checked in.');
    }
  }

  // ---- appointment check-in (idempotent) ----
  async appointmentCheckIn(ctx: CheckInContext, appointmentId: string): Promise<POSCheckInRow> {
    this.need(ctx, 'pos.check_in.appointment'); const appt = await this.repo.appointment(ctx, appointmentId); if (!appt) throw withCode(new ValidationError('Appointment not found in this tenant'), 'APPOINTMENT_NOT_FOUND');
    // the in-process index is a fast path; the ACTIVE entry in the database is the truth every kiosk and instance shares
    const existing = this.apptCheckInIndex.get(appointmentId) ?? (await this.repo.activeCheckIn(ctx, { appointmentId }))?.checkInId;
    if (existing) { this.emitDuplicateCheckin(ctx, { appointmentId, customerRef: existing, checkInMethod: 'appointment', matchReasons: ['same_appointment'] }); await this.ensureQueued(ctx, (await this.repo.detailRow(ctx, existing))!); this.log(ctx, 'pos_check_in_appointment_created', 'pos_check_in', existing, undefined, undefined, { duplicate: true, appointmentId }); return (await this.repo.detailRow(ctx, existing))!; }
    const services = await this.appointmentLines(ctx, appt);
    const est = await this.repo.waitEstimate(ctx, appt.serviceIds, appt.technicianId);
    const row = await this.createRecordOrConflict(ctx, { appointmentId }, {
      checkInId: 'ci_' + this.repo.nextSeq(), customerId: appt.customerId, customerName: appt.customerName, customerPhone: appt.customerPhone, isVip: false, appointmentId,
      source: ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'].includes(appt.source) ? appt.source : 'appointment', services, technicianId: appt.technicianId || null, technicianName: appt.technicianName || null, checkedInAtMs: Date.now(), quotedWaitMinutes: est.quotedWaitMinutes, status: 'checked_in', notes: appt.notes || '', updatedAt: new Date().toISOString(),
    });
    this.apptCheckInIndex.set(appointmentId, row.checkInId); await this.repo.markAppointmentCheckedIn(ctx, appointmentId);
    this.log(ctx, 'pos_check_in_appointment_created', 'pos_check_in', row.checkInId, undefined, row, { idempotencyKey: buildAppointmentCheckInKey(appointmentId) });
    await this.ensureQueued(ctx, row); // §2: appointment check-in lands in Customer Queue automatically
    return (await this.repo.detailRow(ctx, row.checkInId)) ?? row;
  }

  /**
   * Every appointment of a visit checked in at once — ALL OR NOTHING (Oct 6 2026). Appointments already checked in come
   * back as duplicates (as appointmentCheckIn's do); the rest are recorded in ONE transaction where the repository can
   * (createVisitRecords), so a failure part-way never leaves the visit half checked in. If another device checks the
   * same visit in at the same moment, its transaction wins whole and this one re-reads it (once).
   */
  async visitCheckIn(ctx: CheckInContext, appointmentIds: string[], retried = false): Promise<{ appointmentId: string; row: POSCheckInRow; duplicate: boolean }[]> {
    this.need(ctx, 'pos.check_in.appointment');
    if (!this.repo.createVisitRecords) {
      const out: { appointmentId: string; row: POSCheckInRow; duplicate: boolean }[] = [];
      for (const id of appointmentIds) { const was = !!(await this.repo.activeCheckIn(ctx, { appointmentId: id })); out.push({ appointmentId: id, row: await this.appointmentCheckIn(ctx, id), duplicate: was }); }
      return out;
    }
    const done = new Map<string, { row: POSCheckInRow; duplicate: boolean }>();
    const fresh: { appointmentId: string; rec: Parameters<CheckInRepositoryPort['createRecord']>[1] }[] = [];
    for (const appointmentId of appointmentIds) {
      const appt = await this.repo.appointment(ctx, appointmentId); if (!appt) throw withCode(new ValidationError('Appointment not found in this tenant'), 'APPOINTMENT_NOT_FOUND');
      const existing = (await this.repo.activeCheckIn(ctx, { appointmentId }))?.checkInId;
      if (existing) {
        this.emitDuplicateCheckin(ctx, { appointmentId, customerRef: existing, checkInMethod: 'appointment', matchReasons: ['same_appointment'] });
        done.set(appointmentId, { row: (await this.repo.detailRow(ctx, existing))!, duplicate: true });
        continue;
      }
      const services = await this.appointmentLines(ctx, appt);
      const est = await this.repo.waitEstimate(ctx, appt.serviceIds, appt.technicianId);
      fresh.push({ appointmentId, rec: {
        checkInId: 'ci_' + this.repo.nextSeq(), customerId: appt.customerId, customerName: appt.customerName, customerPhone: appt.customerPhone, isVip: false, appointmentId,
        source: ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'].includes(appt.source) ? appt.source : 'appointment', services, technicianId: appt.technicianId || null, technicianName: appt.technicianName || null, checkedInAtMs: Date.now(), quotedWaitMinutes: est.quotedWaitMinutes, status: 'checked_in', notes: appt.notes || '', updatedAt: new Date().toISOString(),
      } });
    }
    if (fresh.length) {
      let rows: POSCheckInRow[];
      try { rows = await this.repo.createVisitRecords(ctx, fresh.map((f) => f.rec)); }
      catch (e: any) {
        const isOurIndex = e?.code === '23505' && /uq_pos_queue_active_/.test(String(e?.constraint ?? e?.message ?? ''));
        if (!isOurIndex || retried) throw e;
        return this.visitCheckIn(ctx, appointmentIds, true);   // the other device's visit committed whole: read it back
      }
      rows.forEach((row, i) => {
        const appointmentId = fresh[i].appointmentId;
        this.apptCheckInIndex.set(appointmentId, row.checkInId);
        this.log(ctx, 'pos_check_in_appointment_created', 'pos_check_in', row.checkInId, undefined, row, { idempotencyKey: buildAppointmentCheckInKey(appointmentId), visit: appointmentIds.length > 1 });
        done.set(appointmentId, { row, duplicate: false });
      });
    }
    // after the commit: each entry is in Customer Queue (idempotent — the visit's rows already are)
    for (const id of appointmentIds) await this.ensureQueued(ctx, done.get(id)!.row);
    return Promise.all(appointmentIds.map(async (appointmentId) => { const d = done.get(appointmentId)!; return { appointmentId, row: (await this.repo.detailRow(ctx, d.row.checkInId)) ?? d.row, duplicate: d.duplicate }; }));
  }

  // ---- services / technician / wait ----
  async updateServices(ctx: CheckInContext, id: string, body: UpdateCheckInServicesRequest): Promise<POSCheckInRow> {
    this.need(ctx, 'pos.check_in.edit'); await this.recordOr404(ctx, id);
    if (!body?.serviceIds?.length) throw new ValidationError('At least one service is required', 'SERVICES_REQUIRED');
    const services = await this.resolveServices(ctx, body.serviceIds, body.serviceLines, body.priceOverrides, (await this.repo.record(ctx, id))?.services ?? []);
    const est = await this.repo.waitEstimate(ctx, body.serviceIds);
    await this.repo.update(ctx, id, { services, quotedWaitMinutes: est.quotedWaitMinutes });
    this.log(ctx, 'pos_check_in_services_updated', 'pos_check_in', id, undefined, undefined, { serviceIds: body.serviceIds });
    return (await this.repo.detailRow(ctx, id))!;
  }
  async assignTechnician(ctx: CheckInContext, id: string, body: AssignCheckInTechnicianRequest): Promise<POSCheckInRow> {
    this.need(ctx, 'pos.check_in.assign_technician'); const r = await this.recordOr404(ctx, id);
    if (!body?.technicianId) throw new ValidationError('A technician is required', 'TECHNICIAN_REQUIRED');
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId); if (!tech) throw withCode(new ValidationError('Technician not found in this tenant'), 'TECHNICIAN_NOT_FOUND');
    // Merge Oct 12 2026 (R1/R2, appointments/manager-override.ts): the override is honoured only with pos.booking.override_conflict
    // (audited; requested without it → 403) and bypasses ONLY availability — never skills (a hard rule).
    const override = this.override(ctx, body.managerOverride, 'check_in.assign_technician');
    if (!tech.available && !override) throw new ValidationError('Technician is not available — manager override required', 'TECHNICIAN_UNAVAILABLE_OVERRIDE');
    if (!(await this.techSkilledFor(ctx, body.technicianId, r.services))) throw withCode(new ValidationError('Technician is not skilled for the selected services'), 'TECHNICIAN_NOT_SKILLED_FOR_SERVICES');
    await this.repo.update(ctx, id, { technicianId: tech.technicianId, technicianName: tech.name });
    this.log(ctx, 'pos_check_in_technician_assigned', 'pos_check_in', id, undefined, undefined, { technicianId: body.technicianId, override });
    return (await this.repo.detailRow(ctx, id))!;
  }
  async updateWaitEstimate(ctx: CheckInContext, id: string, body: UpdateWaitEstimateRequest): Promise<POSCheckInRow> {
    this.need(ctx, 'pos.check_in.edit'); const r = await this.recordOr404(ctx, id);
    const quoted = body.quotedWaitMinutes != null ? body.quotedWaitMinutes : (await this.repo.waitEstimate(ctx, r.services.map((s) => s.serviceId), r.technicianId || undefined)).quotedWaitMinutes;
    await this.repo.update(ctx, id, { quotedWaitMinutes: quoted });
    this.log(ctx, 'pos_check_in_wait_estimate_updated', 'pos_check_in', id, undefined, undefined, { quotedWaitMinutes: quoted });
    return (await this.repo.detailRow(ctx, id))!;
  }

  // ---- transfers (idempotent) ----
  async moveToQueue(ctx: CheckInContext, id: string): Promise<{ moved: boolean; duplicate: boolean; queueItemId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.check_in.move_to_queue'); this.need(ctx, 'pos.queue.create'); const r = await this.recordOr404(ctx, id);
    if (r.status === 'cancelled') throw withCode(new ValidationError('A cancelled check-in cannot be moved to the queue'), 'CHECKIN_CANCELLED');
    return this.ensureQueued(ctx, r);
  }
  // §2 single source of truth: idempotently place a checked-in customer into Customer Queue. Called both by the explicit
  // move-to-queue endpoint and automatically at the end of every check-in, so a successful check-in is never left
  // off the queue. The queue idempotency key guarantees exactly one entry across double-clicks / retries / duplicate events.
  /** §343 / B-14: true when every check-in fact (queue.customer_joined, checkin.customer_checked_in, queue.item_updated) is
   *  recorded and the realtime projection delivers it — callers (the Go Check-In kiosk) then push nothing themselves. */
  emitsDomainEvents(): boolean { return !!this.repo.emitsDomainEvents?.(); }
  private async ensureQueued(ctx: CheckInContext, r: { checkInId: string }): Promise<{ moved: boolean; duplicate: boolean; queueItemId: string; idempotencyKey: string }> {
    const id = r.checkInId; const key = buildQueueIdempotencyKey(id);
    if ((await this.repo.getKey(ctx, id, 'queue')) === key) { this.log(ctx, 'pos_check_in_moved_to_queue', 'pos_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, queueItemId: id, idempotencyKey: key }; }
    await this.repo.setKey(ctx, id, 'queue', key); const queueItemId = await this.repo.enqueue(ctx, r as any); await this.repo.setStatus(ctx, id, 'sent_to_queue');
    this.log(ctx, 'pos_check_in_moved_to_queue', 'pos_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key, queueItemId });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.queueUpdated, { queueItemId });   // §343: queue.customer_joined is recorded with the insert
    return { moved: true, duplicate: false, queueItemId, idempotencyKey: key };
  }
  async moveToTechQueue(ctx: CheckInContext, id: string): Promise<{ moved: boolean; duplicate: boolean; techQueueTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.check_in.move_to_tech_queue'); this.need(ctx, 'pos.tech_queue.create'); const r = await this.recordOr404(ctx, id); const key = buildTechQueueIdempotencyKey(id);
    if ((await this.repo.getKey(ctx, id, 'techQueue')) === key) { this.log(ctx, 'pos_check_in_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, techQueueTicketId: id, idempotencyKey: key }; }
    if (r.status === 'cancelled') throw withCode(new ValidationError('A cancelled check-in cannot be moved to the tech queue'), 'CHECKIN_CANCELLED');
    if (!r.technicianId) throw withCode(new ValidationError('An assigned technician is required to move to the tech queue'), 'TECHNICIAN_REQUIRED_FOR_TECH_QUEUE');
    await this.repo.setKey(ctx, id, 'techQueue', key); await this.repo.setStatus(ctx, id, 'sent_to_tech_queue');
    this.log(ctx, 'pos_check_in_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    return { moved: true, duplicate: false, techQueueTicketId: id, idempotencyKey: key };
  }
  async startService(ctx: CheckInContext, id: string): Promise<{ moved: boolean; duplicate: boolean; servingTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.check_in.start_service'); this.need(ctx, 'pos.serving.start'); const r = await this.recordOr404(ctx, id); const key = buildServingIdempotencyKey(id);
    if ((await this.repo.getKey(ctx, id, 'serving')) === key && r.status === 'in_service') { this.log(ctx, 'pos_check_in_started_service', 'pos_serving_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, servingTicketId: id, idempotencyKey: key }; }
    const gate = canStartFromCheckIn(r.status); if (!gate.ok) throw withCode(new ValidationError('Cannot start service: ' + gate.reason), 'CANNOT_START_SERVICE');
    if (r.services.length <= 0) throw new ValidationError('Services are required to start service', 'SERVICES_REQUIRED');
    await this.repo.setKey(ctx, id, 'serving', key); await this.repo.setStatus(ctx, id, 'in_service');
    this.log(ctx, 'pos_check_in_started_service', 'pos_serving_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    return { moved: true, duplicate: false, servingTicketId: id, idempotencyKey: key };
  }

  // ---- cancel ----
  async cancel(ctx: CheckInContext, id: string, body: CancelCheckInRequest): Promise<POSCheckInRow> {
    this.need(ctx, 'pos.check_in.cancel'); await this.recordOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('Cancelling requires a reason', 'CANCEL_REASON_REQUIRED');
    await this.repo.setStatus(ctx, id, 'cancelled'); this.log(ctx, 'pos_check_in_cancelled', 'pos_check_in', id, undefined, undefined, { reason: body.reason, cancelAppointment: !!body.cancelAppointment });
    return (await this.repo.detailRow(ctx, id))!;
  }
}
