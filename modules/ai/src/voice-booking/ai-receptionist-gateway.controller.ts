// ai-receptionist-gateway.controller.ts — Phase 1 Booking Gateway: the nine versioned REST endpoints Retell custom
// functions call (Retell configures one URL per function, so discrete endpoints are the provider-native shape). Every
// endpoint is a thin delegate over the EXISTING services (VoiceBookingService → CustomerBookingService availability
// engine; VoiceManageService → BookingService/CustomersService; VoiceBookingWriteService → BookingService.create) —
// no second booking system. Auth = VoiceAuthGuard (hashed vk_ key → tenant+branch, server-derived; §3.2). Mutations
// require an Idempotency-Key header (§20), are rate-limited per key scope (§25, in-process — single-instance today),
// and are dark behind VOICE_WRITE_TOOLS_ENABLED: when off, they return HUMAN_HANDOFF_REQUIRED instead of pretending
// success (§37). The legacy POST /voice/tool dispatch endpoint remains for single-URL agent configs.
import { Controller, Get, Post, Param, Query, Body, Headers, Req, UseGuards, UseInterceptors, Optional, Inject } from '@nestjs/common';
import { RECEPTIONIST_CENTER, type ReceptionistCenter } from './receptionist-center';
import { ledgerWarn, type AiCallsIngest } from './ai-calls-ingest';
import { AI_CALLS_INGEST } from './ai-calls-tokens';
import { VoiceAuthGuard } from './voice-auth.guard';
import { VoiceKeyRateLimitGuard } from '@aipowersalon/security/nest';
import { VoiceGatewayMetricsInterceptor } from './voice-gateway-metrics.interceptor';
import { VoiceBookingService, type VoiceContext } from './voice-booking.service';
import { VoiceBookingWriteService } from './voice-booking-write.service';
import { VoiceManageService } from './voice-manage.service';
import { VoiceIdempotencyService, VoiceBranchInfoService } from './voice-idempotency.service';
import { VoiceCallOutcomeService } from './voice-call-outcome.service';
import { AiFollowUpService } from './ai-follow-up.service';
import { voiceWriteToolsEnabled } from './voice-tools';
import { gwOk, gwFail, mapGatewayError, requestIdOf, hashPayload, isoAt, dayNameOf, addDays, maskPhone, FixedWindowLimiter } from './voice-gateway-core';
import { ListQueries } from '@aipowersalon/database';
import { AiReceptionistGatewayControllerListQueries } from './ai-receptionist-gateway.list-queries';


import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { GW_BOOK_BODY, GW_CANCEL_BODY, GW_CUSTOMER_BODY, GW_HANDOFF_BODY, GW_RESCHEDULE_BODY } from '../request-schemas';
@ListQueries(AiReceptionistGatewayControllerListQueries)
@Controller('api/ai-receptionist/v1')
@UseGuards(VoiceAuthGuard, VoiceKeyRateLimitGuard)  // Constitution 12 §58: a leaked key has a budget
@UseInterceptors(VoiceGatewayMetricsInterceptor)
export class AiReceptionistGatewayController {
  // Instance-level so each controller (one process-global singleton in prod; fresh per test) owns its own windows.
  private readonly readLimiter = new FixedWindowLimiter(Number(process.env.VOICE_GATEWAY_READ_LIMIT_PER_MIN ?? 240), 60_000);
  private readonly writeLimiter = new FixedWindowLimiter(Number(process.env.VOICE_GATEWAY_WRITE_LIMIT_PER_MIN ?? 60), 60_000);
  constructor(
    private readonly gateway: VoiceBookingService,
    private readonly write: VoiceBookingWriteService,
    private readonly manage: VoiceManageService,
    private readonly idem: VoiceIdempotencyService,
    private readonly branchInfo: VoiceBranchInfoService,
    private readonly outcomes: VoiceCallOutcomeService,
    private readonly followUps: AiFollowUpService,
    // AI Receptionist guide (Oct 31 2026): booking writes need the platform switch AND this salon's armed flag
    @Optional() @Inject(RECEPTIONIST_CENTER) private readonly rc?: ReceptionistCenter | null,
    // AI Calls guide (Oct 31 2026): a booking request carrying the call id is written to the call's tool ledger, so AI Calls
    // can show "requested → pending code / created" and count only appointments Booking actually holds
    @Optional() @Inject(AI_CALLS_INGEST) private readonly ingest?: AiCallsIngest | null,
  ) {}

