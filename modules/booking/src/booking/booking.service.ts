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
  pbCanCheckIn, pbCanMarkArrived, pbCanConfirm, pbCanStartService, pbQueueKey, pbTechQueueKey, pbServingKey, BookingConflictRace, BookingSlotHeld, BookingVersionConflict, type BookingConflictCode, type BookingSettings, type BookingChangesResponse, BookingResyncRequired, BOOKING_FEED, encodeBookingCursor, decodeBookingCursor,
} from './booking.dto';
import { BookingContext, BookingRepositoryPort, type HoldGuard } from './booking.repository';
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';
import type { BookingHoldGate } from '../customer-booking/booking-slot-hold';
import { BOOKING_TECH_PAGE_SIZE, BOOKING_TECH_PAGE_SIZE_MAX, type BookingTechnicianPage, type BookingTechnicianQuery, type BookingTechnicianSummary } from '@aipowersalon/api-contracts/tenant';
import { CHAIR_HOLDING_STATUSES, foldVi } from '@aipowersalon/api-contracts';

function bookingTechPageMath(total: number, pageSize: number, page: number): { page: number; totalPages: number; startIndex: number; endIndex: number; first: number; last: number } {
  const size = Math.max(1, Math.trunc(Number(pageSize)) || 12);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), totalPages);
  const startIndex = (p - 1) * size;
  const endIndex = Math.min(startIndex + size, total);
  return { page: p, totalPages, startIndex, endIndex, first: total === 0 ? 0 : startIndex + 1, last: endIndex };
}

function bookingTechPageOf(index: number, pageSize: number): number {
  const size = Math.max(1, Math.trunc(Number(pageSize)) || 12);
  return Math.floor(Math.max(0, index) / size) + 1;
}

/** Round 2 H (Oct 12 2026): how many technicians a "first available" booking tries after losing the locked re-check
 *  before it answers "nobody is free". Each attempt runs under the same technician+day lock; the loop also ends as soon
 *  as no qualifying technician is left, so this cap only guards a pathological salon. */
