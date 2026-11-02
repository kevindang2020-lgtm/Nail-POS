// ai-booking-mutation.service.ts — Stage 2 of ai_booking. The channel-agnostic MUTATION facade. It never inserts or
// updates appointment rows itself: it delegates to the authoritative BookingService (which re-checks permission,
// availability, and conflicts and holds the double-booking lock inside its own transaction). ai_booking adds only the
// cross-channel contract: (1) explicit human/verified confirmation before any write, (2) durable idempotency — reusing
// the SAME ledger table as the Copilot spine (migration 307), never a second one, (3) channel SOURCE stamping onto
// appointments.source (original source is set at create and never overwritten by reschedule/cancel), and (4) conversion
// funnel recording. Domain errors are mapped to stable ai_booking failure codes.
import { RemoteBookingAdmission, RemoteVerificationRequiredError, HoldSlotTakenError, BookingPhoneNotVerifiedError, BookingVerificationUnavailableError, BookingPhoneInvalidError, BookingService, ForbiddenError, ValidationError, ConflictError } from '@aipowersalon/booking';
import { Injectable, Inject, Optional } from '@nestjs/common';
import { log as rootLog } from '@aipowersalon/observability';
const log = rootLog.withContext({ component: 'ai-booking-mutation' });
import type { ActionLedgerRepo } from '@aipowersalon/ai';
import { AiBookingConversionService, type FunnelStage } from './ai-booking-conversion.service';
import { domainSourceFor } from './ai-booking-source';
import type { AiBookingContext } from './ai-booking-context';

export interface MutationResult {
  ok: boolean; requiresConfirmation?: boolean; errorCode?: string; message?: string; appointmentId?: string | null; duplicate?: boolean;
  /** PHONE_VERIFICATION_REQUIRED only: the sealed booking session to send the code for, the masked number, the hold's end. */
  bookingSessionId?: string; maskedPhone?: string; holdExpiresAt?: string | null;
}

export interface CreateInput {
  customerName: string; customerId?: string; customerPhone?: string; serviceIds: string[]; date: string; startTime: string; technicianId?: string; notes?: string; confirm?: boolean; idempotencyKey?: string;
  /** Phase 4 (public link): the sealed booking session a "verify first" refusal issued, and where the request came from. */
  bookingSessionId?: string; deviceId?: string; requestIp?: string | null;
}
export interface RescheduleInput { startTime: string; date?: string; technicianId?: string; confirm?: boolean; idempotencyKey?: string }
export interface CancelInput { reason: string; confirm?: boolean; idempotencyKey?: string }

@Injectable()
export class AiBookingMutationService {
  constructor(
    private readonly booking: BookingService,
    private readonly conversion: AiBookingConversionService,
    @Optional() @Inject('CopilotActionLedger') private readonly ledger?: ActionLedgerRepo,
    // The SAME verified-booking flow the customer app, the AI receptionist and the kiosk use: policy, the proof
    // (claimed by ONE appointment), the hold. Optional: unbound means the module is not deployed here.
    @Optional() @Inject(RemoteBookingAdmission) private readonly verification?: RemoteBookingAdmission,
  ) {}

  private bctx(ctx: AiBookingContext) {
    return { tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions } as any;
  }

  // Map a domain exception to a stable ai_booking failure code (§28/§50).
  private mapError(e: any): { code: string; message: string; extra?: Partial<MutationResult> } {
    if (e instanceof ConflictError) return { code: 'APPOINTMENT_CONFLICT', message: e.message };
    if (e instanceof HoldSlotTakenError) return { code: 'APPOINTMENT_CONFLICT', message: e.message };
    if (e instanceof RemoteVerificationRequiredError) {
      return { code: 'PHONE_VERIFICATION_REQUIRED', message: e.message, extra: { bookingSessionId: e.bookingSessionToken, maskedPhone: e.maskedPhone, holdExpiresAt: e.holdExpiresAt ? new Date(e.holdExpiresAt).toISOString() : null } };
    }
    if (e instanceof ForbiddenError) return { code: 'PERMISSION_DENIED', message: 'You do not have permission for this action.' };
    if (e instanceof ValidationError) return { code: 'VALIDATION_ERROR', message: e.message };
    // Phone-verification refusals are ACTIONABLE outcomes, not server faults. Without these three lines they fell
    // through to INTERNAL_ERROR — so a guest on a public booking link was told "the booking action could not be
    // completed" instead of "verify your phone", and the funnel recorded an internal error rather than the real
    // reason. The public link is exactly the channel this gate exists for, so it must speak clearly.
    if (e instanceof BookingPhoneNotVerifiedError) return { code: 'PHONE_VERIFICATION_REQUIRED', message: e.message };
    if (e instanceof BookingVerificationUnavailableError) return { code: 'PHONE_VERIFICATION_UNAVAILABLE', message: e.message };
    if (e instanceof BookingPhoneInvalidError) return { code: 'INVALID_PHONE', message: e.message };
    const msg = String(e?.message || '');
    if (/not found/i.test(msg)) return { code: 'APPOINTMENT_NOT_FOUND', message: 'Appointment not found.' };
    return { code: 'INTERNAL_ERROR', message: 'The booking action could not be completed.' };
  }