  private ctxOf(req: any): VoiceContext { return req.voiceCtx; }
  private limit(ctx: VoiceContext, kind: 'read' | 'write', rid: string) {
    const res = (kind === 'read' ? this.readLimiter : this.writeLimiter).allow(`${ctx.tenantId}|${ctx.branchId}|${kind}`);
    if (!res.ok) gwFail('RATE_LIMIT_EXCEEDED', 'Too many requests — please retry shortly.', rid, { retryAfterSeconds: res.retryAfterSec });
  }
  private async requireWrites(ctx: VoiceContext, rid: string) {
    const allowed = this.rc ? await this.rc.bookingArmed(ctx.tenantId, ctx.branchId ?? null) : voiceWriteToolsEnabled(process.env);
    if (!allowed) {
      gwFail('HUMAN_HANDOFF_REQUIRED', 'Booking changes are temporarily unavailable — please connect the caller to the front desk.', rid);
    }
  }
  /**
   * Constitution 12 M12: the caller id comes from the `X-Voice-Caller-Number` HEADER, which the voice platform's
   * SERVER-SIDE integration fills from the call's own metadata (e.g. a {{call.from_number}} template in the tool
   * config) — not from the tool arguments the model writes. No header, no verification: the agent hands off.
   */
  private async verified(ctx: VoiceContext, phone: unknown, name: unknown, rid: string, req: any) {
    const callerId = typeof req?.headers?.['x-voice-caller-number'] === 'string' ? req.headers['x-voice-caller-number'] : null;
    const caller = await this.manage.verifyCaller(ctx, { phone: String(phone ?? ''), name: name == null ? undefined : String(name) }, callerId);
    if (!caller) gwFail('CALLER_VERIFICATION_REQUIRED', 'I couldn\u2019t verify that phone number against an account.', rid);
    return caller!;
  }
  /** Idempotency wrapper for mutations: required header, replay-on-retry, conflict on changed payload, release on failure. */
  private async idempotent<T>(ctx: VoiceContext, op: string, key: string | undefined, payload: unknown, rid: string, run: () => Promise<T>, keep: (resp: T) => boolean = () => true): Promise<T> {
    if (!key?.trim()) gwFail('VALIDATION_ERROR', 'The Idempotency-Key header is required for this operation.', rid);
    const begin = await this.idem.begin(ctx, op, key!.trim(), hashPayload(payload));
    if (begin.kind === 'replay') { const r: any = begin.response; return { ...r, meta: { ...(r?.meta ?? {}), requestId: rid, idempotentReplay: true } }; }
    if (begin.kind === 'conflict') gwFail('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used with a different request.', rid);
    if (begin.kind === 'inflight') gwFail('IDEMPOTENCY_IN_FLIGHT', 'An identical request is still in progress.', rid);
    try {
      const resp = await run();
      // A response that is a precondition rather than an outcome ("key the code first") is NOT remembered under the key:
      // the retry with the same key, after the caller proved the phone, must book — not replay the request for a code.
      if (keep(resp)) await this.idem.commit(ctx, op, key!.trim(), resp); else await this.idem.release(ctx, op, key!.trim());
      return resp;
    }
    catch (e) { await this.idem.release(ctx, op, key!.trim()); throw e; }
  }

  // ---- 1. GET /services ----
  @Get('services')
  async services(@Req() req: any, @Query('requestId') qRid?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(qRid); this.limit(ctx, 'read', rid);
    try {
      const [services, hours] = await Promise.all([this.gateway.services(ctx), this.branchInfo.storeHours(ctx)]);
      return gwOk({ services }, { requestId: rid, tenantTimezone: hours.timezone });
    } catch (e) { mapGatewayError(e, rid); }
  }

  // ---- 2. GET /hours ----
  @Get('hours')
  async hours(@Req() req: any, @Query('startDate') startDate?: string, @Query('days') days?: string, @Query('requestId') qRid?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(qRid); this.limit(ctx, 'read', rid);
    try {
      const from = /^\d{4}-\d{2}-\d{2}$/.test(startDate ?? '') ? startDate! : new Date().toISOString().slice(0, 10);
      const n = Math.min(Math.max(Number(days) || 7, 1), 14); // bounded range (§9)
      const info = await this.branchInfo.storeHours(ctx);
      const out = Array.from({ length: n }, (_, i) => {
        const date = addDays(from, i); const day = dayNameOf(date); const h = info.storeHours[day];
        return { date, dayOfWeek: day.toUpperCase(), isOpen: h?.isOpen ?? false, openTime: h?.isOpen ? h?.openTime ?? null : null, closeTime: h?.isOpen ? h?.closeTime ?? null : null };
      });
      return gwOk({ timezone: info.timezone, hours: out }, { requestId: rid, tenantTimezone: info.timezone });
    } catch (e) { mapGatewayError(e, rid); }
  }

