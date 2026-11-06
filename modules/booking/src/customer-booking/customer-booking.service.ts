import { withCode } from '@aipowersalon/api-contracts';
import { TechnicianNotSkilledError, type TechnicianSkillsPort } from '../booking/technician-skills.port';
// customer-booking.service.ts — validates and creates a customer self-booking. Reuses the tech-appointments pure
// conflict helpers (addMinutesToTime, detectTechnicianConflict) so customer bookings honour the same double-booking
// rules as staff-created ones. Errors are typed so the controller maps them to 403 / 400 / 409.
import { Injectable, Inject } from '@nestjs/common';
import type { PushService } from '@aipowersalon/communications';
import type { CustomerBookingDataPort, CustomerBookingContext } from './customer-booking.repository';
import type { BookingOptions, CreateBookingRequest, BookingResult, RescheduleRequest, RescheduleResult } from './customer-booking.dto';
import { addMinutesToTime, detectTechnicianConflict, minutesOf } from '@aipowersalon/appointments';
import { computeAvailableSlots, resolveWindow, type AvailabilityResult } from './availability';
import { customerNoticeText } from '@aipowersalon/api-contracts';

export class NotCustomerError extends Error {}
/** D11: the slice of the deposit service the booking needs (modules/booking/src/deposits) */
export interface DepositCreationPort {
  createForAppointment(ctx: { tenantId: string; branchId?: string | null; userId?: string | null }, input: { appointmentId: string; customerId: string | null; priceCents: number; startsAt: Date }): Promise<BookingResult['deposit'] | null>;
}
export class BookingValidationError extends Error { constructor(msg?: string) { super(msg); this.name = 'BookingValidationError'; } }
export class BookingConflictError extends Error { constructor(msg: string, public conflictingAppointmentId?: string) { super(msg); this.name = 'BookingConflictError'; } }

// Narrow port for the marketplace reservation — the booking depends on this slice, not the whole deals module.
// DealsService satisfies it structurally, so the module passes that instance directly.
export interface DealReservationCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; technicianId?: string | null; }
export interface DealReservation {
  /** BUILD_PLAN Phase 5: the booking tells the reservation WHAT is booked (services, when, from where) so the deal's
   *  eligibility — window, days, hours, lead time, services, channel — is judged against the real appointment. */
  reserveDeal(ctx: DealReservationCtx, dealId: string, customerId: string, idempotencyKey: string, facts?: { serviceIds: string[]; date: string; startTime: string; channel: 'customer_app' | 'online' | 'ai_receptionist' | 'pos'; technicianId?: string | null; spendCents?: number }): Promise<{ soldOut: boolean; holdId?: string; alreadyHeld?: boolean }>;
  consumeReservation(ctx: DealReservationCtx, holdId: string, appointmentId: string): Promise<{ consumed: boolean }>;
  releaseReservation(ctx: DealReservationCtx, holdId: string): Promise<{ released: boolean }>;
}

/**
 * The appointment was NOT created: this booking must prove its phone number first.
 *
 * Carries only what the client needs to run the code screen — a booking session id and a MASKED phone. Never the
 * full number (the spec forbids echoing it back after send) and never anything about the code.
 */
export class PhoneVerificationRequiredError extends Error {
  constructor(
    msg: string,
    public readonly bookingSessionId: string,
    public readonly maskedPhone: string,
    public readonly policyReason: string,
    /** Phase 4: until when the slot is held for this booking session (null: no slot was held). */
    public readonly holdExpiresAt: number | null = null,
  ) { super(msg); }
}

/** Constitution 7 §19 — the salon is suspended / closed / not live: no customer bookings, whatever the cause. */
export class SalonUnavailableError extends Error { constructor() { super('This salon is not taking online bookings right now.'); } }

/** The booking cannot proceed at all: verification is required and we cannot perform it (no/unhealthy provider). */
export class PhoneVerificationUnavailableError extends Error {
  constructor(msg: string, public readonly policyReason: string) { super(msg); }
}