  // Shared spine: confirm-gate + idempotency replay + funnel, around a delegated domain mutation.
  private async run(ctx: AiBookingContext, opts: { op: string; confirm?: boolean; idempotencyKey?: string; attemptStage?: FunnelStage; okStage?: FunnelStage; failStage?: FunnelStage }, exec: () => Promise<{ appointmentId: string | null }>): Promise<MutationResult> {
    if (opts.confirm !== true) {
      if (opts.attemptStage) await this.conversion.record(ctx, { stage: 'CONFIRMATION_REQUESTED' });
      return { ok: false, requiresConfirmation: true, errorCode: 'HUMAN_CONFIRMATION_REQUIRED', message: 'This action changes a booking and must be explicitly confirmed.' };
    }
    const key = opts.idempotencyKey ? String(opts.idempotencyKey) : null;
    if (key && this.ledger) {
      const prior = await this.ledger.find(ctx.tenantId, key).catch(() => null);
      if (prior) return { ok: prior.ok, errorCode: prior.ok ? undefined : 'IDEMPOTENCY_CONFLICT', message: 'This action was already processed.', appointmentId: prior.resourceId ?? null, duplicate: true };
    }
    const started = Date.now();
    if (opts.attemptStage) await this.conversion.record(ctx, { stage: opts.attemptStage });
    try {
      const { appointmentId } = await exec();
      if (key && this.ledger) await this.ledger.record(ctx.tenantId, ctx.branchId, key, opts.op, true, appointmentId).catch(() => undefined);
      if (opts.okStage) await this.conversion.record(ctx, { stage: opts.okStage, outcome: 'succeeded', appointmentId, latencyMs: Date.now() - started });
      return { ok: true, appointmentId };
    } catch (e: any) {
      const { code, message, extra } = this.mapError(e);
      // An unmapped failure is a defect somewhere below — the caller gets a safe message, the log gets the cause.
      if (code === 'INTERNAL_ERROR') log.error('ai_booking.mutation_failed', { op: opts.op, tenantId: ctx.tenantId, error: String(e?.message ?? e).slice(0, 300) });
      // "Verify your phone first" is a precondition, not an outcome: recording it under the idempotency key would turn
      // the guest's retry (same key, now with the proof) into "already processed" — a booking that can never happen.
      if (key && this.ledger && code !== 'PHONE_VERIFICATION_REQUIRED') await this.ledger.record(ctx.tenantId, ctx.branchId, key, opts.op, false, null).catch(() => undefined);
      if (opts.failStage) await this.conversion.record(ctx, { stage: opts.failStage, outcome: 'failed', failureReason: code, latencyMs: Date.now() - started });
      return { ok: false, errorCode: code, message, ...(extra ?? {}) };
    }
  }

  // §54: require the ai_booking action permission (in addition to the domain pos.booking.* the engine enforces).
  private deny(ctx: AiBookingContext, perm: string): MutationResult | null {
    return (ctx.permissions || []).includes(perm) ? null : { ok: false, errorCode: 'PERMISSION_DENIED', message: 'This channel is not permitted to perform that booking action.' };
  }