  // ---- 3. GET /availability ----
  @Get('availability')
  async availability(@Req() req: any, @Query('serviceId') serviceId?: string, @Query('date') date?: string, @Query('technicianId') technicianId?: string, @Query('limit') limit?: string, @Query('requestId') qRid?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(qRid); this.limit(ctx, 'read', rid);
    if (!serviceId?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) gwFail('VALIDATION_ERROR', 'serviceId and date (YYYY-MM-DD) are required.', rid);
    try {
      const [slots, info] = await Promise.all([
        this.gateway.availability(ctx, { serviceId: serviceId!.trim(), date: date!, technicianId: technicianId?.trim() || undefined }),
        this.branchInfo.storeHours(ctx),
      ]);
      const cap = Math.min(Math.max(Number(limit) || 20, 1), 50);
      // Re-verify against the authoritative buffer-aware rule so we never offer a slot create() would reject.
      const bookable = await this.manage.filterBookable(ctx, date!, slots, Math.min(cap + 4, 16));
      const out = bookable.slice(0, cap).map((s) => ({
        startAt: isoAt(date!, s.startTime, info.timezone), endAt: isoAt(date!, s.endTime, info.timezone),
        displayTime: s.startTime, technicianId: s.technicianId, durationMinutes: s.durationMinutes, priceEstimateCents: s.priceEstimateCents,
      }));
      return gwOk({ date, timezone: info.timezone, slots: out }, { requestId: rid, tenantTimezone: info.timezone });
    } catch (e) { mapGatewayError(e, rid); }
  }

  // ---- 4. POST /customers/lookup-or-create (idempotent; creation is consent-gated) ----
  @Post('customers/lookup-or-create')
  async lookupOrCreateCustomer(@Req() req: any, @Body(ValidatedBody(GW_CUSTOMER_BODY)) b: any, @Headers('idempotency-key') idemKey?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(b?.requestId); this.limit(ctx, 'write', rid);
    return this.idempotent(ctx, 'customer', idemKey ?? b?.requestId, { phone: b?.phone, name: b?.name ?? b?.firstName, consent: b?.consent }, rid, async () => {
      try {
        const r = await this.manage.lookupOrCreateCustomer(ctx, { phone: String(b?.phone ?? ''), name: [b?.firstName, b?.lastName].filter(Boolean).join(' ') || b?.name, consent: b?.consent === true });
        if (r.ok) return gwOk({ customer: { id: r.customerId, ...(r.customer ?? {}) }, created: r.created === true, matchType: r.matchType ?? (r.created ? 'CREATED' : 'PHONE_EXACT') }, { requestId: rid });
        if (r.ambiguous) gwFail('CUSTOMER_MATCH_AMBIGUOUS', 'More than one customer matches that phone number — please connect the caller to the front desk.', rid);
        if (/consent|permission/i.test(r.error ?? '')) {
          await this.requireWrites(ctx, rid); // creating a record is a write; refuse honestly when writes are dark
          gwFail('CUSTOMER_CONSENT_REQUIRED', r.error!, rid);
        }
        gwFail('VALIDATION_ERROR', r.error ?? 'Could not look up that customer.', rid);
      } catch (e) { mapGatewayError(e, rid); }
    });
  }