/**
 * The admission the booking service consults before it creates an appointment (BUILD_PLAN Phase 4).
 *
 * A PORT: the policy resolver, the holds, the proof and the tenant's Twilio live behind it (VerifiedBookingFlow,
 * shared with every remote channel), so this service stays a booking service. It used to ask a narrower question —
 * "is this customer's phone proven?" — answered by an adapter that never read the customer's phone and always said
 * no, so the customer app looped on 428 forever after a successful code.
 *
 *   admit()    throws PhoneVerificationRequiredError (the slot is now HELD for this booking session) /
 *              PhoneVerificationUnavailableError / BookingConflictError (held by another booking); returns a ticket
 *   complete() after the insert: the appointment says how its phone was proven, the proof and the hold are spent
 *   abandon()  the insert failed: the proof may be used again
 */
export interface BookingAdmissionPort {
  admit(ctx: CustomerBookingContext, input: {
    customerId: string; channel: 'customer_app'; date: string; startTime: string; endTime: string;
    technicianId: string; serviceIds: string[]; bookingSessionToken?: string | null; deviceId?: string | null;
  }): Promise<unknown>;
  complete(ctx: CustomerBookingContext, ticket: unknown, appointmentId: string): Promise<void>;
  abandon(ticket: unknown): Promise<void>;
  /** Slots held right now by OTHER booking sessions that day (branch-local HH:MM; null technician = all). Round 3 H2:
   *  `ownSessionId` — the asking session's own hold is not "held for someone else" and stays offered. */
  heldSlots?(ctx: CustomerBookingContext, date: string, ownSessionId?: string | null): Promise<{ technicianId: string | null; startTime: string; endTime: string }[]>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

@Injectable()
export class CustomerBookingService {
  constructor(
    @Inject('CustomerBookingDataPort') private readonly repo: CustomerBookingDataPort,
    private readonly push?: PushService,
    // Supplied POSITIONALLY by the module's `useFactory` (which adapts the shared BookingVerificationGuard) — NOT
    // by a DI token. It carried an `@Inject('BookingVerificationGate')` decorator, which Nest IGNORES for a
    // factory-created provider: the token exists nowhere, so a DI audit correctly flags it as injected-but-never-
    // provided. It was inert, but it was a lie in the code — the next person to read it would conclude the gate
    // was unwired and either "fix" a working thing or assume the whole feature was dead. Removed.
    //
    // Unbound means "no verification", and that is the only correct default: an unbound gate means the module is
    // not configured for this deployment — exactly the state the policy resolver already calls `disabled`.
    // Defaulting to "required" would refuse every booking at every existing tenant the moment this shipped, to
    // enforce a feature none of them had turned on.
    private readonly verification?: BookingAdmissionPort,
    // OPTIONAL. When bound (and a dealId is on the request), the booking reserves the deal oversell-safely, then
    // consumes the hold against the created appointment. Unbound (existing tests, deployments without deals) → the
    // deal path is simply skipped, so a booking without a deal behaves exactly as before.
    private readonly deals?: DealReservation,
    // Mandate §51/§78 (Oct 20 2026): the ONE eligibility authority through booking's port. Until now the customer app
    // checked NO skills — any technician could be booked for any service. Absent only without a database.
    private readonly skills?: TechnicianSkillsPort | null,
    // D11 (Oct 21 2026): booking deposits. OPTIONAL (unbound without a database): the salon's policy decides whether this
    // booking owes one; created PENDING after the appointment exists, paid from the app next.
    private readonly deposits?: DepositCreationPort | null,
  ) {}

  /** where a failed deposit-row creation is reported (the booking stands; the salon takes the deposit in person) */
  depositLog: ((msg: string) => void) | null = (m) => console.error('[customer-booking] ' + m);

  async getOptions(ctx: CustomerBookingContext, overrideBranchId?: string): Promise<BookingOptions> {
    if (overrideBranchId && overrideBranchId !== ctx.branchId && this.repo.branchBelongsToTenant && !(await this.repo.branchBelongsToTenant(ctx, overrideBranchId))) {
      throw new BookingValidationError('That salon is not available for booking.');
    }
    const queryCtx = overrideBranchId ? { ...ctx, branchId: overrideBranchId } : ctx;
    const [services, technicians] = await Promise.all([this.repo.listServices(queryCtx), this.repo.listTechnicians(queryCtx)]);
    return { services, technicians };
  }

