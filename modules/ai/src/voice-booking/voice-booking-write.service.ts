// voice-booking-write.service.ts — Phase 1b (pilot-safe). The WRITE side of the voice gateway. It owns NO booking
// logic: create delegates to the canonical staff BookingService (same conflict/skill/store-hours checks + audit that
// front-desk bookings use). Reschedule and cancel are deliberately NOT executed here for the pilot — they return a
// handoff signal so a human completes them (lowest-risk first slice). Everything stays behind the auth guard and the
// VOICE_WRITE_TOOLS_ENABLED env flag.
//
// SECURITY DECISION (review here): the voice receptionist acts under a dedicated principal with the MINIMAL permission
// set below — view + create only, NO edit/cancel. Bookings are tagged source:'ai' so the audit trail and KPIs clearly
// show AI-created appointments. To change what the AI may do, change AI_RECEPTIONIST_PERMISSIONS — nowhere else.
import { BookingService, type BookingContext, RemoteBookingAdmission, RemoteVerificationRequiredError, BookingVerificationUnavailableError, HoldSlotTakenError, BookingVerificationService, sealVoiceCallback, sealBookingSession, openBookingSession } from '@aipowersalon/booking';
import { normalizePhone } from '@aipowersalon/customers';
import { Injectable, Inject } from '@nestjs/common';
import { Optional } from '@nestjs/common';
import type { VoiceContext } from './voice-booking.service';

/** The voice principal's identity + the permissions it may exercise. Authorized posture (owner-approved):
 *  book, reschedule, and cancel — every reschedule/cancel is gated by caller verification + appointment ownership —
 *  plus customer view/create (creation requires explicit consent). Change this set to change what the AI may do. */
export const AI_RECEPTIONIST_ROLE = 'AI_RECEPTIONIST';
export const AI_RECEPTIONIST_PERMISSIONS = [
  'pos.booking.view', 'pos.booking.create', 'pos.booking.reschedule', 'pos.booking.cancel',
  'pos.customers.view', 'pos.customers.create',
] as const;

export interface VoiceCreateInput {
  serviceId: string; date: string; startTime: string; technicianId?: string;
  customerName: string; customerPhone?: string; customerId?: string;
  confirmed: boolean; // structural confirm-before-write: the agent must pass true after the caller verbally confirms
  /** Phase 4: the sealed booking session a "verify first" refusal issued; presented again once the code was keyed. */
  bookingSessionId?: string;
  /** Round 2 H: this call's booking session (voiceCallSession — server-derived from the provider's call id). The hold the
   *  call placed lives under it: the booking does not trip over it and converts it. Also the default verification session. */
  callSessionId?: string | null;
}

export interface VoiceCreateResult {
  ok: boolean; appointmentId?: string; date?: string; startTime?: string; endTime?: string;
  technicianName?: string; serviceName?: string; error?: string; handoff?: boolean;
  /** The slot is taken (a booking conflict) — decided from the error's TYPE/CODE, never its wording. */
  slotUnavailable?: boolean;
  /** Phase 4: the caller must prove the phone first — the code has been texted (codeSent), the keypad callback is sealed. */
  needsVerification?: boolean; maskedPhone?: string; bookingSessionId?: string; holdExpiresAt?: number | null;
  codeSent?: boolean; callback?: string;
  /** Verification is required and cannot be performed right now (never reported as "slot unavailable"). */
  verificationUnavailable?: boolean;
}

/** What a voice booking session is bound to: this salon's line. */
export const voicePrincipal = (v: { tenantId: string; branchId: string }) => `voice:${v.tenantId}:${v.branchId}`;

/** A booking-engine refusal that means "that time is not available", recognised by type/code first. The wording of the
 *  conflict message changed (Smooth Refresh spec §12: "This time was just booked or changed on another device…") and
 *  the old word-matching then reported a lost slot race as a validation error to the caller (found Sep 30 2026 by the
 *  AI-receptionist e2e). An overbook-confirmation request also counts: a voice caller cannot authorise a double booking. */
export function isSlotConflict(e: any): boolean {
  return e?.name === 'ConflictError' || ['APPOINTMENT_CONFLICT', 'VERSION_CONFLICT', 'OVERBOOK_CONFIRMATION_REQUIRED'].includes(e?.code)
    || /conflict|overlap|taken|already|just booked|double.?book/i.test(String(e?.message ?? ''));
}

@Injectable()
export class VoiceBookingWriteService {
  constructor(
    @Inject(BookingService) private readonly booking: BookingService,
    // The SAME verified-booking flow the customer app and the public link use (policy, proof claimed by ONE
    // appointment, hold). Optional: unbound means the module is not configured for this deployment.
    @Optional() @Inject(RemoteBookingAdmission) private readonly verification?: RemoteBookingAdmission,
    @Optional() @Inject(BookingVerificationService) private readonly codes?: BookingVerificationService,
  ) {}

  /** Build the scoped staff BookingContext the voice principal acts under (minimal permissions; distinct audit role). */
  private ctx(v: VoiceContext): BookingContext {
    return { tenantId: v.tenantId, branchId: v.branchId, userId: 'voice-receptionist', role: AI_RECEPTIONIST_ROLE, permissions: [...AI_RECEPTIONIST_PERMISSIONS] };
  }

