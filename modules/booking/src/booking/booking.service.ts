import { TechnicianNotSkilledError, type TechnicianSkillsPort } from './technician-skills.port';
// booking.service.ts — tenant POS Booking (the master appointment module). Resolves tenant/role from session; enforces
// per-action permissions; create/reschedule run conflict + skill + store-hours checks (manager override audited);
// availability reuses the shared engine; check-in and move-to-queue / move-to-tech-queue / start-service are idempotent;
// integration status is honest (not faked); everything is audited. All repository access is async (Postgres-backed in
// production via the Kysely adapter; in-memory in dev).
import { resolveCatalogLines, CatalogLineError, PRICE_OVERRIDE_PERMISSION, resolveManagerOverride, ManagerOverrideForbiddenError } from '@aipowersalon/appointments';
import { type RealtimeEmitter, EVENTS, makeEnvelope, type EventName } from '@aipowersalon/realtime-contracts';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { type BookingCheckinRecorderPort } from '@aipowersalon/reports';
import type { NotificationsService } from '@aipowersalon/communications';
import type { AuditService } from '@aipowersalon/audit';
import { Logger } from '@nestjs/common';
import { foldVi, withCode } from '@aipowersalon/api-contracts';

/** Pure classification of a booking-create failure for the Booking & Check-In Monitor. Permanent validation errors are
 *  marked not-retryable (§28); transient conflicts are retry-available; anything else is a generic unknown error. */
export function bookingFailureClassification(e: unknown): { category: 'booking'; failureType: string; retryStatus: 'not_retryable' | 'retry_available' | 'failed' } {
  if (e instanceof ConflictError) return { category: 'booking', failureType: 'booking_conflict', retryStatus: 'retry_available' };
  if (e instanceof ValidationError) return { category: 'booking', failureType: 'validation_error', retryStatus: 'not_retryable' };
  return { category: 'booking', failureType: 'unknown_error', retryStatus: 'failed' };
}
import {
  POSBookingFullState, BookingFilters, POSBookingAppointmentRow, PBCreateRequest, PBUpdateRequest, PBRescheduleRequest,
  PBAssignTechnicianRequest, PBCancelRequest, PBNoShowRequest, PBConflictCheckRequest, PBAvailabilityQuery, PBServiceLine, PBServiceLineInput,
  BookingIntegrationStatus, pbAddMinutes, pbDuration, pbWithinStoreHours, pbDetectTechnicianConflict, pbDetectCustomerOverlap,
  pbTechDayWindows, pbWithinTechWindows, pbComputeAvailabilityInWindows, pbOpenRanges, type PBMinuteRange,
  pbCanCheckIn, pbCanMarkArrived, pbCanConfirm, pbCanStartService, pbQueueKey, pbTechQueueKey, pbServingKey, BookingConflictRace, BookingSlotHeld, BookingVersionConflict, type BookingConflictCode, type BookingSettings, type BookingChangesResponse, BookingResyncRequired, BOOKING_FEED, encodeBookingCursor, decodeBookingCursor, encodeBookingContinuation, decodeBookingContinuation,
} from './booking.dto';
import { BookingContext, BookingRepositoryPort, type HoldGuard, type RosterRec } from './booking.repository';
import { CHAIR_HOLDING_STATUSES } from '@aipowersalon/api-contracts';
import { BOOKING_TECH_PAGE_SIZE, BOOKING_TECH_PAGE_SIZE_MAX, bookingTechPageMath, bookingTechPageOf, type BookingTechnicianQuery, type BookingTechnicianPage, type BookingTechnicianSummary, type BookingOpening, type BookingOpeningsResponse } from '@aipowersalon/api-contracts/tenant';
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';
import type { BookingHoldGate } from '../customer-booking/booking-slot-hold';

/** Round 2 H (Oct 12 2026): how many technicians a "first available" booking tries after losing the locked re-check
 *  before it answers "nobody is free". Each attempt runs under the same technician+day lock; the loop also ends as soon
 *  as no qualifying technician is left, so this cap only guards a pathological salon. */
export const FIRST_AVAILABLE_MAX_ATTEMPTS = 25;
const minuteOf = (hhmm: string): number => { const [h, m] = String(hhmm).split(':').map((x) => parseInt(x, 10)); return h * 60 + m; };
const HELD_MESSAGE = 'That time is being held for another booking. Please choose another time.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** D11: the slice of the deposit service the POS booking engine needs (modules/booking/src/deposits) */
export interface DepositEndingPort {
  onCancelled(ctx: { tenantId: string; branchId?: string | null; userId?: string | null }, appointmentId: string, by: 'customer' | 'salon'): Promise<unknown>;
  onNoShow(ctx: { tenantId: string; branchId?: string | null; userId?: string | null }, appointmentId: string): Promise<unknown>;
}
export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string, public readonly code?: string, public readonly params?: Record<string, unknown>) { super(msg); this.name = 'ValidationError'; } }   // V-5 (Oct 27 2026): an optional registry code + params beside the English
export class ConflictError extends Error {
  conflictingAppointmentId?: string; code: BookingConflictCode; currentVersion?: number | null;
  /** the day's fresh open times, attached by the controller to a lost booking race (mandate §52) */
  freshAvailability?: unknown;
  constructor(msg: string, conflictingAppointmentId?: string, code: BookingConflictCode = 'APPOINTMENT_CONFLICT', currentVersion?: number | null) {
    super(msg); this.name = 'ConflictError'; this.conflictingAppointmentId = conflictingAppointmentId; this.code = code; this.currentVersion = currentVersion;
  }
}


export interface POSBookingAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

export class BookingService {
  private audit: POSBookingAuditLog[] = [];
  private readonly logger = new Logger('BookingService');
  constructor(private readonly repo: BookingRepositoryPort, private readonly recorder?: BookingCheckinRecorderPort, private readonly notifications?: NotificationsService, private readonly auditService?: AuditService, private readonly realtime?: RealtimeEmitter,
    // Round 2 H: live booking holds (AI receptionist, Reception Copilot, phone verification). Optional — without a
    // database there are no holds and the engine behaves exactly as before.
    private readonly holds?: BookingHoldGate | null,
    // Mandate §51/§78 (Oct 20 2026): THE ONE eligibility authority (workforce TechnicianEligibilityService) through booking's
    // narrow port. Absent (no database / unit tests) → the category rule below; bound in production.
    private readonly skills?: TechnicianSkillsPort | null,
    // D11 (Oct 21 2026): the deposit ends with the appointment — the salon's cancellation refunds it; a no-show forfeits
    // it per the policy snapshot. Optional (null without a database).
    private readonly deposits?: DepositEndingPort | null) {}

  /** Live holds overlapping [startTime, endTime) on `date`: other sessions' (they block) and the booking's own session's
   *  (converted into the appointment). Minutes are the branch's local day. */
  private async holdsAt(ctx: BookingContext, date: string, startTime: string, endTime: string, ownSession?: string | null) {
    const none = { foreign: [] as { technicianId: string | null }[], own: [] as { holdId: string; technicianId: string | null; bookingSessionId: string }[], guard: null as HoldGuard | null };
    if (!this.holds || !ctx.branchId) return none;
    const tz = (await this.repo.clock(ctx)).timeZone;
    const fromMs = localDateTimeToEpochMs(date, startTime, tz), toMs = localDateTimeToEpochMs(date, endTime, tz);
    const live = await this.holds.liveHolds(ctx.tenantId, ctx.branchId, fromMs, toMs);
    // Round 3 H2: this read is only the fast, well-explained pre-check — `guard` makes the repository re-read holds inside
    // its locked transaction (a hold placed between here and the insert is seen there).
    const guard: HoldGuard = { fromMs, toMs, ownSessionId: ownSession && UUID_RE.test(ownSession) ? ownSession : null };
    return { foreign: live.filter((h) => !ownSession || h.bookingSessionId !== ownSession), own: ownSession ? live.filter((h) => h.bookingSessionId === ownSession) : [], guard };
  }
  /** Every live hold on `date`, as minutes of the branch's local day (availability() hides them). */
  private async heldMinutes(ctx: BookingContext, date: string): Promise<{ technicianId: string | null; start: number; end: number }[]> {
    if (!this.holds || !ctx.branchId) return [];
    const tz = (await this.repo.clock(ctx)).timeZone;
    const day0 = localDateTimeToEpochMs(date, '00:00', tz);
    const live = await this.holds.liveHolds(ctx.tenantId, ctx.branchId, day0, day0 + 36 * 3600_000).catch(() => []);
    return live.map((h) => ({ technicianId: h.technicianId ?? null, start: Math.round((h.startsAt - day0) / 60000), end: Math.round((h.endsAt - day0) / 60000) }));
  }
  /** A hold with no technician ("first available") blocks every technician at that time (booking-hold-core overlapsSlot). */
  private static heldFor(foreign: { technicianId: string | null }[], technicianId: string): boolean {
    return foreign.some((h) => h.technicianId == null || h.technicianId === technicianId);
  }