  // Open-slot availability for a service on a date (optionally a specific technician). Uses the same conflict gate as
  // book(), so a returned available slot is guaranteed bookable (subject to the final atomic re-check on submit).
  // Round 3 H2: `bookingSessionId` (server-side only — the AI receptionist's call session) keeps that session's own hold
  // offered; every other session's live hold is excluded (the customer app's own verification hold included).
  async availability(sessionCtx: CustomerBookingContext, q: { serviceId?: string; date?: string; technicianId?: string; bookingSessionId?: string | null; salonId?: string }): Promise<AvailabilityResult> {
    const serviceId = String(q?.serviceId ?? '').trim();
    const date = String(q?.date ?? '').trim();
    const technicianId = String(q?.technicianId ?? '').trim();
    if (!serviceId) throw new BookingValidationError('serviceId is required');
    if (!DATE_RE.test(date)) throw new BookingValidationError('date must be YYYY-MM-DD');
    // Developer merge (Oct 6 2026): the customer app books at a chosen salon — its availability was always the session's
    // DEFAULT salon's. A client-named salon scopes the lookup only when it is one of this tenant's own branches (the
    // same gate getOptions / book apply); anything else is refused, never substituted.
    const salonId = String(q?.salonId ?? '').trim();
    if (salonId && salonId !== sessionCtx.branchId && this.repo.branchBelongsToTenant && !(await this.repo.branchBelongsToTenant(sessionCtx, salonId))) {
      throw new BookingValidationError('That salon is not available for booking.');
    }
    const ctx = salonId ? { ...sessionCtx, branchId: salonId } : sessionCtx;
    const service = await this.repo.getService(ctx, serviceId);
    if (!service) throw new BookingValidationError('That service is not available for booking.');
    let technicianIds: string[];
    let holdBranch = ctx.branchId;
    if (technicianId) {
      const t = await this.repo.getTechnician(ctx, technicianId);
      if (!t) throw new BookingValidationError('That technician is not available.');
      technicianIds = [t.id];
      if (t.branchId) holdBranch = t.branchId;   // as book() does: the technician's location is the booking's
    } else {
      technicianIds = (await this.repo.listTechnicians(ctx)).map((t) => t.id);
    }
    // mandate §51/§78: availability lists only technicians approved for the service (the same authority book() asserts)
    if (this.skills) {
      const checks = await Promise.all(technicianIds.map((id) => this.skills!.isSkilled({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId: id, serviceIds: [serviceId] }).catch(() => false)));
      technicianIds = technicianIds.filter((_, i) => checks[i]);
    }
    const existing = await this.repo.existingForDate(ctx, date);
    // Phase 4: a slot held while another customer verifies their phone is not offered (a first-available hold blocks
    // every technician at that time).
    const held = this.verification?.heldSlots && holdBranch ? await this.verification.heldSlots({ ...ctx, branchId: holdBranch }, date, q?.bookingSessionId ?? null).catch(() => []) : [];
    const busy = [...existing, ...held.flatMap((h) => (h.technicianId ? [h.technicianId] : technicianIds).map((t) => ({ appointmentId: 'hold', technicianId: t, startTime: h.startTime, endTime: h.endTime, status: 'booked' })))];
    const window = resolveWindow();
    const slots = computeAvailableSlots(window, service.durationMinutes, technicianIds, busy);
    // §71/§72: a slot outside a technician's working hours / across a break / blocked time is not offered for that technician
    if (this.repo.technicianWindows) {
      const windowsBy = new Map<string, { start: number; end: number }[] | null>();
      await Promise.all(technicianIds.map(async (t) => windowsBy.set(t, await this.repo.technicianWindows!(ctx, t, date).catch(() => null))));
      for (const slot of slots) {
        const s = minutesOf(slot.startTime), e = s + service.durationMinutes;
        slot.technicianIds = slot.technicianIds.filter((t) => { const w = windowsBy.get(t); return w == null || w.some((r) => s >= r.start && e <= r.end); });
        slot.available = slot.technicianIds.length > 0;
      }
    }
    return { date, serviceId, durationMinutes: service.durationMinutes, window, slots };
  }