  // ---- 5. POST /appointments (book; idempotent; confirm-gated) ----
  @Post('appointments')
  async book(@Req() req: any, @Body(ValidatedBody(GW_BOOK_BODY)) b: any, @Headers('idempotency-key') idemKey?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(b?.requestId); this.limit(ctx, 'write', rid); await this.requireWrites(ctx, rid);
    const callRef = typeof b?.callId === 'string' && b.callId.trim() ? b.callId.trim().slice(0, 128) : null;
    const led = callRef && this.ingest && ctx.branchId
      ? await this.ingest.toolRequested({ tenantId: ctx.tenantId, branchId: ctx.branchId }, callRef, 'create_appointment', 'write', `${idemKey ?? ''}|${JSON.stringify(b ?? {})}`).catch((e: unknown) => ledgerWarn('request', e)) : null;
    try {
      const resp: any = await this.bookOnce(ctx, rid, b, idemKey);
      if (led && !led.repeat) {
        const apptId = resp?.data?.appointment?.id ?? null;
        await this.ingest!.toolFinished(ctx.tenantId, led.id, resp?.action === 'collect_verification_code'
          ? { status: 'succeeded', businessResult: 'pending_verification', relatedType: 'booking_session', relatedId: resp?.bookingSessionId ?? null }
          : apptId ? { status: 'succeeded', businessResult: 'appointment_created', relatedType: 'appointment', relatedId: String(apptId) }
          : { status: 'failed', businessResult: null, errorCategory: 'no_appointment_returned' }).catch((e: unknown) => ledgerWarn('result', e));
      }
      return resp;
    } catch (e: any) {
      if (led && !led.repeat) await this.ingest!.toolFinished(ctx.tenantId, led.id, { status: 'failed', businessResult: /SLOT_UNAVAILABLE/.test(String(e?.response?.error?.code ?? e?.response?.code ?? e?.code ?? '')) ? 'slot_taken' : null,
        errorCategory: String(e?.response?.error?.code ?? e?.response?.code ?? e?.code ?? 'booking_failed').slice(0, 60) }).catch((x: unknown) => ledgerWarn('failure', x));
      throw e;
    }
  }

  private bookOnce(ctx: VoiceContext, rid: string, b: any, idemKey?: string) {
    return this.idempotent(ctx, 'book', idemKey, { serviceId: b?.serviceId, date: b?.date, startTime: b?.startTime, technicianId: b?.technicianId, customerId: b?.customerId, customerName: b?.customerName, customerPhone: b?.customerPhone }, rid, async () => {
      try {
        if (b?.callerConfirmed !== true && b?.confirmed !== true) gwFail('CONFIRMATION_REQUIRED', 'Please confirm the appointment details with the caller first.', rid);
        let customerName: string | undefined = b?.customerName?.trim();
        let customerPhone: string | undefined = b?.customerPhone?.trim();
        if (b?.customerId && !customerName) {
          const c = await this.manage.customerContact(ctx, String(b.customerId));
          if (!c) gwFail('CUSTOMER_NOT_FOUND', 'I couldn\u2019t find that customer.', rid);
          customerName = c!.name; customerPhone = customerPhone ?? c!.phone ?? undefined;
        }
        const r = await this.write.createAppointment(ctx, {
          serviceId: String(b?.serviceId ?? ''), date: String(b?.date ?? ''), startTime: String(b?.startTime ?? ''),
          technicianId: b?.technicianId ? String(b.technicianId) : undefined, customerId: b?.customerId ? String(b.customerId) : undefined,
          customerName: customerName ?? '', customerPhone, notes: b?.customerNotes ? String(b.customerNotes).slice(0, 500) : undefined, confirmed: true,
          bookingSessionId: typeof b?.bookingSessionId === 'string' ? b.bookingSessionId : undefined,
        } as any);
        // ── the appointment was NOT created: the caller must prove the phone first ──
        //
        // Returned as a STRUCTURED INSTRUCTION rather than an error, because we do not own the call flow — an
        // external voice platform does. `collect_verification_code` + `input: 'dtmf'` tells it, in its own terms,
        // to take the code on the KEYPAD.
        //
        // `input: 'dtmf'` is not advisory. A spoken code enters the audio, and the audio becomes a transcript, an
        // AI prompt, a summary, a search index and a recording. The redactor catches four of five real cases at
        // best; not transcribing the code at all catches five of five.
        if (!r.ok && r.needsVerification) {
          const base = (process.env.PUBLIC_API_BASE_URL || process.env.APS_API_BASE || '').replace(/\/+$/, '');
          // The keypad callback carries its own sealed credential (the provider posting the digits cannot present our
          // key): the salon, the booking session and the number the code went to.
          const vc = r.callback ? encodeURIComponent(r.callback) : '';
          return {
            ok: false,
            action: 'collect_verification_code',
            input: 'dtmf',
            numDigits: 6,
            maskedPhone: r.maskedPhone ?? null,
            codeSent: r.codeSent === true,
            say: r.codeSent ? `${r.error} I've just texted a 6-digit code to the number ending ${String(r.maskedPhone ?? '').slice(-4)}. Please enter it on your keypad.` : r.error,
            // Present this with the SAME booking details once the code was keyed; it claims the proof for one appointment.
            bookingSessionId: r.bookingSessionId ?? null,
            holdExpiresAt: r.holdExpiresAt ? new Date(r.holdExpiresAt).toISOString() : null,
            dtmfUrl: vc ? `${base}/api/ai-receptionist/v1/verification/dtmf?vc=${vc}` : null,
            twimlUrl: vc ? `${base}/api/ai-receptionist/v1/verification/twiml?vc=${vc}` : null,
            requestId: rid,
          };
        }
        if (!r.ok && r.verificationUnavailable) gwFail('PHONE_VERIFICATION_UNAVAILABLE', r.error ?? 'We can\u2019t verify phone numbers right now.', rid);
        // Decided from the write service's TYPED flag, never the wording (a policy message containing "unavailable"
        // was being reported as a taken slot).
        if (!r.ok) { if (r.slotUnavailable) gwFail('SLOT_UNAVAILABLE', 'That appointment time is no longer available.', rid); gwFail('VALIDATION_ERROR', r.error ?? 'Could not book that appointment.', rid); }
        const info = await this.branchInfo.storeHours(ctx);
        const a: any = r;
        return gwOk({ appointment: {
          id: a.appointmentId, status: 'BOOKED', date: a.date ?? b?.date, startAt: isoAt(a.date ?? b?.date, a.startTime, info.timezone), endAt: isoAt(a.date ?? b?.date, a.endTime, info.timezone),
          displayTime: a.startTime, technician: a.technicianName ? { name: a.technicianName } : null,
          services: [{ id: b?.serviceId, name: a.serviceName ?? null }],
        }, spokenConfirmation: `Your appointment is booked for ${a.date ?? b?.date} at ${a.startTime}.` }, { requestId: rid, tenantTimezone: info.timezone });
      } catch (e) { mapGatewayError(e, rid); }
    }, (resp: any) => resp?.action !== 'collect_verification_code');
  }