  /**
   * Create an appointment via the canonical BookingService. Refuses unless `confirmed` is true (the agent sets this only
   * after the caller verbally confirms service/date/time/technician). Never claims success — it returns exactly what the
   * backend produced, or a relayable error. A backend conflict (slot just taken) surfaces honestly for the agent to
   * offer another time.
   */
  async createAppointment(v: VoiceContext, input: VoiceCreateInput): Promise<VoiceCreateResult> {
    if (!input.confirmed) return { ok: false, error: 'Not booked: the caller has not confirmed the details yet.' };
    if (!input.serviceId || !input.date || !input.startTime || !input.customerName?.trim()) {
      return { ok: false, error: 'Missing service, date, time, or customer name.' };
    }
    // ── THE GATE (AI receptionist) ─────────────────────────────────────────────────────────────────────
    // A caller who reaches the AI receptionist has, so far, proven nothing except that they can dial a number.
    // Spoofing caller ID is trivial, so the number the AI heard is not evidence — it must be PROVEN: a code is texted
    // to it and keyed on the call (DTMF, never spoken). Errors are returned in this service's own {ok:false} shape,
    // because the gateway turns them into speech; a thrown 428 would become a dead line.
    const gctx = { tenantId: v.tenantId, branchId: v.branchId, channel: 'ai_receptionist' as const };
    // Round 2 H: ONE booking session per call — the call's hold, the phone verification and the booking share it, so the
    // verification flow sees the call's hold as its own (never "held by someone else") and the booking converts it.
    const bind = { tenantId: v.tenantId, customerId: voicePrincipal(v) };
    const sessionToken = input.bookingSessionId ?? (input.callSessionId ? sealBookingSession(input.callSessionId, bind) : null);
    const holdSessionId = (input.bookingSessionId ? openBookingSession(input.bookingSessionId, bind) : null) ?? input.callSessionId ?? null;
    let admission: Awaited<ReturnType<RemoteBookingAdmission['admit']>> | null = null;
    if (this.verification) {
      try {
        admission = await this.verification.admit(gctx, {
          phone: input.customerPhone, principal: voicePrincipal(v), bookingSessionToken: sessionToken,
          date: input.date, startTime: input.startTime, serviceIds: [input.serviceId], technicianId: input.technicianId ?? null,
          customerId: input.customerId ?? null,
        });
      } catch (e: any) {
        if (e instanceof RemoteVerificationRequiredError) return this.askForCode(v, e, input.customerPhone);
        if (e instanceof HoldSlotTakenError) return { ok: false, slotUnavailable: true, error: 'That time is being held for another booking.' };
        // NOT booked. The message is already customer-safe (it never names the provider and never echoes the full
        // number), so it can be read aloud as-is.
        if (e instanceof BookingVerificationUnavailableError) return { ok: false, verificationUnavailable: true, error: e.message };
        return { ok: false, error: e?.message ?? 'This booking needs a phone verification first.' };
      }
    }

    let row: any;
    try {
      row = await this.booking.create(this.ctx(v), {
        serviceIds: [input.serviceId],
        technicianId: input.technicianId,
        date: input.date,
        startTime: input.startTime,
        customerId: input.customerId || undefined,
        customerName: input.customerName.trim(),
        customerPhone: input.customerPhone?.trim(),
        source: 'ai', // first-class AI source — visible in audit + KPIs
        holdSessionId,
      });
    } catch (e: any) {
      await this.verification?.abandon(admission);   // the proof may be used for another time
      // Typed backend errors (conflict / validation) become honest, relayable messages — never fabricate success.
      if (isSlotConflict(e)) return { ok: false, slotUnavailable: true, error: 'That time was just taken.' };
      return { ok: false, error: e?.message || 'I could not complete that booking.' };
    }
    if (admission && row?.appointmentId) await this.verification!.complete(gctx, admission, row.appointmentId);
    return {
      ok: true, appointmentId: row.appointmentId, date: input.date, startTime: row.startTime, endTime: row.endTime,
      technicianName: row.technicianName, serviceName: row.services?.[0]?.serviceName,
    };
  }

  /**
   * The refusal, made actionable on a call: the code is texted NOW (the caller is on the line), and the keypad callback
   * is sealed with the salon, the session and the number the code went to — the callback has no other credential.
   */
  private async askForCode(v: VoiceContext, e: RemoteVerificationRequiredError, phone?: string): Promise<VoiceCreateResult> {
    const sid = e.bookingSessionToken ? this.verification!.open(v.tenantId, voicePrincipal(v), e.bookingSessionToken) : null;
    const e164 = normalizePhone(String(phone ?? ''));
    let codeSent = false; let say = e.message;
    if (sid && e164 && this.codes) {
      const out = await this.codes.send({ tenantId: v.tenantId, branchId: v.branchId, channel: 'ai_receptionist', bookingSessionId: sid, customerId: null, requestIp: null, deviceId: null }, e164).catch(() => null);
      codeSent = out?.status === 'code_sent' || out?.status === 'rate_limited';   // rate_limited: one was sent moments ago
      if (out && !codeSent && out.status !== 'already_verified') say = out.message;
    }
    return {
      ok: false, needsVerification: true, error: say, maskedPhone: e.maskedPhone, bookingSessionId: e.bookingSessionToken,
      holdExpiresAt: e.holdExpiresAt, codeSent,
      callback: sid && e164 ? sealVoiceCallback({ tenantId: v.tenantId, branchId: v.branchId, sid, phone: e164 }) : undefined,
    };
  }

  /** Pilot posture: reschedule + cancel are NOT executed by the AI — they hand off to a human. */
  rescheduleRequiresHuman(): VoiceCreateResult { return { ok: false, handoff: true, error: 'Rescheduling is handled by our front desk. I can arrange that for you.' }; }
  cancelRequiresHuman(): VoiceCreateResult { return { ok: false, handoff: true, error: 'Cancellations are handled by our front desk. I can arrange that for you.' }; }
}