  /** a slot that has already started on the salon's clock is refused (booking or moving to 9 AM at 3 PM went through) */
  private async assertNotPast(ctx: CustomerBookingContext, date: string, startTime: string) {
    if (!this.repo.salonNow) return;
    const now = await this.repo.salonNow(ctx);
    if (date < now.date || (date === now.date && minutesOf(startTime) <= now.minutes)) throw withCode(new BookingValidationError('That time has already passed. Pick a later time.'), 'SLOT_IN_PAST');
  }
  async book(ctx: CustomerBookingContext, body: CreateBookingRequest): Promise<BookingResult> {
    // Sep 2026 merge (developer's multi-salon booking): a client-named salon is honoured ONLY when it is one of this
    // tenant's own active branches — it was substituted straight into the context — and the accepts-bookings check runs
    // against the branch actually being booked, not the session's default.
    const overrideBranchId = String(body?.salonId ?? '').trim();
    if (overrideBranchId && overrideBranchId !== ctx.branchId && this.repo.branchBelongsToTenant && !(await this.repo.branchBelongsToTenant(ctx, overrideBranchId))) {
      throw new BookingValidationError('That salon is not available for booking.');
    }
    const activeCtx = overrideBranchId ? { ...ctx, branchId: overrideBranchId } : ctx;
    await this.assertSalonAcceptsBookings(activeCtx);
    const serviceIds = Array.isArray(body?.serviceIds) && body.serviceIds.length > 0 ? body.serviceIds : (body?.serviceId ? [String(body.serviceId).trim()] : []);
    const technicianId = String(body?.technicianId ?? '').trim();
    const date = String(body?.date ?? '').trim();
    const startTime = String(body?.startTime ?? '').trim();
    if (serviceIds.length === 0 || !technicianId) throw new BookingValidationError('serviceId(s) and technicianId are required');
    if (!DATE_RE.test(date)) throw new BookingValidationError('date must be YYYY-MM-DD');
    if (!TIME_RE.test(startTime)) throw new BookingValidationError('startTime must be HH:MM');
    await this.assertNotPast(activeCtx, date, startTime);

    const customer = await this.repo.resolveCustomerId(activeCtx);
    if (!customer) throw new NotCustomerError('No customer profile is linked to this account.');

    let totalDuration = 0;
    let totalPrice = 0;
    const addOnIds = Array.isArray(body?.addOnIds) ? body.addOnIds : [];
    const allServicesData: { serviceId: string; serviceName: string; durationMinutes: number; priceCents: number; addOns?: any[] }[] = [];

    // Process all selected services (for multi-service bookings)
    for (let i = 0; i < serviceIds.length; i++) {
      const sId = serviceIds[i];
      const service = await this.repo.getService(activeCtx, sId);
      if (!service) throw new BookingValidationError('One of the selected services is not available for booking.');
      
      let serviceDuration = service.durationMinutes;
      let servicePrice = service.priceCents;
      const selectedAddOnsData: { addOnId: string; name: string; durationDeltaMinutes: number; priceCents: number }[] = [];
      
      // We only apply add-ons to the FIRST service in the list to avoid duplicate add-ons if not specified per-service.
      // (The Customer App currently sends a flat array of add-ons, so we attach them to the primary service).
      if (i === 0 && addOnIds.length > 0) {
        const allAddOns = await this.repo.getServiceAddOns(ctx, sId);
        for (const id of addOnIds) {
          const found = allAddOns.find(a => a.addOnId === id);
          if (found) {
            serviceDuration += found.durationDeltaMinutes;
            servicePrice += found.priceCents;
            selectedAddOnsData.push(found);
          }
        }
      }

      totalDuration += serviceDuration;
      totalPrice += servicePrice;
      allServicesData.push({
        serviceId: service.id,
        serviceName: service.name,
        durationMinutes: serviceDuration,
        priceCents: servicePrice,
        addOns: selectedAddOnsData.length > 0 ? selectedAddOnsData : undefined,
      });
    }

    const primaryService = allServicesData[0];

    const technician = await this.repo.getTechnician(ctx, technicianId);
    if (!technician) throw new BookingValidationError('That technician is not available.');
    
    // If the technician belongs to a specific branch, use their branch instead of the frontend's inferred salonId.
    // This fixes issues where a customer books a "Main salon" technician while authenticated against a different branch.
    if (technician.branchId && technician.branchId !== activeCtx.branchId) {
      activeCtx.branchId = technician.branchId;
    }
    // mandate §51/§78: she must be approved for EVERY requested service (exact service + certification + active employment)
    if (this.skills) {
      try { await this.skills.assertSkilled({ tenantId: activeCtx.tenantId, branchId: activeCtx.branchId || null, technicianId, serviceIds: allServicesData.map((x) => x.serviceId), actor: { userId: activeCtx.userId ?? null, role: 'CUSTOMER' } }); }
      catch (e: any) { if (e instanceof TechnicianNotSkilledError || e?.name === 'TechnicianNotSkilledError') throw new BookingValidationError(e.code === 'TECHNICIAN_NOT_SKILLED' ? 'That technician does not offer one of the selected services.' : 'That technician is not available.'); throw e; }
    }

    const endTime = addMinutesToTime(startTime, totalDuration);
    await this.assertWithinTechnicianWindows(activeCtx, technicianId, date, startTime, endTime);
    const existing = await this.repo.existingForDate(activeCtx, date);
    const buffer = resolveWindow().bufferMinutes;
    const conflict = detectTechnicianConflict(existing as any, technicianId, startTime, endTime, buffer);
    if (conflict.status === 'conflict') throw new BookingConflictError('That time is no longer available with this technician.', conflict.conflictingAppointmentId);

    // ── THE GATE ────────────────────────────────────────────────────────────────────────────────────────
    //
    // This is the line the whole module exists for. Everything else — the policy resolver, the holds, the OTP,
    // the tenant-owned Twilio — is machinery in service of the single fact that an appointment MUST NOT be
    // created before the phone behind it has been proven.
    //
    // It sits HERE: after validation and the conflict check (so we do not send an SMS for a slot that is
    // already gone) and BEFORE `insertBookingAtomic` (so a failure to verify cannot leave an appointment
    // behind). Any code path that reaches the insert without passing this is a hole in the feature.
    const admission = this.verification
      ? await this.verification.admit(activeCtx, {
          customerId: customer.id, channel: 'customer_app', date, startTime, endTime, technicianId,
          serviceIds: allServicesData.map((x) => x.serviceId),
          bookingSessionToken: typeof body?.bookingSessionId === 'string' ? body.bookingSessionId : null,
          deviceId: typeof body?.deviceId === 'string' ? body.deviceId : null,
        })
      : null;

    // Marketplace: reserve the deal AFTER the phone gate (never hold capacity for an unverified booking) and BEFORE
    // the insert (a sold-out deal must not create an appointment). The reservation is oversell-safe; a simultaneous
    // booking of the last slot loses the race here and gets a clean "sold out". A retried booking replays the same
    // hold via the idempotency key.
    const dealId = typeof body?.dealId === 'string' ? body.dealId.trim() : '';
    const dealCtx: DealReservationCtx = { tenantId: activeCtx.tenantId, branchId: activeCtx.branchId, userId: activeCtx.userId, role: 'customer', permissions: [], technicianId: null };
    let dealHoldId: string | undefined;
    if (dealId && this.deals) {
      const idem = (typeof body?.dealIdempotencyKey === 'string' && body.dealIdempotencyKey.trim()) || `book:${customer.id}:${primaryService.serviceId}:${date}:${startTime}`;
      let r: { soldOut: boolean; holdId?: string };
      try {
        r = await this.deals.reserveDeal(dealCtx, dealId, customer.id, idem, { serviceIds: allServicesData.map((x) => x.serviceId), date, startTime, channel: 'customer_app', technicianId, spendCents: totalPrice });
      } catch (e: any) {
        // BUILD_PLAN Phase 5, bug 11: a deal the customer can't have (ended, members only, already used, paused…) came
        // back as a raw 500. It is a clean refusal with the deal's own reason; nothing is created and the phone proof
        // is given back so the customer can book without the deal.
        if (e?.name === 'DealConflictError' || e?.name === 'DealValidationError' || e?.name === 'DealForbiddenError') {
          if (admission) await this.verification!.abandon(admission);
          if (e.name === 'DealConflictError') throw new BookingConflictError(e.message || 'This deal is not available.');
          throw new BookingValidationError(e.message || 'This deal cannot be used for this booking.');
        }
        throw e;
      }
      if (r.soldOut) { if (admission) await this.verification!.abandon(admission); throw new BookingConflictError('This deal has sold out.'); }
      dealHoldId = r.holdId;
    }

    const inspirationNote = typeof body?.inspirationNote === 'string' ? body.inspirationNote.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 280) : ''; // eslint-disable-line no-control-regex -- intentional control-char strip on user input
    const inspirationPhotoId = typeof body?.inspirationPhotoId === 'string' && body.inspirationPhotoId.trim() ? body.inspirationPhotoId.trim().slice(0, 64) : null;
    const inserted = await this.repo.insertBookingAtomic({
      tenantId: activeCtx.tenantId, branchId: activeCtx.branchId, technicianId, customerId: customer.id, customerName: customer.fullName,
      customerPhone: customer.phone ?? null,
      serviceId: primaryService.serviceId, serviceName: primaryService.serviceName, durationMinutes: totalDuration, priceCents: totalPrice, date, startTime, endTime,
      selectedAddOns: primaryService.addOns,
      allServicesData: allServicesData,
      notes: inspirationNote || null, inspirationPhotoId, bufferMinutes: buffer,
      // Wave 3 (Oct 13 2026, §73): the atomic insert re-reads live holds INSIDE its locked transaction. This booking's own
      // verification hold (placed by admit() on the 428, converted by complete()) must not refuse this booking; every
      // other session's hold does.
      bookingSessionId: (admission as { hold?: { bookingSessionId?: string } | null } | null)?.hold?.bookingSessionId ?? null,
    });
    if (!inserted.ok) {
      // The slot was taken (or held by another booking session) between the conflict check and the insert — free the
      // reserved capacity so it isn't lost, and give the phone proof back (the customer picks another time without a new code).
      if (dealHoldId && this.deals) { try { await this.deals.releaseReservation(dealCtx, dealHoldId); } catch { /* best-effort */ } }
      if (admission) await this.verification!.abandon(admission);
      if (inserted.heldBy) throw new BookingConflictError('That time is being booked by someone else right now. Please pick another time.');
      throw new BookingConflictError('That time is no longer available with this technician.', inserted.conflictingAppointmentId);
    }
    const appointmentId = inserted.id;
    // The appointment exists: it says how its phone was proven; the proof and the hold are spent on it.
    if (admission) await this.verification!.complete(activeCtx, admission, appointmentId);
    // Link the reserved deal to the appointment so checkout can apply the locked terms (best-effort — the appointment
    // already exists and must stand; a failed link degrades to "no deal at checkout", never a lost booking).
    if (dealHoldId && this.deals) { try { await this.deals.consumeReservation(dealCtx, dealHoldId, appointmentId); } catch { /* best-effort */ } }
    // push the confirmation to the customer's devices (best-effort; no-op without push or a registered device)
    // VietnamesePOS §54 / §119: in the customer's language (customerNoticeText), never English-only
    if (this.push) { try { const msg = customerNoticeText('appointment_booked_detail', customer.language, { serviceName: primaryService.serviceName, extraServices: allServicesData.length - 1, ymd: date, hhmm: startTime }); await this.push.dispatchToUser(ctx.tenantId, ctx.userId, { title: msg.title, body: msg.body, reference: appointmentId, category: 'APPOINTMENT_CONFIRMATION', data: { appointmentId: String(appointmentId) } }); } catch { /* best-effort */ } }
    // D11: the deposit the salon's policy asks for — the appointment stands either way; the deposit is paid from the app next.
    let deposit: BookingResult['deposit'] = null;
    if (this.deposits) {
      try {
        const startsAt = this.repo.startsAtOf ? await this.repo.startsAtOf(activeCtx, appointmentId) : null;
        deposit = await this.deposits.createForAppointment({ tenantId: activeCtx.tenantId, branchId: activeCtx.branchId, userId: activeCtx.userId }, { appointmentId, customerId: customer.id, priceCents: totalPrice, startsAt: startsAt ?? new Date(`${date}T${startTime}:00Z`) });
      } catch (e) { this.depositLog?.(`booking ${appointmentId}: the deposit row could not be created — ${(e as Error).message}`); }
    }
    return { appointmentId, date, startTime, endTime, serviceName: primaryService.serviceName, technicianName: technician.fullName, status: 'booked', deposit };
  }