  // ---- 6. GET /appointments/:id (verification-gated; own appointment only) ----
  @Get('appointments/:appointmentId')
  async getAppointment(@Req() req: any, @Param('appointmentId') id: string, @Query('phone') phone?: string, @Query('name') name?: string, @Query('requestId') qRid?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(qRid); this.limit(ctx, 'read', rid);
    try {
      const caller = await this.verified(ctx, phone, name, rid, req);
      const r = await this.manage.getOwnAppointment(ctx, caller, id);
      if (!r.ok) gwFail('APPOINTMENT_NOT_FOUND', r.error ?? 'I couldn\u2019t find that appointment.', rid);
      const info = await this.branchInfo.storeHours(ctx);
      const a = r.appointment!;
      return gwOk({ appointment: { ...a, startAt: a.date ? isoAt(a.date, a.startTime, info.timezone) : null, endAt: a.date ? isoAt(a.date, a.endTime, info.timezone) : null, customer: { ...a.customer, phoneMasked: maskPhone(caller.phone) } } }, { requestId: rid, tenantTimezone: info.timezone });
    } catch (e) { mapGatewayError(e, rid); }
  }

  // ---- 7. POST /appointments/:id/reschedule (idempotent; verified; own only; confirm-gated) ----
  @Post('appointments/:appointmentId/reschedule')
  async reschedule(@Req() req: any, @Param('appointmentId') id: string, @Body(ValidatedBody(GW_RESCHEDULE_BODY)) b: any, @Headers('idempotency-key') idemKey?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(b?.requestId); this.limit(ctx, 'write', rid); await this.requireWrites(ctx, rid);
    return this.idempotent(ctx, 'reschedule', idemKey, { id, date: b?.date, startTime: b?.startTime ?? b?.newStartTime, phone: b?.phone }, rid, async () => {
      try {
        const caller = await this.verified(ctx, b?.phone, b?.name, rid, req);
        if (b?.callerConfirmed !== true && b?.confirmed !== true) gwFail('CONFIRMATION_REQUIRED', 'Please confirm the new time with the caller first.', rid);
        const r = await this.manage.rescheduleAppointment(ctx, { appointmentId: id, date: b?.date ? String(b.date) : undefined, startTime: String(b?.startTime ?? b?.newStartTime ?? ''), caller, confirmed: true });
        if (!r.ok) {
          if (/under your account|find that appointment/i.test(r.error ?? '')) gwFail('APPOINTMENT_NOT_FOUND', r.error!, rid);
          if ((r as any).slotUnavailable || /available|conflict|taken|double.?book|busy|overlap/i.test(r.error ?? '')) gwFail('SLOT_UNAVAILABLE', r.error!, rid);
          gwFail('VALIDATION_ERROR', r.error ?? 'Could not reschedule that appointment.', rid);
        }
        const info = await this.branchInfo.storeHours(ctx);
        return gwOk({ appointment: { id: r.appointmentId, status: 'BOOKED', date: r.date ?? null, startAt: r.date ? isoAt(r.date, r.startTime!, info.timezone) : null, endAt: r.date && r.endTime ? isoAt(r.date, r.endTime, info.timezone) : null, displayTime: r.startTime ?? null }, spokenConfirmation: `Your appointment is moved to ${r.date} at ${r.startTime}.` }, { requestId: rid, tenantTimezone: info.timezone });
      } catch (e) { mapGatewayError(e, rid); }
    });
  }