  async createAppointment(ctx: AiBookingContext, input: CreateInput): Promise<MutationResult> {
    const d = this.deny(ctx, 'ai_booking.create'); if (d) return d;
    return this.run(ctx, { op: 'create_appointment', confirm: input.confirm, idempotencyKey: input.idempotencyKey, attemptStage: 'BOOKING_ATTEMPTED', okStage: 'BOOKING_SUCCEEDED', failStage: 'BOOKING_FAILED' }, async () => {
      // ── THE GATE (public / partner booking link) ──────────────────────────────────────────────────────
      // This surface is UNAUTHENTICATED — a signed link, open to the internet. It is the channel fake bookings
      // actually arrive through. Admission throws unless the phone is proven FOR THIS BOOKING (the proof is claimed by
      // exactly one appointment); returning is the only permission. Staff using the copilot are not verified — a
      // staff-created booking is the front desk's, exactly like the POS calendar (the audit found it checked as
      // 'online', so a receptionist was asked for the customer's code).
      const gctx = { tenantId: ctx.tenantId, branchId: ctx.branchId ?? '', channel: 'online' as const };
      const admission = this.verification && ctx.role === 'PUBLIC_BOOKING'
        ? await this.verification.admit(gctx, {
            phone: input.customerPhone, principal: `link:${(ctx as any).jti ?? ctx.tenantId}`, bookingSessionToken: input.bookingSessionId ?? null,
            date: input.date, startTime: input.startTime, serviceIds: input.serviceIds ?? [], technicianId: input.technicianId ?? null,
            deviceId: input.deviceId ? String(input.deviceId).slice(0, 200) : null, requestIp: input.requestIp ?? null,
          })
        : null;
      let row: any;
      try {
        row = await this.booking.create(this.bctx(ctx), {
          customerName: input.customerName, customerId: input.customerId, customerPhone: input.customerPhone,
          serviceIds: input.serviceIds, date: input.date, startTime: input.startTime, technicianId: input.technicianId,
          notes: input.notes, source: domainSourceFor(ctx.source) as any,   // stamp the channel source (original, never overwritten later)
          // w4 sweep SW-20: made FROM the guest's own verification hold (the admitted, opened session) — without it the
          // hold placed on the refused first attempt blocked the verified retry as "held for another booking"
          holdSessionId: (admission as { hold?: { bookingSessionId?: string } | null } | null)?.hold?.bookingSessionId ?? null,
        });
      } catch (e) {
        await this.verification?.abandon(admission);   // the proof may be used again for another time
        throw e;
      }
      if (admission && row?.appointmentId) await this.verification!.complete(gctx, admission, row.appointmentId);
      return { appointmentId: row?.appointmentId ?? null };
    });
  }

  async rescheduleAppointment(ctx: AiBookingContext, appointmentId: string, input: RescheduleInput): Promise<MutationResult> {
    const d = this.deny(ctx, 'ai_booking.reschedule'); if (d) return d;
    return this.run(ctx, { op: 'reschedule_appointment', confirm: input.confirm, idempotencyKey: input.idempotencyKey, attemptStage: 'RESCHEDULE_ATTEMPTED', okStage: 'RESCHEDULE_SUCCEEDED', failStage: 'RESCHEDULE_FAILED' }, async () => {
      const row: any = await this.booking.reschedule(this.bctx(ctx), appointmentId, { startTime: input.startTime, date: input.date, technicianId: input.technicianId } as any);
      return { appointmentId: row?.appointmentId ?? appointmentId };
    });
  }

  async cancelAppointment(ctx: AiBookingContext, appointmentId: string, input: CancelInput): Promise<MutationResult> {
    const d = this.deny(ctx, 'ai_booking.cancel'); if (d) return d;
    return this.run(ctx, { op: 'cancel_appointment', confirm: input.confirm, idempotencyKey: input.idempotencyKey, attemptStage: 'CANCEL_INTENT', okStage: 'CANCEL_SUCCEEDED', failStage: 'CANCEL_FAILED' }, async () => {
      const row: any = await this.booking.cancel(this.bctx(ctx), appointmentId, { reason: input.reason } as any);
      return { appointmentId: row?.appointmentId ?? appointmentId };
    });
  }

  // Appointment confirmation (§23) — a status transition, not part of the booking-conversion funnel, so no funnel stages.
  // Still confirm-gated + idempotent; delegates to the authoritative BookingService.confirm.
  async confirmAppointment(ctx: AiBookingContext, appointmentId: string, input: { confirm?: boolean; idempotencyKey?: string }): Promise<MutationResult> {
    const d = this.deny(ctx, 'ai_booking.confirm'); if (d) return d;
    return this.run(ctx, { op: 'confirm_appointment', confirm: input.confirm, idempotencyKey: input.idempotencyKey }, async () => {
      const row: any = await this.booking.confirm(this.bctx(ctx), appointmentId);
      return { appointmentId: row?.appointmentId ?? appointmentId };
    });
  }
}