  /** §71/§72 (Wave 3): the technician's working hours, breaks and blocked time are scheduling constraints for the customer
   *  app exactly as for the front desk — a customer never gets an override. A port that cannot answer (null) refuses nothing. */
  private async assertWithinTechnicianWindows(ctx: CustomerBookingContext, technicianId: string, date: string, startTime: string, endTime: string): Promise<void> {
    if (!this.repo.technicianWindows) return;
    const windows = await this.repo.technicianWindows(ctx, technicianId, date);
    if (windows == null) return;
    const s = minutesOf(startTime), e = minutesOf(endTime);
    if (!windows.some((w) => s >= w.start && e <= w.end)) throw new BookingValidationError("That time is outside the technician's working hours. Please pick another time.");
  }

  /** §19: every suspension cause stops customer bookings (the check reads the salon's CURRENT status, not the session's). */
  private async assertSalonAcceptsBookings(ctx: CustomerBookingContext): Promise<void> {
    if (this.repo.salonAcceptsBookings && !(await this.repo.salonAcceptsBookings(ctx))) throw new SalonUnavailableError();
  }

  async reschedule(ctx: CustomerBookingContext, appointmentId: string, body: RescheduleRequest): Promise<RescheduleResult> {
    await this.assertSalonAcceptsBookings(ctx);
    const date = String(body?.date ?? '').trim();
    const startTime = String(body?.startTime ?? '').trim();
    if (!DATE_RE.test(date)) throw new BookingValidationError('date must be YYYY-MM-DD');
    if (!TIME_RE.test(startTime)) throw new BookingValidationError('startTime must be HH:MM');
    // a coarse guard only (the slot check refuses a past time in the salon's own zone): the UTC day is already tomorrow on a US
    // evening, so comparing with it refused rescheduling to later TODAY — compare with the UTC day before instead
    // Nov 6 2026: only when there is no salon clock — with one, assertNotPast decides (the server's UTC day disagreed with
    // the salon's day and refused a move the salon clock allowed)
    if (!this.repo.salonNow && date < new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) throw new BookingValidationError('Pick a future date.');
    await this.assertNotPast(ctx, date, startTime);
    const customer = await this.repo.resolveCustomerId(ctx);
    if (!customer) throw new NotCustomerError('No customer profile is linked to this account.');
    const appt = await this.repo.getAppointmentForReschedule(ctx, customer.id, appointmentId);
    if (!appt) throw new BookingValidationError('Appointment not found.');
    if (!['booked', 'confirmed'].includes(appt.status)) throw new BookingValidationError('This appointment can\u2019t be rescheduled.');
    const endTime = addMinutesToTime(startTime, appt.durationMinutes);
    const window = resolveWindow();
    if (minutesOf(startTime) < minutesOf(window.open) || minutesOf(endTime) > minutesOf(window.close)) throw new BookingValidationError('That time is outside booking hours.');
    await this.assertWithinTechnicianWindows(ctx, appt.technicianId, date, startTime, endTime);
    const existing = (await this.repo.existingForDate(ctx, date)).filter((e: any) => e.appointmentId !== appointmentId);
    const conflict = detectTechnicianConflict(existing as any, appt.technicianId, startTime, endTime, window.bufferMinutes);
    if (conflict.status === 'conflict') throw new BookingConflictError('That time is no longer available with this technician.', conflict.conflictingAppointmentId);
    const res = await this.repo.rescheduleAtomic({ tenantId: ctx.tenantId, customerId: customer.id, appointmentId, technicianId: appt.technicianId, date, startTime, endTime, bufferMinutes: window.bufferMinutes });
    if (!res.ok && res.heldBy) throw new BookingConflictError('That time is being booked by someone else right now. Please pick another time.');
    if (!res.ok) throw new BookingConflictError('That time is no longer available with this technician.', res.conflictingAppointmentId);
    if (this.push) { try { await this.push.dispatchToUser(ctx.tenantId, ctx.userId, { title: 'Appointment rescheduled', body: `Moved to ${date} at ${startTime}`, reference: appointmentId, category: 'BOOKING_CHANGE', data: { appointmentId: String(appointmentId) } }); } catch { /* best-effort */ } }
    return { appointmentId, date, startTime, endTime, status: appt.status };
  }
}