  // ---- 8. POST /appointments/:id/cancel (idempotent; verified; own only; confirm-gated) ----
  @Post('appointments/:appointmentId/cancel')
  async cancel(@Req() req: any, @Param('appointmentId') id: string, @Body(ValidatedBody(GW_CANCEL_BODY)) b: any, @Headers('idempotency-key') idemKey?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(b?.requestId); this.limit(ctx, 'write', rid); await this.requireWrites(ctx, rid);
    return this.idempotent(ctx, 'cancel', idemKey, { id, phone: b?.phone, reason: b?.reason }, rid, async () => {
      try {
        const caller = await this.verified(ctx, b?.phone, b?.name, rid, req);
        if (b?.callerConfirmed !== true && b?.confirmed !== true) gwFail('CONFIRMATION_REQUIRED', 'Please confirm the cancellation with the caller first.', rid);
        const r = await this.manage.cancelAppointment(ctx, { appointmentId: id, caller, confirmed: true, reason: b?.reason ? String(b.reason) : undefined });
        if (!r.ok) {
          if (/under your account|find that appointment/i.test(r.error ?? '')) gwFail('APPOINTMENT_NOT_FOUND', r.error!, rid);
          gwFail('APPOINTMENT_NOT_MODIFIABLE', r.error ?? 'Could not cancel that appointment.', rid);
        }
        return gwOk({ appointment: { id: r.appointmentId, status: 'CANCELED' }, spokenConfirmation: 'Your appointment has been canceled.' }, { requestId: rid });
      } catch (e) { mapGatewayError(e, rid); }
    });
  }

  // ---- 9. POST /handoff (idempotent; destination ALWAYS server-derived; works even when writes are dark) ----
  @Post('handoff')
  async handoff(@Req() req: any, @Body(ValidatedBody(GW_HANDOFF_BODY)) b: any, @Headers('idempotency-key') idemKey?: string) {
    const ctx = this.ctxOf(req); const rid = requestIdOf(b?.requestId); this.limit(ctx, 'write', rid);
    return this.idempotent(ctx, 'handoff', idemKey ?? b?.callId ?? b?.requestId, { reason: b?.reason, callId: b?.callId }, rid, async () => {
      try {
        const destination = await this.branchInfo.transferDestination(ctx);
        const reason = String(b?.reason ?? 'OTHER').slice(0, 60);
        if (b?.callId) {
          await this.outcomes.record(ctx, 'retell', { providerCallId: String(b.callId), handoffOutcome: destination ? 'transferred' : 'callback', intents: ['HANDOFF'], summary: b?.summary ? String(b.summary).slice(0, 500) : null }).catch(() => null);
        }
        return destination
          ? gwOk({ handoff: { accepted: true, transferEnabled: true, transferDestination: destination, reason }, spokenMessage: 'I\u2019ll connect you with the salon now.' }, { requestId: rid })
          : await (async () => {
              // No live transfer available → record a callback follow-up so staff actually call back (idempotent per call).
              let referenceId: string | undefined;
              if (b?.callId) {
                const fu = await this.followUps.createFromHandoff({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null }, { reason: 'CALLBACK', providerCallId: String(b.callId), callerPhone: b?.callerPhone ? String(b.callerPhone) : null, notes: b?.summary ? String(b.summary).slice(0, 500) : null, priority: 'high' }).catch(() => null);
                referenceId = fu?.id;
              }
              return gwOk({ handoff: { accepted: true, transferEnabled: false, callbackRequested: true, reason, ...(referenceId ? { referenceId } : {}) }, spokenMessage: 'The salon can\u2019t take a transfer right now, but I\u2019ve noted your request so they can follow up.' }, { requestId: rid });
            })();
      } catch (e) { mapGatewayError(e, rid); }
    });
  }
}