  /** The appointment made (or moved) from its session's own hold uses that hold up. Round 3 H2: a conversion that loses
   *  (a concurrent conversion won, the hold lapsed, or — on a reschedule — the appointment already carries a converted
   *  hold) never undoes the appointment, but it is no longer silent: logged + audited, and a hold that is still live is
   *  released so it cannot keep blocking the slot the appointment now occupies. */
  private async convertOwnHolds(ctx: BookingContext, own: { holdId: string; bookingSessionId: string }[], appointmentId: string): Promise<void> {
    for (const h of own) {
      try {
        await this.holds!.convert(ctx.tenantId, h.holdId, h.bookingSessionId, appointmentId);
      } catch (e: any) {
        const reason = String(e?.reason ?? e?.code ?? e?.name ?? 'error');
        this.logger.warn(`booking hold ${h.holdId} was not converted into appointment ${appointmentId} (${reason}); the appointment stands`);
        this.log(ctx, 'pos_booking_hold_conversion_lost', 'pos_booking_appointment', appointmentId, undefined, undefined, { holdId: h.holdId, reason });
        await this.holds!.release?.(ctx.tenantId, h.holdId, h.bookingSessionId, 'converted').catch(() => false);
      }
    }
  }

  /** Realtime standard (Jul 27, 2026): publish AFTER the repository write, minimal §12 envelope — ids and the
   *  affected date only, never customer names/phones. Best-effort: a realtime hiccup never fails a booking. */
  private announce(ctx: BookingContext, event: EventName, appointmentId: string, extra: Record<string, unknown> = {}): void { try { this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId }, event, makeEnvelope({ eventType: event, tenantId: ctx.tenantId, branchId: ctx.branchId, resourceType: 'appointment', resourceId: appointmentId, data: extra })); } catch { /* realtime is never load-bearing */ } }   // B-14: every call site is §343-guarded

  /** Fail-soft: record a booking-creation failure to the Booking & Check-In Monitor. Monitoring must never break the
   *  booking path, so any recorder error is swallowed. Only genuine validation/conflict failures are recorded. */
  private emitBookingFailure(ctx: BookingContext, body: PBCreateRequest, e: unknown) {
    if (!(e instanceof ValidationError) && !(e instanceof ConflictError)) return;
    const c = bookingFailureClassification(e);
    void this.recorder?.recordFailedEvent({
      tenantId: ctx.tenantId, branchId: ctx.branchId || null, category: c.category, source: body?.source || 'manual',
      failureType: c.failureType, errorMessage: e instanceof Error ? e.message : String(e), retryStatus: c.retryStatus,
      correlationId: 'bk_fail_' + Date.now().toString(36),
    })?.catch(() => undefined);
  }

  private assertUser(ctx: BookingContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Booking is not available for this role');
  }
  /** Smooth Refresh spec §11 — the overbooking policy, in one place. Returns the reasoned overbook to record on the
   *  row, or throws the 409 the caller must relay. `managerOverride` (legacy client flag) counts as a confirmation.
   *    BLOCK                     → APPOINTMENT_CONFLICT, always
   *    WARN_REQUIRE_CONFIRMATION → OVERBOOK_CONFIRMATION_REQUIRED until the booker confirms WITH a reason
   *    ALLOW_AUTHORIZED_ROLE     → as above, and the caller must hold booking.override (owner/manager) */
  private overbookDecision(ctx: BookingContext, settings: BookingSettings, conf: { status: string; conflictingAppointmentId?: string },
                           body: { managerOverride?: boolean; overbookConfirmed?: boolean; overbookReason?: string; reason?: string }, entityId?: string): { reason: string } | null {
    if (conf.status !== 'conflict') return null;
    const policy = settings.overbookingPolicy ?? (settings.allowOverbooking ? 'WARN_REQUIRE_CONFIRMATION' : 'BLOCK');
    const cid = conf.conflictingAppointmentId;
    if (policy === 'BLOCK') throw withCode(new ConflictError('This time was just booked or changed on another device. The schedule has been refreshed.', cid), 'SCHEDULE_CHANGED_ELSEWHERE');
    if (policy === 'ALLOW_AUTHORIZED_ROLE' && !hasPermission(ctx as any, 'pos.booking.override_conflict')) {
      throw withCode(new ConflictError('Technician is double-booked at that time. An owner or manager can authorize an intentional double booking.', cid), 'TECHNICIAN_DOUBLE_BOOKED');
    }
    const confirmed = !!(body.overbookConfirmed || body.managerOverride);
    const reason = (body.overbookReason || body.reason || '').trim();
    if (!confirmed || !reason) throw new ConflictError('Technician is double-booked at that time. Confirm the double booking with a reason to continue.', cid, 'OVERBOOK_CONFIRMATION_REQUIRED');
    this.log(ctx, 'pos_booking_conflict_override', 'pos_booking_conflict', entityId, undefined, undefined, { conflictingAppointmentId: cid, reason, policy });
    return { reason };
  }
  /** Bypassing store hours / working hours / an overlap is an authorized override (spec §71/§72), not a client checkbox.
   *  Merge Oct 12 2026 (R1, appointments/manager-override.ts): a request that asks for it WITHOUT pos.booking.override_conflict
   *  is refused (403, no silent downgrade); an honoured one is audited (`manager_override_used`). Skills are never overridable. */
  private overrideAllowed(ctx: BookingContext, body: { managerOverride?: boolean }, action = 'booking'): boolean {
    try { return resolveManagerOverride(ctx, body?.managerOverride, (m) => this.log(ctx, 'manager_override_used', 'manager_override', undefined, undefined, undefined, { ...m }), action); }
    catch (e) { if (e instanceof ManagerOverrideForbiddenError) throw new ForbiddenError(e.message); throw e; }
  }
  private relayRepoConflict(e: unknown): never {
    if (e instanceof BookingSlotHeld) throw new ConflictError(HELD_MESSAGE);
    if (e instanceof BookingConflictRace) throw withCode(new ConflictError('This time was just booked or changed on another device. The schedule has been refreshed.', e.conflictingAppointmentId), 'SCHEDULE_CHANGED_ELSEWHERE');
    if (e instanceof BookingVersionConflict) throw new ConflictError(e.message, undefined, 'VERSION_CONFLICT', e.currentVersion);
    throw e;
  }
  private need(ctx: BookingContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private log(ctx: BookingContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
    // Persist through the platform audit trail (append-only audit_events) when wired. Fail-soft by contract:
    // AuditService.record never throws into the caller's path, so booking flows are never broken by audit issues.
    void this.auditService?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null },
      { module: 'pos_booking', action: actionType, resourceType: entityType, resourceId: entityId ?? null, metadata: { ...(metadata ?? {}), ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) } },
    );
  }
  auditLog(): POSBookingAuditLog[] { return this.audit.slice(); }


  /** Best-effort customer notification for schedule changes. Fire-and-forget: failures are swallowed after an audit
   *  note; when no NotificationsService is wired (in-memory dev) the result is honestly 'not configured'. */
  private notifyCustomer(ctx: BookingContext, a: { customerPhone?: string | null; customerName: string }, body: string, kind: string, appointmentId: string): void {
    const to = (a.customerPhone || '').trim();
    if (!this.notifications || !to) { this.log(ctx, 'pos_booking_notification_skipped', 'pos_booking_appointment', appointmentId, undefined, undefined, { kind, reason: !this.notifications ? 'not_configured' : 'no_phone' }); return; }
    this.notifications.send({ tenantId: ctx.tenantId, userId: ctx.userId || '', role: ctx.role }, { channel: 'sms', to, body })
      .then((r) => this.log(ctx, 'pos_booking_notification_result', 'pos_booking_appointment', appointmentId, undefined, undefined, { kind, sent: !!r?.sent, status: r?.status }))
      .catch(() => this.log(ctx, 'pos_booking_notification_result', 'pos_booking_appointment', appointmentId, undefined, undefined, { kind, sent: false, status: 'error' }));
  }

  private dowOf(date: unknown): number {
    // Defense-in-depth: pg date columns can surface as JS Date objects. A malformed input must never silently
    // disable schedule enforcement (NaN weekday → empty schedule → store-hours fallback), so normalize first.
    const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date ?? '').slice(0, 10);
    return new Date(iso + 'T00:00:00Z').getUTCDay();
  }
  /** Store hours ∩ tech schedule − lunch − blocks for one tech on one date. */
  private async windowsFor(ctx: BookingContext, date: string, technicianId: string): Promise<PBMinuteRange[]> {
    const settings = await this.repo.settings(ctx);
    const scheds = await this.repo.techSchedules(ctx, this.dowOf(date), date);
    const blocks = await this.repo.blockedTimes(ctx, date);
    return pbTechDayWindows(settings.openTime, settings.closeTime, scheds[technicianId] ?? null, blocks[technicianId] ?? []);
  }

  private async bookingOr404(ctx: BookingContext, id: string) { const a = await this.repo.booking(ctx, id); if (!a) throw withCode(new ValidationError('Booking not found'), 'BOOKING_NOT_FOUND'); return a; }

  // Services come from the salon's catalog through the ONE shared rule (@aipowersalon/appointments resolveCatalogLines):
  // unknown ids refused (unless already on the booking being edited), catalog durations, and a price change or custom
  // service only with the manual-price-override permission and a reason. The Sep 28 developer tree had let unknown ids
  // through at $0 and trusted the client's duration and price.
  private async resolveServices(
    ctx: BookingContext,
    ids: string[],
    serviceLines?: PBServiceLineInput[],
    priceOverrides?: Record<string, { priceCents: number; reason?: string }>,
    existing?: PBServiceLine[],
  ): Promise<PBServiceLine[]> {
    const catalog = (await this.repo.serviceCatalog(ctx)).map((c) => ({ serviceId: c.serviceId, name: c.name, durationMinutes: c.durationMinutes, priceCents: c.priceCents }));
    try {
      return resolveCatalogLines({ catalog, ids, lines: serviceLines as any, priceOverrides, mayOverride: hasPermission(ctx as any, PRICE_OVERRIDE_PERMISSION), existing: existing as any }) as PBServiceLine[];
    } catch (e) { if (e instanceof CatalogLineError) throw new ValidationError(e.message); throw e; }
  }
  /**
   * The platform's "any technician" rule, in the staff engine — the customer app's rule (CustomerBookingService
   * availability → `slot.technicianIds[0]`: active technicians in NAME order, the first one free for the whole visit),
   * plus the gates create() applies to an explicitly chosen technician (skilled for every service's category, inside
   * their working windows that day, no conflict incl. buffer) so a first-available booking can never land where an
   * explicit one would be refused. Nobody qualifies → the same honest 409 a taken slot gets. The locked re-check inside
   * the repository transaction still decides a race between two first-available bookings.
   */
  private async firstAvailableTechnician(ctx: BookingContext, date: string, startTime: string, endTime: string, services: PBServiceLine[], settings: BookingSettings, skip: (technicianId: string) => boolean = () => false): Promise<string> {
    const [techs, catalog, scheds, blocks, existing] = await Promise.all([
      this.repo.technicians(ctx), this.repo.serviceCatalog(ctx), this.repo.techSchedules(ctx, this.dowOf(date), date), this.repo.blockedTimes(ctx, date), this.repo.existingForConflict(ctx, date),
    ]);
    void catalog;
    const ordered = techs.filter((t) => t.available).sort((a, b) => a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId));
    const skilled = await this.skilledSet(ctx, ordered, services);   // hard eligibility first, in one batch (mandate §14)
    for (const t of ordered) {
      if (skip(t.technicianId)) continue;   // held by another session, or already lost a race for this booking
      if (!skilled.has(t.technicianId)) continue;
      const windows = pbTechDayWindows(settings.openTime, settings.closeTime, scheds[t.technicianId] ?? null, blocks[t.technicianId] ?? []);
      if (!pbWithinTechWindows(startTime, endTime, windows)) continue;
      if (pbDetectTechnicianConflict(existing, t.technicianId, startTime, endTime, settings.bufferMinutes).status !== 'none') continue;
      return t.technicianId;
    }
    throw withCode(new ConflictError('No technician is available at that time. Please choose another time.'), 'NO_TECHNICIAN_AVAILABLE');
  }
  /** Exact service (+ certification) when the eligibility authority is bound; the category rule otherwise. */
  private async eligibleFor(ctx: BookingContext, t: { technicianId: string; skills: string[] }, services: PBServiceLine[], cats: Set<string>): Promise<boolean> {
    if (this.skills) return this.skills.isSkilled({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId: t.technicianId, serviceIds: services.map((s) => s.serviceId), actor: { userId: ctx.userId, role: ctx.role, permissions: ctx.permissions } });
    return [...cats].every((c) => t.skills.includes(c));
  }
  /** 200-technician mandate §14/§16/§26 (Oct 23 2026): who among `techs` may do every service — ONE batch read through the
   *  eligibility authority (it was one isSkilled() chain per technician: 200 technicians → 200 reads per question). */
  private async skilledSet(ctx: BookingContext, techs: { technicianId: string; skills: string[] }[], services: PBServiceLine[]): Promise<Set<string>> {
    if (!techs.length || !services.length) return new Set(techs.map((t) => t.technicianId));
    if (this.skills?.skilledAmong) {
      return this.skills.skilledAmong({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianIds: techs.map((t) => t.technicianId), serviceIds: services.map((s) => s.serviceId), actor: { userId: ctx.userId, role: ctx.role, permissions: ctx.permissions } });
    }
    const catalog = await this.repo.serviceCatalog(ctx);
    const cats = new Set(catalog.filter((c) => services.some((rs) => rs.serviceId === c.serviceId)).map((c) => c.categoryName));
    const out = new Set<string>();
    for (const t of techs) if (await this.eligibleFor(ctx, t, services, cats)) out.add(t.technicianId);
    return out;
  }
  /** Mandate §51/§78: the exact-service eligibility authority when bound (its own message and code reach the POS);
   *  the category rule only when it is not. Never overridable (R2). */
  private async assertTechSkilled(ctx: BookingContext, technicianId: string, services: PBServiceLine[]): Promise<void> {
    if (this.skills) {
      try { await this.skills.assertSkilled({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId, serviceIds: services.map((s) => s.serviceId), actor: { userId: ctx.userId, role: ctx.role, permissions: ctx.permissions } }); return; }
      catch (e: any) { if (e instanceof TechnicianNotSkilledError || e?.name === 'TechnicianNotSkilledError') throw new ValidationError(e.message || 'Technician is not skilled for the selected services'); throw e; }
    }
    if (!(await this.techSkilledFor(ctx, technicianId, services))) throw withCode(new ValidationError('Technician is not skilled for the selected services'), 'TECHNICIAN_NOT_SKILLED_FOR_SERVICES');
  }
  private async techSkilledFor(ctx: BookingContext, technicianId: string, services: PBServiceLine[]): Promise<boolean> {
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === technicianId); if (!tech) return false;
    const cat = await this.repo.serviceCatalog(ctx); const cats = new Set(cat.filter((s) => services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    return [...cats].every((c) => tech.skills.includes(c));
  }

  // ---- read ----
  async getState(ctx: BookingContext, f: BookingFilters = {}): Promise<POSBookingFullState> { this.need(ctx, 'pos.booking.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_booking_viewed', 'pos_booking', undefined, undefined, undefined, { filters: f });
    // §2: the board asks for no roster — it pages technicians from GET /technicians (200 names never ride along)
    return f.roster === 'none' ? { ...st, filters: { ...st.filters, technicians: [] } } : st; }
  async getKpis(ctx: BookingContext) { return (await this.getState(ctx)).kpis; }
  async appointments(ctx: BookingContext, f: BookingFilters = {}): Promise<{ items: POSBookingAppointmentRow[]; pagination?: any }> { this.need(ctx, 'pos.booking.view'); return (await this.repo.query(ctx, f)).bookings; }
  /** Smooth Refresh spec §25–§27/§89/§91 — the Booking board change feed. The board's 15 s safety sync asks "what
   *  changed since my cursor?" instead of downloading the whole board; most ticks return nothing. Rows are complete
   *  appointment rows (same mapping as detail()); a cancelled/moved row comes back with its new status/date so the
   *  board can drop it. An unusable cursor or a burst of changes → RESYNC_REQUIRED (the board reloads its snapshot,
   *  still without a page refresh — §27). */
  async changes(ctx: BookingContext, cursor?: string, nowMs: number = Date.now()): Promise<BookingChangesResponse> {
    this.need(ctx, 'pos.booking.view');
    const serverTime = new Date(nowMs).toISOString();
    const since = decodeBookingCursor(cursor, nowMs);
    if (!since) return { appointments: [], cursor: encodeBookingCursor(serverTime), serverTime, hasMore: false };   // first call: baseline only
    if (!this.repo.changedSince) throw new BookingResyncRequired('cursor_invalid');
    // M4: a sweep = one tick's read, paged. Its lower bound (the tick cursor − lookBack) and upper bound (the server time
    // of its first page) are fixed for every page, so a board that keeps changing cannot make a sweep endless; rows
    // stamped after `upto` belong to the next sweep.
    const cont = cursor?.startsWith('v2.') ? decodeBookingContinuation(cursor, nowMs) : null;
    const upto = cont ? cont.upto : nowMs;
    const page = cont ? cont.page + 1 : 1;
    if (page > BOOKING_FEED.maxPages) throw new BookingResyncRequired('too_many_changes');
    const from = new Date(since.getTime() - BOOKING_FEED.lookBackMs);
    const changed = await this.repo.changedSince(ctx, from, BOOKING_FEED.pageRows + 1, { upto: new Date(upto), ...(cont ? { after: { ms: cont.afterMs, id: cont.afterId } } : {}) });
    const hasMore = changed.length > BOOKING_FEED.pageRows;
    const rows = hasMore ? changed.slice(0, BOOKING_FEED.pageRows) : changed;
    if (hasMore && page >= BOOKING_FEED.maxPages) throw new BookingResyncRequired('too_many_changes');   // > maxPages × pageRows: one reload is cheaper
    const appointments: POSBookingAppointmentRow[] = [];
    if (this.repo.detailsMany) appointments.push(...(await this.repo.detailsMany(ctx, rows.map((c) => c.id))));   // mandate §26: one batch
    else for (const c of rows) { const row = await this.repo.detail(ctx, c.id); if (row) appointments.push(row); }
    if (hasMore) {
      const last = rows[rows.length - 1];
      return { appointments, serverTime, hasMore: true,
        cursor: encodeBookingContinuation({ since: since.getTime(), upto, afterMs: Math.floor(Date.parse(last.updatedAt)), afterId: last.id, page }) };
    }
    // The next cursor never moves backwards and never past the sweep's upper bound ("now" of its first page) — rows
    // stamped later (clock skew between app and DB, or written during the sweep) are re-read next time rather than
    // skipped. It also ADVANCES on a quiet tick, to at least upto − lookBack: every row stamped before that has committed
    // (the look-back assumption the feed already rests on) and was covered by this sweep. Without that, a quiet board's
    // cursor stayed at its last change and after maxAgeMs (30 min) every tick was answered RESYNC_REQUIRED — a full
    // reload of every idle board each half hour.
    const newest = rows.length ? Date.parse(rows[rows.length - 1].updatedAt) : (cont ? cont.afterMs : since.getTime());
    const next = Math.max(since.getTime(), Math.min(upto, Math.max(newest, upto - BOOKING_FEED.lookBackMs)));
    return { appointments, cursor: encodeBookingCursor(new Date(next).toISOString()), serverTime, hasMore: false };
  }

  async detail(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow> { this.need(ctx, 'pos.booking.view'); const d = await this.repo.detail(ctx, id); if (!d) throw withCode(new ValidationError('Booking not found'), 'BOOKING_NOT_FOUND'); this.log(ctx, 'pos_booking_appointment_viewed', 'pos_booking_appointment', id); return d; }
  async integrationStatus(ctx: BookingContext): Promise<BookingIntegrationStatus> { this.need(ctx, 'pos.booking.view'); return this.repo.integrationStatus(ctx); }

  // ---- availability (§13) ----
  async availability(ctx: BookingContext, q: PBAvailabilityQuery): Promise<{ technicianId: string; name: string; slots: string[] }[]> {
    this.need(ctx, 'pos.booking.view');
    const date = q.date || (await this.repo.clock(ctx)).today;
    const services = q.serviceIds?.length ? await this.resolveServices(ctx, q.serviceIds) : [];
    const ids = q.technicianId ? [q.technicianId] : (q.technicianIds?.length ? q.technicianIds.slice(0, BOOKING_TECH_PAGE_SIZE_MAX) : undefined);
    return (await this.availabilityCore(ctx, date, services, ids)).rows;
  }
  /** Schedule-aware open starts per technician: store hours ∩ weekly schedule − lunch − blocked times / time off − bookings
   *  (+ buffer) − other sessions' holds. With services named, a technician who may not perform them is offered NO slots
   *  (Deep-scan Oct 22 2026; the eligibility read is one batch since Oct 23). `ids` limits the work to those technicians
   *  (the visible page — mandate §28: only useful openings for the technicians on screen). */
  private async availabilityCore(ctx: BookingContext, date: string, services: PBServiceLine[], ids?: string[]) {
    const settings = await this.repo.settings(ctx);
    const dur = services.length ? pbDuration(services) : settings.defaultServiceDurationMinutes;
    const [techs, scheds, blocks, existing, held] = await Promise.all([
      this.repo.technicians(ctx, ids), this.repo.techSchedules(ctx, this.dowOf(date), date), this.repo.blockedTimes(ctx, date), this.repo.existingForConflict(ctx, date),
      this.heldMinutes(ctx, date),
    ]);
    const skilled = services.length ? await this.skilledSet(ctx, techs.filter((t) => t.available), services) : null;
    const busyBy = new Map<string, { startTime: string; endTime: string; status: any }[]>();
    for (const a of existing) if (a.technicianId) { const l = busyBy.get(a.technicianId) ?? []; l.push({ startTime: a.startTime, endTime: a.endTime, status: a.status }); busyBy.set(a.technicianId, l); }
    const rows = techs.map((t) => {
      const windows = t.available && (!skilled || skilled.has(t.technicianId)) ? pbTechDayWindows(settings.openTime, settings.closeTime, scheds[t.technicianId] ?? null, blocks[t.technicianId] ?? []) : [];
      const mine = busyBy.get(t.technicianId) ?? [];
      // Round 2 H: a slot another session holds is not offered to anyone else (a first-available hold covers every technician).
      const blocked = held.filter((h) => h.technicianId == null || h.technicianId === t.technicianId);
      const slots = pbComputeAvailabilityInWindows(windows, settings.slotIntervalMinutes, dur, settings.bufferMinutes, mine)
        .filter((sl) => { const a = minuteOf(sl), b = a + dur; return !blocked.some((h) => h.start < b && a < h.end); });
      return { technicianId: t.technicianId, name: t.name, slots };
    });
    return { rows, techs, skilled, durationMinutes: dur };
  }

  /** 200-technician mandate §8–§12/§27 (Oct 23 2026): the board's technician columns, paged ON THE SERVER. The whole roster
   *  is one light read; search / working / status / skill / exact-service filters run here; only the visible page reads its
   *  detail (skills, rating, photo). `locate` answers the page that holds one technician (jump-to-technician). Tenant and
   *  branch come from the session — a client cannot page another salon. Never payroll / private fields. */
  async technicianPage(ctx: BookingContext, q: BookingTechnicianQuery = {}): Promise<BookingTechnicianPage> {
    this.need(ctx, 'pos.booking.view');
    const clk = await this.repo.clock(ctx);
    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : clk.today;
    const pageSize = Math.min(BOOKING_TECH_PAGE_SIZE_MAX, Math.max(1, Math.trunc(Number(q.pageSize)) || BOOKING_TECH_PAGE_SIZE));
    const settings = await this.repo.settings(ctx);
    const roster: RosterRec[] = this.repo.technicianRoster ? await this.repo.technicianRoster(ctx)
      : (await this.repo.technicians(ctx)).sort((a, b) => a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId)).map((t) => ({ technicianId: t.technicianId, name: t.name, available: t.available, searchText: t.name.toLowerCase() }));
    const [scheds, blocks] = await Promise.all([this.repo.techSchedules(ctx, this.dowOf(date), date), this.repo.blockedTimes(ctx, date)]);
    const number = new Map(roster.map((t, i) => [t.technicianId, i + 1]));
    const working = new Map(roster.map((t) => [t.technicianId, t.available && pbTechDayWindows(settings.openTime, settings.closeTime, scheds[t.technicianId] ?? null, blocks[t.technicianId] ?? []).length > 0]));
    const status = q.status === 'inactive' || q.status === 'all' ? q.status : 'active';
    let list = roster.filter((t) => (status === 'all' ? true : status === 'active' ? t.available : !t.available));
    if (q.working) list = list.filter((t) => working.get(t.technicianId));
    const term = String(q.search ?? '').trim().toLowerCase();
    if (term) {
      const num = /^#?\d{1,6}$/.test(term) ? Number(term.replace('#', '')) : null;
      const digits = term.replace(/\D/g, '');
      // accent-insensitive (Vietnamese POS mandate §41): "tran" finds "Trần", "dang" finds "Đặng" — the stored name is untouched
      const folded = foldVi(term);
      list = list.filter((t) => (num != null && number.get(t.technicianId) === num) || t.searchText.includes(term) || (!!folded && foldVi(t.searchText).includes(folded)) || (digits.length >= 4 && t.searchText.includes(digits)));
    }
    if (q.skill) {
      const detail = await this.repo.technicians(ctx, list.map((t) => t.technicianId));
      const has = new Set(detail.filter((t) => t.skills.includes(String(q.skill))).map((t) => t.technicianId));
      list = list.filter((t) => has.has(t.technicianId));
    }
    let eligibleFlag: boolean | undefined;
    if (q.serviceIds?.length) {
      const services = await this.resolveServices(ctx, q.serviceIds);
      const ok = await this.skilledSet(ctx, list.map((t) => ({ technicianId: t.technicianId, skills: [] })), services);
      list = list.filter((t) => ok.has(t.technicianId)); eligibleFlag = true;
    }
    let located: BookingTechnicianPage['located'];
    let wantPage = Number(q.page) || 1;
    if (q.locate) {
      const idx = list.findIndex((t) => t.technicianId === q.locate);
      located = idx >= 0 ? { technicianId: q.locate, page: bookingTechPageOf(idx, pageSize), index: idx } : null;
      if (located) wantPage = located.page;
    }
    const m = bookingTechPageMath(list.length, pageSize, wantPage);
    const pageIds = list.slice(m.startIndex, m.endIndex).map((t) => t.technicianId);
    const detail = new Map((await this.repo.technicians(ctx, pageIds)).map((t) => [t.technicianId, t]));
    const technicians: BookingTechnicianSummary[] = pageIds.map((id) => {
      const r = roster.find((t) => t.technicianId === id)!; const d = detail.get(id);
      return { technicianId: id, name: r.name, rosterNumber: number.get(id)!, avatarUrl: d?.avatarUrl ?? null, available: r.available, workingToday: !!working.get(id),
        skills: d?.skills ?? [], rating: d?.rating ?? null, reviewCount: d?.reviewCount ?? 0, ...(eligibleFlag ? { eligible: true } : {}) };
    });
    // today: who is free RIGHT NOW (inside a working window, no chair-holding appointment at this minute) — whole roster
    let availableNowCount: number | undefined;
    if (date === clk.today) {
      const existing = await this.repo.existingForConflict(ctx, date);
      const busyNow = new Set(existing.filter((a) => a.technicianId && (CHAIR_HOLDING_STATUSES as readonly string[]).includes(a.status) && minuteOf(a.startTime) <= clk.nowMinute && clk.nowMinute < minuteOf(a.endTime)).map((a) => a.technicianId!));
      availableNowCount = roster.filter((t) => t.available && !busyNow.has(t.technicianId)
        && pbTechDayWindows(settings.openTime, settings.closeTime, scheds[t.technicianId] ?? null, blocks[t.technicianId] ?? []).some((w) => w.start <= clk.nowMinute && clk.nowMinute < w.end)).length;
    }
    return { date, technicians, total: list.length, totalAll: roster.length, workingCount: roster.filter((t) => working.get(t.technicianId)).length, ...(availableNowCount != null ? { availableNowCount } : {}),
      page: m.page, pageSize, totalPages: m.totalPages, ...(q.locate ? { located: located ?? null } : {}) };
  }

  /** 200-technician mandate §15–§17/§85/§86: Find an Opening + Best Matches on the server. Hard eligibility first (an
   *  ineligible technician never reaches the ranking), then rank: earliest start, then most openings left that day, then
   *  rating, then roster order — deterministic for identical state. Top `limit` (default 10) + `hasMore` (View More). */
  async openings(ctx: BookingContext, q: { date?: string; serviceIds?: string[]; limit?: number; offset?: number }): Promise<BookingOpeningsResponse> {
    this.need(ctx, 'pos.booking.view');
    const clk = await this.repo.clock(ctx);
    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : clk.today;
    const services = q.serviceIds?.length ? await this.resolveServices(ctx, q.serviceIds) : [];
    const limit = Math.min(50, Math.max(1, Math.trunc(Number(q.limit)) || 10)), offset = Math.max(0, Math.trunc(Number(q.offset)) || 0);
    const { rows, techs, skilled, durationMinutes } = await this.availabilityCore(ctx, date, services);
    const notBefore = date === clk.today ? clk.nowMinute : -1;
    const order = new Map([...techs].sort((a, b) => a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId)).map((t, i) => [t.technicianId, i + 1]));
    const byId = new Map(techs.map((t) => [t.technicianId, t]));
    const eligible = techs.filter((t) => t.available && (!skilled || skilled.has(t.technicianId)));
    const ranked = rows
      .filter((r) => byId.get(r.technicianId)?.available && (!skilled || skilled.has(r.technicianId)))
      .map((r) => { const open = r.slots.filter((sl) => minuteOf(sl) >= notBefore); return { r, open }; })
      .filter((x) => x.open.length > 0)
      .map((x) => ({ technicianId: x.r.technicianId, name: x.r.name, rosterNumber: order.get(x.r.technicianId) ?? 0, time: x.open[0], openSlots: x.open.length, rating: byId.get(x.r.technicianId)?.rating ?? 0 }))
      .sort((a, b) => a.time.localeCompare(b.time) || b.openSlots - a.openSlots || (b.rating ?? 0) - (a.rating ?? 0) || a.rosterNumber - b.rosterNumber);
    const openings: BookingOpening[] = ranked.slice(offset, offset + limit).map((o, i) => ({ technicianId: o.technicianId, name: o.name, rosterNumber: o.rosterNumber, time: o.time, openSlots: o.openSlots, rank: offset + i + 1 }));
    return { date, serviceIds: services.map((x) => x.serviceId), durationMinutes, eligibleCount: eligible.length, withOpenings: ranked.length, openings, hasMore: offset + limit < ranked.length, offset, limit };
  }

  /** BUILD_PLAN Phase 4: the bookable catalog as the engine sees it (the ids create() accepts) — for the signed public
   *  booking page, which listed the salon through public DISCOVERY instead (a branch id it never had, a listing flag
   *  the link does not need, a field name it did not read) and so could load no services at all. */
  async catalog(ctx: BookingContext): Promise<{ serviceId: string; name: string; durationMinutes: number; priceCents: number }[]> {
    this.need(ctx, 'pos.booking.view');
    return (await this.repo.serviceCatalog(ctx)).map((c) => ({ serviceId: c.serviceId, name: c.name, durationMinutes: c.durationMinutes, priceCents: c.priceCents }));
  }

  // ---- conflict check (§12) ----
  async checkConflict(ctx: BookingContext, body: PBConflictCheckRequest): Promise<{ status: string; conflictingAppointmentId?: string }> {
    this.need(ctx, 'pos.booking.view'); const date = body.date || (await this.repo.clock(ctx)).today;
    const res = pbDetectTechnicianConflict(await this.repo.existingForConflict(ctx, date), body.technicianId, body.startTime, body.endTime, (await this.repo.settings(ctx)).bufferMinutes, body.appointmentId);
    this.log(ctx, 'pos_booking_conflict_checked', 'pos_booking_conflict', body.appointmentId, undefined, undefined, { status: res.status });
    return res;
  }

  // ---- create / edit ----
  async create(ctx: BookingContext, body: PBCreateRequest): Promise<POSBookingAppointmentRow> {
    try {
      return await this.createInner(ctx, body);
    } catch (e) {
      this.emitBookingFailure(ctx, body, e); // fail-soft monitoring hook; never alters the thrown error
      throw e;
    }
  }

  private async createInner(ctx: BookingContext, body: PBCreateRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.create');
    if (!body?.customerName?.trim()) throw new ValidationError('A customer (or walk-in name) is required', 'CUSTOMER_NAME_REQUIRED');
    if (!body?.serviceIds?.length) throw new ValidationError('At least one service is required', 'SERVICES_REQUIRED');
    if (!body?.startTime || !body?.date) throw withCode(new ValidationError('A date and start time are required'), 'DATE_START_REQUIRED');
    const services = await this.resolveServices(ctx, body.serviceIds, body.serviceLines, body.priceOverrides);
    const duration = pbDuration(services); if (duration <= 0) throw withCode(new ValidationError('Duration must be greater than 0'), 'DURATION_INVALID');
    const endTime = pbAddMinutes(body.startTime, duration);
    const settings = await this.repo.settings(ctx);
    const override = this.overrideAllowed(ctx, body, 'booking.create');
    body = { ...body, managerOverride: override };   // the overbook policy below counts an HONOURED override as a confirmation
    if (!pbWithinStoreHours(body.startTime, endTime, settings.openTime, settings.closeTime) && !override) throw new ValidationError('Booking is outside store hours — manager override required', 'OUTSIDE_STORE_HOURS');
    // Round 2 H: live holds. Another session's hold blocks its technician (a first-available hold blocks all); the hold
    // of the booking's OWN session (the receptionist / copilot that held this time) is the one this booking converts.
    const held = await this.holdsAt(ctx, body.date, body.startTime, endTime, body.holdSessionId ?? null);
    if (body.technicianId && BookingService.heldFor(held.foreign, body.technicianId)) throw new ConflictError(HELD_MESSAGE);
    const heldTech = held.own.find((h) => h.technicianId)?.technicianId ?? null;
    const ts = new Date().toISOString();
    const finalNotes = [body.notes, body.partySize && body.partySize > 1 ? `Party of ${body.partySize}` : null].filter(Boolean).join(' • ');
    // "First available" race (Round 2 H, Phase 15 G): concurrent first-available bookings all pick the same first free
    // technician before the locked re-check; the losers used to get a 409 while other technicians were free. Now a lost
    // race (BookingConflictRace from the repository's technician+day lock) retries with the next qualifying technician —
    // each attempt under the same lock discipline — and answers "taken" only when nobody qualifies any more.
    const lost = new Set<string>();
    let row!: POSBookingAppointmentRow;
    for (let attempt = 1; ; attempt++) {
      let overbook: { reason: string } | null = null;
      // "First available" (no technician chosen — the public booking link, the AI receptionist, the POS chip): the engine
      // assigns one by the platform's "any technician" rule. Without this the row reached the NOT NULL technician_id
      // column and the guest got an internal error (Phase 15, PROGRAMME_DOD_STATUS §6 item 4).
      const technicianId = body.technicianId || (heldTech && !lost.has(heldTech) ? heldTech : null)
        || await this.firstAvailableTechnician(ctx, body.date, body.startTime, endTime, services, settings, (id) => lost.has(id) || BookingService.heldFor(held.foreign, id));
      if (technicianId) {
        await this.assertTechSkilled(ctx, technicianId, services);   // hard rule: never overridable (R2)
        if (!pbWithinTechWindows(body.startTime, endTime, await this.windowsFor(ctx, body.date, technicianId)) && !override) {
          throw new ValidationError("That time falls outside the technician's working hours (schedule, lunch, or blocked time) — manager override required", 'OUTSIDE_TECHNICIAN_HOURS');
        }
        const existing = await this.repo.existingForConflict(ctx, body.date);
        const conf = pbDetectTechnicianConflict(existing, technicianId, body.startTime, endTime, settings.bufferMinutes);
        // An engine-picked technician who became busy since the pick (a concurrent first-available booking committed in
        // between) is a lost race too — never an overbook question for a technician nobody chose.
        if (!body.technicianId && conf.status === 'conflict' && attempt < FIRST_AVAILABLE_MAX_ATTEMPTS) { lost.add(technicianId); continue; }
        // Spec §11: the overbooking policy decides (BLOCK by default); the authoritative re-check runs under the
        // technician+day lock inside the repository transaction, and the database guard is the last line of defense.
        overbook = this.overbookDecision(ctx, settings, conf, body);
        if (pbDetectCustomerOverlap(existing, body.customerId, body.startTime, endTime) && !override) throw withCode(new ConflictError('Customer already has an overlapping appointment'), 'CUSTOMER_OVERLAPPING_APPOINTMENT');
      }
      try {
        row = await this.repo.create(ctx, {
          appointmentId: 'bk_' + this.repo.nextSeq(), technicianId, customerId: body.customerId, customerName: body.customerName, customerPhone: body.customerPhone, isVip: !!body.isVip,
          services, source: body.source || 'manual', anyTechnician: !body.technicianId, date: body.date, startTime: body.startTime, endTime, status: 'booked', depositStatus: settings.depositRequired ? 'required' : 'not_required', depositCents: 0, notes: finalNotes, createdAt: ts, updatedAt: ts,
        }, { bufferMinutes: settings.bufferMinutes, skipConflict: !!overbook, overbook, holdGuard: held.guard });
        break;
      } catch (e) {
        // A hold that appeared after the pre-check (seen by the locked re-check) is a lost race for a first-available
        // booking too: try the next technician; an explicitly chosen technician gets the held answer.
        if (!body.technicianId && (e instanceof BookingConflictRace || e instanceof BookingSlotHeld) && attempt < FIRST_AVAILABLE_MAX_ATTEMPTS) { lost.add(technicianId); continue; }
        this.relayRepoConflict(e); // lost the race to a concurrent booking → 409 APPOINTMENT_CONFLICT
      }
    }
    // The booking made from a hold converts it (one hold → one appointment, enforced by the database). A conversion that
    // loses to a concurrent one never undoes the appointment — the hold simply is no longer live.
    await this.convertOwnHolds(ctx, held.own, row.appointmentId);
    this.log(ctx, 'pos_booking_appointment_created', 'pos_booking_appointment', row.appointmentId, undefined, row);
    // Constitution 8: projected from appointment.created when the repository emits events.
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentCreated, row.appointmentId, { startTime: row.startTime, technicianId: row.technicianId ?? null, date: row.date ?? null });
    return row;
  }
  async update(ctx: BookingContext, id: string, body: PBUpdateRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.edit'); await this.bookingOr404(ctx, id);
    body = { ...body, managerOverride: this.overrideAllowed(ctx, body, 'booking.update') };
    const patch: any = { customerName: body.customerName, customerPhone: body.customerPhone, notes: body.notes, isVip: body.isVip };
    let overbook: { reason: string } | null = null;
    const settings = await this.repo.settings(ctx);
    if (body.serviceIds?.length) {
      patch.services = await this.resolveServices(ctx, body.serviceIds, undefined, undefined, (await this.repo.booking(ctx, id))?.services);
      // Spec §69: a longer visit (add-on) is re-validated against the technician's day — pre-check here for the
      // explained refusal / policy decision; the authoritative check runs under the lock in the repository.
      const cur = (await this.repo.booking(ctx, id))!;
      const newEnd = pbAddMinutes(cur.startTime, pbDuration(patch.services));
      if (cur.technicianId && newEnd !== cur.endTime) {
        // Wave 3 (Oct 13 2026), §72: a visit that now runs past the technician's shift / into a break or blocked time is
        // refused exactly as a create or a move would be — only an AUTHORISED override (booking.override) gets through.
        if (newEnd > cur.endTime && !pbWithinTechWindows(cur.startTime, newEnd, await this.windowsFor(ctx, cur.date, cur.technicianId)) && !body.managerOverride) {
          throw new ValidationError("The longer visit falls outside the technician's working hours (schedule, lunch, or blocked time) — manager override required", 'OUTSIDE_TECHNICIAN_HOURS');
        }
        const conf = pbDetectTechnicianConflict(await this.repo.existingForConflict(ctx, cur.date), cur.technicianId, cur.startTime, newEnd, settings.bufferMinutes, id);
        overbook = this.overbookDecision(ctx, settings, conf, body, id);
      }
    }
    try {
      await this.repo.update(ctx, id, patch, { expectedVersion: body.expectedVersion, bufferMinutes: settings.bufferMinutes, overbook });
    } catch (e) { this.relayRepoConflict(e); }
    this.log(ctx, 'pos_booking_appointment_updated', 'pos_booking_appointment', id, undefined, undefined, { expectedVersion: body.expectedVersion ?? null, overbooked: !!overbook });
    const updated = (await this.repo.detail(ctx, id))!;
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentUpdated, id, { startTime: updated.startTime, technicianId: updated.technicianId ?? null, date: updated.date ?? null });   // §343: else the projection delivers appointment.updated
    return updated;
  }


  /** One payload for the Booking calendar: per-tech windows, blocked times, appointments, open ranges (with gap
   *  minutes), plus grid settings. Everything is real data — a tech with no schedule row follows store hours. */
  async dayGrid(ctx: BookingContext, dateArg?: string, technicianIds?: string[], filters: BookingFilters = {}) {
    this.need(ctx, 'pos.booking.view');
    const clk = await this.repo.clock(ctx);   // the branch's day and minute (Oct 2 2026)
    const date = dateArg || clk.today;
    const settings = await this.repo.settings(ctx);
    // 200-technician mandate §18/§52 (Oct 23 2026): the board asks for its VISIBLE page of technicians — columns and
    // appointments for those ids (+ the unassigned column) only, never 200 calendars. Without ids (older callers) every
    // technician, as before. Either way the WHOLE day of the requested columns: it used to keep only the first 50
    // appointments of the day (query()'s default page), so a busy day silently lost appointments from the grid.
    const ids = technicianIds?.length ? [...new Set(technicianIds)].slice(0, BOOKING_TECH_PAGE_SIZE_MAX) : undefined;
    const [techsRaw, scheds, blocks, existing, state] = await Promise.all([
      this.repo.technicians(ctx, ids), this.repo.techSchedules(ctx, this.dowOf(date), date), this.repo.blockedTimes(ctx, date),
      this.repo.existingForConflict(ctx, date), this.repo.query(ctx, { ...filters, date, technicianId: undefined, from: undefined, to: undefined, page: undefined, pageSize: undefined }, { technicianIds: ids, includeUnassigned: true, unbounded: true }),
    ]);
    const techs = ids ? ids.map((id) => techsRaw.find((t) => t.technicianId === id)).filter((t): t is NonNullable<typeof t> => !!t) : techsRaw;
    // §6: on the current day, minutes already in the past are not open. Snap up to the grid interval so a range
    // never starts on an unbookable off-grid minute. Other dates pass null (no clamp).
    const notBefore = date === clk.today
      ? Math.ceil(clk.nowMinute / settings.slotIntervalMinutes) * settings.slotIntervalMinutes
      : null;
    const columns = techs.map((t) => {
      const windows = t.available ? pbTechDayWindows(settings.openTime, settings.closeTime, scheds[t.technicianId] ?? null, blocks[t.technicianId] ?? []) : [];
      const mine = existing.filter((a) => a.technicianId === t.technicianId).map((a) => ({ startTime: a.startTime, endTime: a.endTime, status: a.status }));
      const openRanges = pbOpenRanges(windows, settings.bufferMinutes, mine, notBefore);
      return {
        technicianId: t.technicianId, name: t.name, available: t.available, skills: t.skills, avatarUrl: t.avatarUrl ?? null, rating: t.rating ?? null, reviewCount: t.reviewCount ?? 0,
        windows, blocked: blocks[t.technicianId] ?? [], openRanges,
        openMinutes: openRanges.reduce((a, r) => a + r.minutes, 0),
        openSlotCount: pbComputeAvailabilityInWindows(windows, settings.slotIntervalMinutes, settings.defaultServiceDurationMinutes, settings.bufferMinutes, mine).length,
      };
    });
    this.log(ctx, 'pos_booking_day_grid_viewed', 'pos_booking', undefined, undefined, undefined, { date, columns: columns.length });
    return {
      date, openTime: settings.openTime, closeTime: settings.closeTime,
      slotIntervalMinutes: settings.slotIntervalMinutes, bufferMinutes: settings.bufferMinutes,
      defaultServiceDurationMinutes: settings.defaultServiceDurationMinutes,
      columns,
      totalOpenSlots: columns.reduce((a, c) => a + c.openSlotCount, 0),
      appointments: state.bookings.items,
    };
  }

  // ---- blocked time / breaks (§9 write path) ----
  /** Create one blocked window (break, training, late arrival…) for a technician. Overlap with a blocking-status
   *  appointment is rejected unless managerOverride (audited) — blocking over booked work is a deliberate act. */
  async addBlockedTime(ctx: BookingContext, body: { technicianId: string; date?: string; startTime: string; endTime: string; reason?: string; note?: string; managerOverride?: boolean }) {
    this.need(ctx, 'pos.booking.edit');
    body = { ...body, managerOverride: this.overrideAllowed(ctx, body, 'booking.blocked_time') };   // R1: permission-gated, audited
    const date = body.date || (await this.repo.clock(ctx)).today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw withCode(new ValidationError('Invalid date'), 'DATE_INVALID');
    if (!/^\d{2}:\d{2}$/.test(body.startTime || '') || !/^\d{2}:\d{2}$/.test(body.endTime || '')) throw withCode(new ValidationError('Times must be HH:MM'), 'TIME_FORMAT_INVALID');
    if (body.endTime <= body.startTime) throw withCode(new ValidationError('End time must be after start time'), 'END_AFTER_START');
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId);
    if (!tech) throw withCode(new ValidationError('Unknown technician'), 'TECHNICIAN_UNKNOWN');
    if (!body.managerOverride) {
      const existing = await this.repo.existingForConflict(ctx, date);
      const conf = pbDetectTechnicianConflict(existing, body.technicianId, body.startTime, body.endTime, 0);
      if (conf.status === 'conflict') throw withCode(new ConflictError('That window overlaps an existing appointment — move it first or use a manager override', conf.conflictingAppointmentId), 'WINDOW_OVERLAPS_APPOINTMENT');
    }
    const reason = (body.reason || 'unavailable').slice(0, 120);
    const { blockId } = await this.repo.addBlockedTime(ctx, { technicianId: body.technicianId, date, startTime: body.startTime, endTime: body.endTime, reason, note: body.note?.slice(0, 500) });
    this.log(ctx, 'pos_booking_block_time_added', 'technician_blocked_time', blockId, undefined,
      { technicianId: body.technicianId, date, startTime: body.startTime, endTime: body.endTime, reason },
      body.managerOverride ? { managerOverride: true } : undefined);
    return { blockId, technicianId: body.technicianId, date, startTime: body.startTime, endTime: body.endTime, reason };
  }

  /** Remove one blocked window. Tenant/branch scoping happens in the repository delete. */
  async removeBlockedTime(ctx: BookingContext, blockId: string) {
    this.need(ctx, 'pos.booking.edit');
    if (!blockId) throw new ValidationError('blockId is required');
    const removed = await this.repo.removeBlockedTime(ctx, blockId);
    if (!removed) throw withCode(new ValidationError('Blocked time not found'), 'BLOCKED_TIME_NOT_FOUND');
    this.log(ctx, 'pos_booking_block_time_removed', 'technician_blocked_time', blockId);
    return { removed: true };
  }

  // ---- reschedule (§14) ----
  async reschedule(ctx: BookingContext, id: string, body: PBRescheduleRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.reschedule'); const a = await this.bookingOr404(ctx, id);
    if (!body?.startTime) throw withCode(new ValidationError('A new start time is required'), 'NEW_START_REQUIRED');
    const settings = await this.repo.settings(ctx); const date = body.date || a.date; const techId = body.technicianId || a.technicianId;
    const endTime = pbAddMinutes(body.startTime, pbDuration(a.services));
    const override = this.overrideAllowed(ctx, body, 'booking.reschedule');
    body = { ...body, managerOverride: override };
    if (!pbWithinStoreHours(body.startTime, endTime, settings.openTime, settings.closeTime) && !override) throw new ValidationError('New time is outside store hours — manager override required', 'OUTSIDE_STORE_HOURS');
    // a reschedule onto a DIFFERENT technician re-checks skills (hard rule, never overridable)
    if (body.technicianId && body.technicianId !== a.technicianId) await this.assertTechSkilled(ctx, body.technicianId, a.services);
    // Round 3 H2: a move respects live holds exactly as create does — another session's hold on the target (a no-technician
    // hold blocks every technician) refuses it; the moving session's own hold is used up by the move. Pre-check here, the
    // authoritative re-read inside the repository's locked transaction (holdGuard).
    const held = await this.holdsAt(ctx, date, body.startTime, endTime, body.holdSessionId ?? null);
    if (held.foreign.some((h) => h.technicianId == null || h.technicianId === techId)) throw new ConflictError(HELD_MESSAGE);
    let overbook: { reason: string } | null = null;
    if (techId) {
      if (!pbWithinTechWindows(body.startTime, endTime, await this.windowsFor(ctx, date, techId)) && !override) {
        throw new ValidationError("New time falls outside the technician's working hours (schedule, lunch, or blocked time) — manager override required", 'OUTSIDE_TECHNICIAN_HOURS');
      }
      // Pre-check for a fast, well-explained refusal; the AUTHORITATIVE check runs inside the repository's transaction
      // under the technician+day lock, and the database's no-overlap guard is the last line of defense (spec §7–§9).
      const conf = pbDetectTechnicianConflict(await this.repo.existingForConflict(ctx, date), techId, body.startTime, endTime, settings.bufferMinutes, id);
      overbook = this.overbookDecision(ctx, settings, conf, body, id);
    }
    try {
      await this.repo.reschedule(ctx, id, body.technicianId, body.startTime, body.date, { expectedVersion: body.expectedVersion, bufferMinutes: settings.bufferMinutes, overbook, holdGuard: held.guard });
    } catch (e) { this.relayRepoConflict(e); }
    // The moved appointment may already carry the hold it was booked from (one converted hold per appointment, enforced
    // by the database), so a move USES UP its session's hold by releasing it ('converted') rather than converting it.
    for (const h of held.own) await this.holds?.release?.(ctx.tenantId, h.holdId, h.bookingSessionId, 'converted').catch(() => false);
    this.log(ctx, 'pos_booking_appointment_rescheduled', 'pos_booking_appointment', id, undefined, undefined, { startTime: body.startTime, technicianId: body.technicianId, date: body.date, overbooked: !!overbook });
    if (body.notifyCustomer !== false) this.notifyCustomer(ctx, a, `Your appointment has been moved to ${date} at ${body.startTime}. Reply to this message with any questions.`, 'reschedule', id);
    const moved = (await this.repo.detail(ctx, id))!;
    // Constitution 8: projected from appointment.rescheduled when the repository emits events.
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentUpdated, id, { startTime: moved.startTime, technicianId: moved.technicianId ?? null, rescheduled: true });
    return moved;
  }

  // ---- assign / check-in / cancel / no-show ----
  async assignTechnician(ctx: BookingContext, id: string, body: PBAssignTechnicianRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.assign_technician'); const a = await this.bookingOr404(ctx, id);
    body = { ...body, managerOverride: this.overrideAllowed(ctx, body, 'booking.assign_technician') };
    if (!body?.technicianId) throw new ValidationError('A technician is required', 'TECHNICIAN_REQUIRED');
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId); if (!tech) throw withCode(new ValidationError('Technician not found in this tenant'), 'TECHNICIAN_NOT_FOUND');
    await this.assertTechSkilled(ctx, body.technicianId, a.services);   // hard rule: never overridable (R2)
    if (a.technicianId === body.technicianId) return (await this.repo.detail(ctx, id))!;   // already theirs — nothing to write
    // Merge Oct 12 2026: the NEW technician's day is checked for an overlap (it was unchecked, and the database's refusal
    // was swallowed). Pre-check here for the policy decision (BLOCK / confirm with reason / authorised role); the
    // authoritative re-check runs under the technician+day lock in the repository; the EXCLUDE guard is the last line.
    const settings = await this.repo.settings(ctx);
    const conf = pbDetectTechnicianConflict(await this.repo.existingForConflict(ctx, a.date), body.technicianId, a.startTime, a.endTime, settings.bufferMinutes, id);
    const overbook = this.overbookDecision(ctx, settings, conf, body, id);
    try {
      if (!(await this.repo.assign(ctx, id, body.technicianId, { expectedVersion: body.expectedVersion, bufferMinutes: settings.bufferMinutes, overbook }))) throw withCode(new ValidationError('Booking not found'), 'BOOKING_NOT_FOUND');
    } catch (e) { this.relayRepoConflict(e); }
    this.log(ctx, 'pos_booking_appointment_technician_assigned', 'pos_booking_appointment', id, undefined, undefined, { technicianId: body.technicianId, override: !!body.managerOverride, overbooked: !!overbook, expectedVersion: body.expectedVersion ?? null });
    const assigned = (await this.repo.detail(ctx, id))!;
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentUpdated, id, { startTime: assigned.startTime, technicianId: assigned.technicianId ?? null });
    return assigned;
  }
  async checkIn(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.check_in'); const a = await this.bookingOr404(ctx, id);
    if (!pbCanCheckIn(a.status)) throw withCode(new ValidationError('Only a booked, confirmed or arrived appointment can be checked in'), 'APPOINTMENT_CANNOT_CHECK_IN');
    await this.repo.setStatus(ctx, id, 'checked_in'); this.log(ctx, 'pos_booking_appointment_checked_in', 'pos_booking_appointment', id); return (await this.repo.detail(ctx, id))!;
  }
  /** Decision 38: the customer is in the salon, not yet checked in (front desk taps Arrived). Same permission as check-in.
   *  A late customer is still booked/confirmed underneath (LATE is computed), so they can be marked arrived. */
  async markArrived(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.check_in'); const a = await this.bookingOr404(ctx, id);
    if (!pbCanMarkArrived(a.status)) throw new ValidationError(a.status === 'arrived' ? 'This customer is already marked arrived' : 'Only a booked or confirmed appointment can be marked arrived');
    if (!(await this.repo.setStatus(ctx, id, 'arrived'))) throw withCode(new ValidationError('Booking not found'), 'BOOKING_NOT_FOUND');
    this.log(ctx, 'pos_booking_appointment_arrived', 'pos_booking_appointment', id);
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentUpdated, id, { status: 'arrived' });
    return (await this.repo.detail(ctx, id))!;
  }
  async confirm(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.edit'); const a = await this.bookingOr404(ctx, id);
    if (!pbCanConfirm(a.status)) throw withCode(new ValidationError('Only a booked appointment can be confirmed'), 'ONLY_BOOKED_CAN_CONFIRM');
    await this.repo.setStatus(ctx, id, 'confirmed'); this.log(ctx, 'pos_booking_appointment_confirmed', 'pos_booking_appointment', id); return (await this.repo.detail(ctx, id))!;
  }
  async cancel(ctx: BookingContext, id: string, body: PBCancelRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.cancel'); await this.bookingOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('Cancelling requires a reason', 'CANCEL_REASON_REQUIRED');
    await this.repo.setStatus(ctx, id, 'cancelled'); this.log(ctx, 'pos_booking_appointment_cancelled', 'pos_booking_appointment', id, undefined, undefined, { reason: body.reason });
    // D11: the salon cancelled — the deposit goes back to the guest, however late. A refund the processor refuses is
    // surfaced (the cancellation stands; the salon refunds by hand), never swallowed.
    if (this.deposits) await this.deposits.onCancelled({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, id, 'salon');
    // Constitution 8: projected from appointment.canceled (via setStatus) when the repository emits events.
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentCancelled, id);
    if (body.notifyCustomer !== false) { const c = await this.repo.booking(ctx, id); if (c) this.notifyCustomer(ctx, c, 'Your appointment has been cancelled. Call us to rebook any time.', 'cancel', id); }
    return (await this.repo.detail(ctx, id))!;
  }
  async noShow(ctx: BookingContext, id: string, body: PBNoShowRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.no_show'); await this.bookingOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('Marking no-show requires a reason', 'NO_SHOW_REASON_REQUIRED');
    await this.repo.setStatus(ctx, id, 'no_show'); this.log(ctx, 'pos_booking_appointment_no_show', 'pos_booking_appointment', id, undefined, undefined, { reason: body.reason });
    if (this.deposits) await this.deposits.onNoShow({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, id);   // D11: forfeited per the salon's policy, else refunded
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- transfers (idempotent) ----
  async moveToQueue(ctx: BookingContext, id: string): Promise<{ moved: boolean; duplicate: boolean; queueItemId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.queue.create'); const a = await this.bookingOr404(ctx, id); const key = pbQueueKey(id);
    if ((await this.repo.getKey(ctx, id, 'queue')) === key) { this.log(ctx, 'pos_booking_appointment_moved_to_queue', 'pos_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, queueItemId: id, idempotencyKey: key }; }
    if (['cancelled', 'no_show'].includes(a.status)) throw withCode(new ValidationError('A cancelled or no-show booking cannot be moved to the queue'), 'BOOKING_CANCELLED_CANNOT_MOVE');
    await this.repo.setKey(ctx, id, 'queue', key); if (pbCanCheckIn(a.status)) await this.repo.setStatus(ctx, id, 'checked_in');   // booked, confirmed or arrived (Decision 38)
    await this.repo.enqueueAppointment(ctx, id);
    this.log(ctx, 'pos_booking_appointment_moved_to_queue', 'pos_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    if (!this.repo.emitsDomainEvents?.()) { this.announce(ctx, EVENTS.queueUpdated, id); this.announce(ctx, EVENTS.appointmentUpdated, id, { status: 'checked_in' }); }   // §343: else checkin.customer_checked_in is projected
    return { moved: true, duplicate: false, queueItemId: id, idempotencyKey: key };
  }
  async moveToTechQueue(ctx: BookingContext, id: string): Promise<{ moved: boolean; duplicate: boolean; techQueueTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.tech_queue.create'); const a = await this.bookingOr404(ctx, id); const key = pbTechQueueKey(id);
    if ((await this.repo.getKey(ctx, id, 'techQueue')) === key) { this.log(ctx, 'pos_booking_appointment_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, techQueueTicketId: id, idempotencyKey: key }; }
    if (['cancelled', 'no_show'].includes(a.status)) throw withCode(new ValidationError('A cancelled or no-show booking cannot be moved to the tech queue'), 'BOOKING_CANCELLED_CANNOT_MOVE');
    if (!a.technicianId) throw withCode(new ValidationError('An assigned technician is required to move to the tech queue'), 'TECHNICIAN_REQUIRED_FOR_TECH_QUEUE');
    await this.repo.setKey(ctx, id, 'techQueue', key);
    await this.repo.enqueueAppointment(ctx, id);
    this.log(ctx, 'pos_booking_appointment_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    if (!this.repo.emitsDomainEvents?.()) { this.announce(ctx, EVENTS.queueUpdated, id); this.announce(ctx, EVENTS.appointmentUpdated, id, { status: 'checked_in' }); }   // §343: else checkin.customer_checked_in is projected
    return { moved: true, duplicate: false, techQueueTicketId: id, idempotencyKey: key };
  }
  async startService(ctx: BookingContext, id: string): Promise<{ moved: boolean; duplicate: boolean; servingTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.serving.start'); const a = await this.bookingOr404(ctx, id); const key = pbServingKey(id);
    if ((await this.repo.getKey(ctx, id, 'serving')) === key && a.status === 'in_service') { this.log(ctx, 'pos_booking_appointment_started_service', 'pos_serving_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, servingTicketId: id, idempotencyKey: key }; }
    const gate = pbCanStartService(a.status); if (!gate.ok) throw withCode(new ValidationError('Cannot start service: ' + gate.reason), 'CANNOT_START_SERVICE');
    if (a.services.length <= 0) throw new ValidationError('Services are required to start service', 'SERVICES_REQUIRED');
    await this.repo.setStatus(ctx, id, 'in_service'); await this.repo.setKey(ctx, id, 'serving', key);
    await this.repo.enqueueAppointment(ctx, id);
    this.log(ctx, 'pos_booking_appointment_started_service', 'pos_serving_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    if (!this.repo.emitsDomainEvents?.()) {   // §343 / B-14: else appointment.updated { status: in_service } is projected to these three
      this.announce(ctx, EVENTS.serviceStarted, id, { status: 'in_service' });
      this.announce(ctx, EVENTS.queueUpdated, id);
      this.announce(ctx, EVENTS.appointmentUpdated, id, { status: 'in_service' });
    }
    return { moved: true, duplicate: false, servingTicketId: id, idempotencyKey: key };
  }
}