export const FIRST_AVAILABLE_MAX_ATTEMPTS = 25;
const minuteOf = (hhmm: string): number => { const [h, m] = String(hhmm).split(':').map((x) => parseInt(x, 10)); return h * 60 + m; };
const HELD_MESSAGE = 'That time is being held for another booking. Please choose another time.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export class ConflictError extends Error {
  conflictingAppointmentId?: string; code: BookingConflictCode; currentVersion?: number | null;
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
    private readonly holds?: BookingHoldGate | null) {}

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
  private announce(ctx: BookingContext, event: EventName, appointmentId: string, extra: Record<string, unknown> = {}): void {
    try {
      this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId },
        event,
        makeEnvelope({ eventType: event, tenantId: ctx.tenantId, branchId: ctx.branchId, resourceType: 'appointment', resourceId: appointmentId, data: extra }));
    } catch { /* realtime is never load-bearing */ }
  }

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
    if (policy === 'BLOCK') throw new ConflictError('This time was just booked or changed on another device. The schedule has been refreshed.', cid);
    if (policy === 'ALLOW_AUTHORIZED_ROLE' && !hasPermission(ctx as any, 'pos.booking.override_conflict')) {
      throw new ConflictError('Technician is double-booked at that time. An owner or manager can authorize an intentional double booking.', cid);
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
    if (e instanceof BookingConflictRace) throw new ConflictError('This time was just booked or changed on another device. The schedule has been refreshed.', e.conflictingAppointmentId);
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
      .then((r) => this.log(ctx, 'pos_booking_notification_result', 'pos_booking_appointment', appointmentId, undefined, undefined, { kind, sent: !!r?.sent, status: (r as any)?.status }))
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
    const scheds = await this.repo.techSchedules(ctx, this.dowOf(date));
    const blocks = await this.repo.blockedTimes(ctx, date);
    return pbTechDayWindows(settings.openTime, settings.closeTime, scheds[technicianId] ?? null, blocks[technicianId] ?? []);
  }

  private async bookingOr404(ctx: BookingContext, id: string) { const a = await this.repo.booking(ctx, id); if (!a) throw new ValidationError('Booking not found'); return a; }

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
      this.repo.technicians(ctx), this.repo.serviceCatalog(ctx), this.repo.techSchedules(ctx, this.dowOf(date)), this.repo.blockedTimes(ctx, date), this.repo.existingForConflict(ctx, date),
    ]);
    const cats = new Set(catalog.filter((s) => services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    const ordered = techs.filter((t) => t.available).sort((a, b) => a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId));
    for (const t of ordered) {
      if (skip(t.technicianId)) continue;   // held by another session, or already lost a race for this booking
      if (!(await this.techSkilledFor(ctx, t.technicianId, services))) continue;
      const windows = pbTechDayWindows(settings.openTime, settings.closeTime, scheds[t.technicianId] ?? null, blocks[t.technicianId] ?? []);
      if (!pbWithinTechWindows(startTime, endTime, windows)) continue;
      if (pbDetectTechnicianConflict(existing, t.technicianId, startTime, endTime, settings.bufferMinutes).status !== 'none') continue;
      return t.technicianId;
    }
    throw new ConflictError('No technician is available at that time. Please choose another time.');
  }
  private async techSkilledFor(ctx: BookingContext, technicianId: string, services: PBServiceLine[]): Promise<boolean> {
    const tech: any = (await this.repo.technicians(ctx)).find((t) => t.technicianId === technicianId); if (!tech) return false;
    const reqSids = services.map((s) => s.serviceId).filter(Boolean);
    if (tech.approvedServiceIds && tech.approvedServiceIds.length > 0) {
      return reqSids.every((sid) => tech.approvedServiceIds.includes(sid));
    }
    if (tech.legacySkillsUnconfigured) return true;
    const cat = await this.repo.serviceCatalog(ctx); const cats = new Set(cat.filter((s) => services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    return [...cats].every((c) => tech.skills.includes(c));
  }

  // ---- read ----
  async getState(ctx: BookingContext, f: BookingFilters = {}): Promise<POSBookingFullState> { this.need(ctx, 'pos.booking.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_booking_viewed', 'pos_booking', undefined, undefined, undefined, { filters: f }); return st; }
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
    if (!since) return { appointments: [], cursor: encodeBookingCursor(serverTime), serverTime };   // first call: baseline only
    if (!this.repo.changedSince) throw new BookingResyncRequired('cursor_invalid');
    const from = new Date(since.getTime() - BOOKING_FEED.lookBackMs);
    const changed = await this.repo.changedSince(ctx, from, BOOKING_FEED.maxRows + 1);
    if (changed.length > BOOKING_FEED.maxRows) throw new BookingResyncRequired('too_many_changes');
    const appointments: POSBookingAppointmentRow[] = [];
    for (const c of changed) { const row = await this.repo.detail(ctx, c.id); if (row) appointments.push(row); }
    // The next cursor never moves backwards and never past "now" — rows stamped later than serverTime (clock skew
    // between app and DB) are re-read next time rather than skipped. It also ADVANCES on a quiet tick, to at least
    // now − lookBack: every row stamped before that has committed (the look-back assumption the feed already rests on)
    // and was covered by this read. Without that, a quiet board's cursor stayed at its last change and after maxAgeMs
    // (30 min) every tick was answered RESYNC_REQUIRED — a full reload of every idle board each half hour.
    const newest = changed.length ? Date.parse(changed[changed.length - 1].updatedAt) : since.getTime();
    const next = Math.max(since.getTime(), Math.min(nowMs, Math.max(newest, nowMs - BOOKING_FEED.lookBackMs)));
    return { appointments, cursor: encodeBookingCursor(new Date(next).toISOString()), serverTime };
  }

  async detail(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow> { this.need(ctx, 'pos.booking.view'); const d = await this.repo.detail(ctx, id); if (!d) throw new ValidationError('Booking not found'); this.log(ctx, 'pos_booking_appointment_viewed', 'pos_booking_appointment', id); return d; }
  async integrationStatus(ctx: BookingContext): Promise<BookingIntegrationStatus> { this.need(ctx, 'pos.booking.view'); return this.repo.integrationStatus(ctx); }

  // ---- availability (§13) ----
  async availability(ctx: BookingContext, q: PBAvailabilityQuery): Promise<{ technicianId: string; name: string; slots: string[] }[]> {
    this.need(ctx, 'pos.booking.view');
    const date = q.date || (await this.repo.clock(ctx)).today;
    const services = q.serviceIds?.length ? await this.resolveServices(ctx, q.serviceIds) : [];
    const settings = await this.repo.settings(ctx);
    const dur = services.length ? pbDuration(services) : settings.defaultServiceDurationMinutes;
    // Schedule-aware: each tech's slots come from store hours ∩ their weekly schedule − lunch − blocked times.
    const [techs, scheds, blocks, existing, held] = await Promise.all([
      this.repo.technicians(ctx), this.repo.techSchedules(ctx, this.dowOf(date)), this.repo.blockedTimes(ctx, date), this.repo.existingForConflict(ctx, date),
      this.heldMinutes(ctx, date),
    ]);
    return techs
      .filter((t) => !q.technicianId || t.technicianId === q.technicianId)
      .map((t) => {
        const windows = t.available ? pbTechDayWindows(settings.openTime, settings.closeTime, scheds[t.technicianId] ?? null, blocks[t.technicianId] ?? []) : [];
        const mine = existing.filter((a) => a.technicianId === t.technicianId).map((a) => ({ startTime: a.startTime, endTime: a.endTime, status: a.status }));
        // Round 2 H: a slot another session holds is not offered to anyone else (a first-available hold covers every technician).
        const blocked = held.filter((h) => h.technicianId == null || h.technicianId === t.technicianId);
        const slots = pbComputeAvailabilityInWindows(windows, settings.slotIntervalMinutes, dur, settings.bufferMinutes, mine)
          .filter((s) => { const a = minuteOf(s), b = a + dur; return !blocked.some((h) => h.start < b && a < h.end); });
        return { technicianId: t.technicianId, name: t.name, slots };
      });
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
    if (!body?.customerName?.trim()) throw new ValidationError('A customer (or walk-in name) is required');
    if (!body?.serviceIds?.length) throw new ValidationError('At least one service is required');
    if (!body?.startTime || !body?.date) throw new ValidationError('A date and start time are required');
    const services = await this.resolveServices(ctx, body.serviceIds, body.serviceLines, body.priceOverrides);
    const duration = pbDuration(services); if (duration <= 0) throw new ValidationError('Duration must be greater than 0');
    const endTime = pbAddMinutes(body.startTime, duration);
    const settings = await this.repo.settings(ctx);
    const override = this.overrideAllowed(ctx, body, 'booking.create');
    body = { ...body, managerOverride: override };   // the overbook policy below counts an HONOURED override as a confirmation
    if (!pbWithinStoreHours(body.startTime, endTime, settings.openTime, settings.closeTime) && !override) throw new ValidationError('Booking is outside store hours — manager override required');
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
        if (!(await this.techSkilledFor(ctx, technicianId, services))) throw new ValidationError('Technician is not skilled for the selected services');   // hard rule: never overridable (R2)
        if (!pbWithinTechWindows(body.startTime, endTime, await this.windowsFor(ctx, body.date, technicianId)) && !override) {
          throw new ValidationError("That time falls outside the technician's working hours (schedule, lunch, or blocked time) — manager override required");
        }
        const existing = await this.repo.existingForConflict(ctx, body.date);
        const conf = pbDetectTechnicianConflict(existing, technicianId, body.startTime, endTime, settings.bufferMinutes);
        // An engine-picked technician who became busy since the pick (a concurrent first-available booking committed in
        // between) is a lost race too — never an overbook question for a technician nobody chose.
        if (!body.technicianId && conf.status === 'conflict' && attempt < FIRST_AVAILABLE_MAX_ATTEMPTS) { lost.add(technicianId); continue; }
        // Spec §11: the overbooking policy decides (BLOCK by default); the authoritative re-check runs under the
        // technician+day lock inside the repository transaction, and the database guard is the last line of defense.
        overbook = this.overbookDecision(ctx, settings, conf, body);
        if (pbDetectCustomerOverlap(existing, body.customerId, body.startTime, endTime) && !override) throw new ConflictError('Customer already has an overlapping appointment');
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
    this.log(ctx, 'pos_booking_appointment_created', 'pos_booking_appointment', row.appointmentId, undefined, row as any);
    // Constitution 8: projected from appointment.created when the repository emits events.
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentCreated, row.appointmentId, { startTime: row.startTime, technicianId: row.technicianId ?? null });
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
          throw new ValidationError("The longer visit falls outside the technician's working hours (schedule, lunch, or blocked time) — manager override required");
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
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentUpdated, id, { startTime: updated.startTime, technicianId: updated.technicianId ?? null });   // §343: else the projection delivers appointment.updated
    return updated;
  }

  /** 200-technician mandate (Oct 23 2026): the board's technician picker paged on the server (12 a page).
   *  Tenant and branch come from the session — a client cannot page another salon. */
  async technicianPage(ctx: BookingContext, q: BookingTechnicianQuery = {}): Promise<BookingTechnicianPage> {
    this.need(ctx, 'pos.booking.view');
    const clk = await this.repo.clock(ctx);
    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : clk.today;
    const pageSize = Math.min(BOOKING_TECH_PAGE_SIZE_MAX, Math.max(1, Math.trunc(Number(q.pageSize)) || BOOKING_TECH_PAGE_SIZE));
    const settings = await this.repo.settings(ctx);
    const rawTechs = await this.repo.technicians(ctx);
    const roster: { technicianId: string; name: string; available: boolean; searchText: string }[] = rawTechs
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId))
      .map((t) => ({ technicianId: t.technicianId, name: t.name, available: t.available, searchText: t.name.toLowerCase() }));
    const [scheds, blocks] = await Promise.all([this.repo.techSchedules(ctx, this.dowOf(date)), this.repo.blockedTimes(ctx, date)]);
    const number = new Map(roster.map((t, i) => [t.technicianId, i + 1]));
    const working = new Map(roster.map((t) => [t.technicianId, t.available && pbTechDayWindows(settings.openTime, settings.closeTime, scheds[t.technicianId] ?? null, blocks[t.technicianId] ?? []).length > 0]));
    const status = q.status === 'inactive' || q.status === 'all' ? q.status : 'active';
    let list = roster.filter((t) => (status === 'all' ? true : status === 'active' ? t.available : !t.available));
    if (q.working) list = list.filter((t) => working.get(t.technicianId));
    const term = String(q.search ?? '').trim().toLowerCase();
    if (term) {
      const num = /^#?\d{1,6}$/.test(term) ? Number(term.replace('#', '')) : null;
      const digits = term.replace(/\D/g, '');
      const folded = foldVi(term);
      list = list.filter((t) => (num != null && number.get(t.technicianId) === num) || t.searchText.includes(term) || (!!folded && foldVi(t.searchText).includes(folded)) || (digits.length >= 4 && t.searchText.includes(digits)));
    }
    if (q.skill) {
      const detail = await this.repo.technicians(ctx);
      const has = new Set(detail.filter((t) => t.skills.includes(String(q.skill))).map((t) => t.technicianId));
      list = list.filter((t) => has.has(t.technicianId));
    }
    let eligibleFlag: boolean | undefined;
    if (q.serviceIds?.length) {
      const services = await this.resolveServices(ctx, q.serviceIds);
      const catalog = await this.repo.serviceCatalog(ctx);
      const cats = new Set(catalog.filter((c) => services.some((rs) => rs.serviceId === c.serviceId)).map((c) => c.categoryName));
      const ok = new Set((await this.repo.technicians(ctx)).filter((t) => [...cats].every((c) => t.skills.includes(c))).map((t) => t.technicianId));
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
    const detail = new Map((await this.repo.technicians(ctx)).map((t) => [t.technicianId, t]));
    const technicians: BookingTechnicianSummary[] = pageIds.map((id) => {
      const r = roster.find((t) => t.technicianId === id)!; const d = detail.get(id);
      return { technicianId: id, name: r.name, rosterNumber: number.get(id)!, avatarUrl: d?.avatarUrl ?? null, available: r.available, workingToday: !!working.get(id),
        skills: d?.skills ?? [], rating: d?.rating ?? null, reviewCount: d?.reviewCount ?? 0, ...(eligibleFlag ? { eligible: true } : {}) };
    });
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

  /** One payload for the Booking calendar: per-tech windows, blocked times, appointments, open ranges (with gap
   *  minutes), plus grid settings. Everything is real data — a tech with no schedule row follows store hours. */
  async dayGrid(ctx: BookingContext, dateArg?: string) {
    this.need(ctx, 'pos.booking.view');
    const clk = await this.repo.clock(ctx);   // the branch's day and minute (Oct 2 2026)
    const date = dateArg || clk.today;
    const settings = await this.repo.settings(ctx);
    const [techs, scheds, blocks, existing, state] = await Promise.all([
      this.repo.technicians(ctx), this.repo.techSchedules(ctx, this.dowOf(date)), this.repo.blockedTimes(ctx, date),
      this.repo.existingForConflict(ctx, date), this.repo.query(ctx, { date }),
    ]);
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
    this.log(ctx, 'pos_booking_day_grid_viewed', 'pos_booking', undefined, undefined, undefined, { date });
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('Invalid date');
    if (!/^\d{2}:\d{2}$/.test(body.startTime || '') || !/^\d{2}:\d{2}$/.test(body.endTime || '')) throw new ValidationError('Times must be HH:MM');
    if (body.endTime <= body.startTime) throw new ValidationError('End time must be after start time');
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId);
    if (!tech) throw new ValidationError('Unknown technician');
    if (!body.managerOverride) {
      const existing = await this.repo.existingForConflict(ctx, date);
      const conf = pbDetectTechnicianConflict(existing, body.technicianId, body.startTime, body.endTime, 0);
      if (conf.status === 'conflict') throw new ConflictError('That window overlaps an existing appointment — move it first or use a manager override', conf.conflictingAppointmentId);
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
    if (!removed) throw new ValidationError('Blocked time not found');
    this.log(ctx, 'pos_booking_block_time_removed', 'technician_blocked_time', blockId);
    return { removed: true };
  }

  // ---- reschedule (§14) ----
  async reschedule(ctx: BookingContext, id: string, body: PBRescheduleRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.reschedule'); const a = await this.bookingOr404(ctx, id);
    if (!body?.startTime) throw new ValidationError('A new start time is required');
    const settings = await this.repo.settings(ctx); const date = body.date || a.date; const techId = body.technicianId || a.technicianId;
    const endTime = pbAddMinutes(body.startTime, pbDuration(a.services));
    const override = this.overrideAllowed(ctx, body, 'booking.reschedule');
    body = { ...body, managerOverride: override };
    if (!pbWithinStoreHours(body.startTime, endTime, settings.openTime, settings.closeTime) && !override) throw new ValidationError('New time is outside store hours — manager override required');
    // a reschedule onto a DIFFERENT technician re-checks skills (hard rule, never overridable)
    if (body.technicianId && body.technicianId !== a.technicianId && !(await this.techSkilledFor(ctx, body.technicianId, a.services))) throw new ValidationError('Technician is not skilled for the selected services');
    // Round 3 H2: a move respects live holds exactly as create does — another session's hold on the target (a no-technician
    // hold blocks every technician) refuses it; the moving session's own hold is used up by the move. Pre-check here, the
    // authoritative re-read inside the repository's locked transaction (holdGuard).
    const held = await this.holdsAt(ctx, date, body.startTime, endTime, body.holdSessionId ?? null);
    if (held.foreign.some((h) => h.technicianId == null || h.technicianId === techId)) throw new ConflictError(HELD_MESSAGE);
    let overbook: { reason: string } | null = null;
    if (techId) {
      if (!pbWithinTechWindows(body.startTime, endTime, await this.windowsFor(ctx, date, techId)) && !override) {
        throw new ValidationError("New time falls outside the technician's working hours (schedule, lunch, or blocked time) — manager override required");
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
    if (!body?.technicianId) throw new ValidationError('A technician is required');
    const tech = (await this.repo.technicians(ctx)).find((t) => t.technicianId === body.technicianId); if (!tech) throw new ValidationError('Technician not found in this tenant');
    if (!(await this.techSkilledFor(ctx, body.technicianId, a.services))) throw new ValidationError('Technician is not skilled for the selected services');   // hard rule: never overridable (R2)
    if (a.technicianId === body.technicianId) return (await this.repo.detail(ctx, id))!;   // already theirs — nothing to write
    // Merge Oct 12 2026: the NEW technician's day is checked for an overlap (it was unchecked, and the database's refusal
    // was swallowed). Pre-check here for the policy decision (BLOCK / confirm with reason / authorised role); the
    // authoritative re-check runs under the technician+day lock in the repository; the EXCLUDE guard is the last line.
    const settings = await this.repo.settings(ctx);
    const conf = pbDetectTechnicianConflict(await this.repo.existingForConflict(ctx, a.date), body.technicianId, a.startTime, a.endTime, settings.bufferMinutes, id);
    const overbook = this.overbookDecision(ctx, settings, conf, body, id);
    try {
      if (!(await this.repo.assign(ctx, id, body.technicianId, { expectedVersion: body.expectedVersion, bufferMinutes: settings.bufferMinutes, overbook }))) throw new ValidationError('Booking not found');
    } catch (e) { this.relayRepoConflict(e); }
    this.log(ctx, 'pos_booking_appointment_technician_assigned', 'pos_booking_appointment', id, undefined, undefined, { technicianId: body.technicianId, override: !!body.managerOverride, overbooked: !!overbook, expectedVersion: body.expectedVersion ?? null });
    const assigned = (await this.repo.detail(ctx, id))!;
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentUpdated, id, { startTime: assigned.startTime, technicianId: assigned.technicianId ?? null });
    return assigned;
  }
  async checkIn(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.check_in'); const a = await this.bookingOr404(ctx, id);
    if (!pbCanCheckIn(a.status)) throw new ValidationError('Only a booked, confirmed or arrived appointment can be checked in');
    await this.repo.setStatus(ctx, id, 'checked_in'); this.log(ctx, 'pos_booking_appointment_checked_in', 'pos_booking_appointment', id); return (await this.repo.detail(ctx, id))!;
  }
  /** Decision 38: the customer is in the salon, not yet checked in (front desk taps Arrived). Same permission as check-in.
   *  A late customer is still booked/confirmed underneath (LATE is computed), so they can be marked arrived. */
  async markArrived(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.check_in'); const a = await this.bookingOr404(ctx, id);
    if (!pbCanMarkArrived(a.status)) throw new ValidationError(a.status === 'arrived' ? 'This customer is already marked arrived' : 'Only a booked or confirmed appointment can be marked arrived');
    if (!(await this.repo.setStatus(ctx, id, 'arrived'))) throw new ValidationError('Booking not found');
    this.log(ctx, 'pos_booking_appointment_arrived', 'pos_booking_appointment', id);
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentUpdated, id, { status: 'arrived' });
    return (await this.repo.detail(ctx, id))!;
  }
  async confirm(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.edit'); const a = await this.bookingOr404(ctx, id);
    if (!pbCanConfirm(a.status)) throw new ValidationError('Only a booked appointment can be confirmed');
    await this.repo.setStatus(ctx, id, 'confirmed'); this.log(ctx, 'pos_booking_appointment_confirmed', 'pos_booking_appointment', id); return (await this.repo.detail(ctx, id))!;
  }
  async cancel(ctx: BookingContext, id: string, body: PBCancelRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.cancel'); await this.bookingOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('Cancelling requires a reason');
    await this.repo.setStatus(ctx, id, 'cancelled'); this.log(ctx, 'pos_booking_appointment_cancelled', 'pos_booking_appointment', id, undefined, undefined, { reason: body.reason });
    // Constitution 8: projected from appointment.canceled (via setStatus) when the repository emits events.
    if (!this.repo.emitsDomainEvents?.()) this.announce(ctx, EVENTS.appointmentCancelled, id);
    if (body.notifyCustomer !== false) { const c = await this.repo.booking(ctx, id); if (c) this.notifyCustomer(ctx, c, 'Your appointment has been cancelled. Call us to rebook any time.', 'cancel', id); }
    return (await this.repo.detail(ctx, id))!;
  }
  async noShow(ctx: BookingContext, id: string, body: PBNoShowRequest): Promise<POSBookingAppointmentRow> {
    this.need(ctx, 'pos.booking.no_show'); await this.bookingOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('Marking no-show requires a reason');
    await this.repo.setStatus(ctx, id, 'no_show'); this.log(ctx, 'pos_booking_appointment_no_show', 'pos_booking_appointment', id, undefined, undefined, { reason: body.reason }); return (await this.repo.detail(ctx, id))!;
  }

  // ---- transfers (idempotent) ----
  async moveToQueue(ctx: BookingContext, id: string): Promise<{ moved: boolean; duplicate: boolean; queueItemId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.queue.create'); const a = await this.bookingOr404(ctx, id); const key = pbQueueKey(id);
    if ((await this.repo.getKey(ctx, id, 'queue')) === key) { this.log(ctx, 'pos_booking_appointment_moved_to_queue', 'pos_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, queueItemId: id, idempotencyKey: key }; }
    if (['cancelled', 'no_show'].includes(a.status)) throw new ValidationError('A cancelled or no-show booking cannot be moved to the queue');
    await this.repo.setKey(ctx, id, 'queue', key); if (pbCanCheckIn(a.status)) await this.repo.setStatus(ctx, id, 'checked_in');   // booked, confirmed or arrived (Decision 38)
    await this.repo.enqueueAppointment(ctx, id);
    this.log(ctx, 'pos_booking_appointment_moved_to_queue', 'pos_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    this.announce(ctx, EVENTS.queueUpdated, id);
    this.announce(ctx, EVENTS.appointmentUpdated, id, { status: 'checked_in' });
    return { moved: true, duplicate: false, queueItemId: id, idempotencyKey: key };
  }
  async moveToTechQueue(ctx: BookingContext, id: string): Promise<{ moved: boolean; duplicate: boolean; techQueueTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.tech_queue.create'); const a = await this.bookingOr404(ctx, id); const key = pbTechQueueKey(id);
    if ((await this.repo.getKey(ctx, id, 'techQueue')) === key) { this.log(ctx, 'pos_booking_appointment_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, techQueueTicketId: id, idempotencyKey: key }; }
    if (['cancelled', 'no_show'].includes(a.status)) throw new ValidationError('A cancelled or no-show booking cannot be moved to the tech queue');
    if (!a.technicianId) throw new ValidationError('An assigned technician is required to move to the tech queue');
    await this.repo.setKey(ctx, id, 'techQueue', key);
    await this.repo.enqueueAppointment(ctx, id);
    this.log(ctx, 'pos_booking_appointment_moved_to_tech_queue', 'pos_tech_queue_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    this.announce(ctx, EVENTS.queueUpdated, id);
    this.announce(ctx, EVENTS.appointmentUpdated, id, { status: 'checked_in' });
    return { moved: true, duplicate: false, techQueueTicketId: id, idempotencyKey: key };
  }
  async startService(ctx: BookingContext, id: string): Promise<{ moved: boolean; duplicate: boolean; servingTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.serving.start'); const a = await this.bookingOr404(ctx, id); const key = pbServingKey(id);
    if ((await this.repo.getKey(ctx, id, 'serving')) === key && a.status === 'in_service') { this.log(ctx, 'pos_booking_appointment_started_service', 'pos_serving_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, servingTicketId: id, idempotencyKey: key }; }
    const gate = pbCanStartService(a.status); if (!gate.ok) throw new ValidationError('Cannot start service: ' + gate.reason);
    if (a.services.length <= 0) throw new ValidationError('Services are required to start service');
    await this.repo.setStatus(ctx, id, 'in_service'); await this.repo.setKey(ctx, id, 'serving', key);
    await this.repo.enqueueAppointment(ctx, id);
    this.log(ctx, 'pos_booking_appointment_started_service', 'pos_serving_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    this.announce(ctx, EVENTS.serviceStarted, id, { status: 'in_service' });
    this.announce(ctx, EVENTS.queueUpdated, id);
    this.announce(ctx, EVENTS.appointmentUpdated, id, { status: 'in_service' });
    return { moved: true, duplicate: false, servingTicketId: id, idempotencyKey: key };
  }
}
