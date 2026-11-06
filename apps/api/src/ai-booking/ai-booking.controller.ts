// ai-booking.controller.ts — versioned ai_booking API. Tenant/branch/user/role/permissions come ONLY from req.ctx
// (TenantAuthGuard); the booking source comes from the request but is validated against the catalog. No tenant/branch is
// ever read from the body. Stage 1 exposes the read-orchestration + context + conversion surfaces; mutation routes
// (create/reschedule/cancel/confirm) reuse the Copilot action spine and land next.
import { Controller, Get, Post, Param, Body, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { RequiresAiPackage } from '@aipowersalon/ai';
import { ValidationError as BookingValidationError } from '@aipowersalon/booking';
import { TenantAuthGuard, ValidatedBody, ResourceScope } from '@aipowersalon/permissions/guards';
import { AiBookingService } from './ai-booking.service';
import { AiBookingMutationService } from './ai-booking-mutation.service';
import { AiBookingConversionService, type FunnelStage } from './ai-booking-conversion.service';
import { resolveTrustedContext, AiBookingError, type ServerDerivedCtx } from './ai-booking-context';
import { AIB_CANCEL_BODY, AIB_CONFIRM_BODY, AIB_CONTEXT_BODY, AIB_CONVERSION_BODY, AIB_CREATE_BODY, AIB_RESCHEDULE_BODY, AIB_SEARCH_BODY } from './request-schemas';

function serverCtx(r: any): ServerDerivedCtx {
  const c = r?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [], supportSessionId: c.supportSessionId ?? null };
}
function trusted(r: any, source: unknown, correlationId?: string) {
  try { return resolveTrustedContext(serverCtx(r), source, correlationId); }
  catch (e) { if (e instanceof AiBookingError) throw new HttpException({ code: e.code, message: e.message }, HttpStatus.BAD_REQUEST); throw e; }
}

@UseGuards(TenantAuthGuard)
// Gated on the tenant's AI subscription. Ships in OBSERVE mode: the call still runs, but a tenant who is
// unsubscribed / expired / over-limit is RECORDED as a would-be denial in ai_usage_logs. Nobody's access
// changes until AI_ENTITLEMENT_ENFORCEMENT=enforce is set deliberately - see ai-entitlement.guard.ts.
@RequiresAiPackage('ai_booking_assistant')
@ResourceScope('BRANCH')   // §38: bookings at the session's location; ai_booking.* + the booking engine's pos.booking.* checks run in the services
@Controller('api/ai-booking/v1')
export class AiBookingController {
  constructor(private readonly svc: AiBookingService, private readonly conversion: AiBookingConversionService, private readonly mutation: AiBookingMutationService) {}

  /** Echo back the trusted context the server resolved (never what the client asked for) — useful for every channel. */
  @Post('context') context(@Req() r: any, @Body(ValidatedBody(AIB_CONTEXT_BODY, { strict: true })) b: any) {
    const ctx = trusted(r, b?.source, b?.correlationId);
    return { tenantId: ctx.tenantId, branchId: ctx.branchId, source: ctx.source, role: ctx.role, correlationId: ctx.correlationId };
  }

  @Post('availability/search') search(@Req() r: any, @Body(ValidatedBody(AIB_SEARCH_BODY, { strict: true })) b: any) {
    const ctx = trusted(r, b?.source, b?.correlationId);
    return this.svc.searchAvailability(ctx, { date: b?.date, serviceIds: b?.serviceIds, technicianId: b?.technicianId });
  }

  @Post('recommendations') recommend(@Req() r: any, @Body(ValidatedBody(AIB_SEARCH_BODY, { strict: true })) b: any) {
    const ctx = trusted(r, b?.source, b?.correlationId);
    return this.svc.recommendOptions(ctx, { date: b?.date, serviceIds: b?.serviceIds, technicianId: b?.technicianId });
  }

  // ── Mutations (Stage 2): confirm-gated, idempotent, source-stamped, delegated to the authoritative BookingService ──
  @Post('appointments') create(@Req() r: any, @Body(ValidatedBody(AIB_CREATE_BODY, { strict: true })) b: any) {
    const ctx = trusted(r, b?.source, b?.correlationId);
    return this.mutation.createAppointment(ctx, { customerName: b?.customerName, customerId: b?.customerId, customerPhone: b?.customerPhone, serviceIds: b?.serviceIds, date: b?.date, startTime: b?.startTime, technicianId: b?.technicianId, notes: b?.notes, confirm: b?.confirm, idempotencyKey: b?.idempotencyKey });
  }
  @Post('appointments/:appointmentId/reschedule') reschedule(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(AIB_RESCHEDULE_BODY, { strict: true })) b: any) {
    const ctx = trusted(r, b?.source, b?.correlationId);
    return this.mutation.rescheduleAppointment(ctx, id, { startTime: b?.startTime, date: b?.date, technicianId: b?.technicianId, confirm: b?.confirm, idempotencyKey: b?.idempotencyKey });
  }
  @Post('appointments/:appointmentId/cancel') cancel(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(AIB_CANCEL_BODY, { strict: true })) b: any) {
    const ctx = trusted(r, b?.source, b?.correlationId);
    if (!b?.reason?.trim()) throw new HttpException({ code: 'VALIDATION_ERROR', message: 'reason is required' }, HttpStatus.BAD_REQUEST);
    return this.mutation.cancelAppointment(ctx, id, { reason: b.reason, confirm: b?.confirm, idempotencyKey: b?.idempotencyKey });
  }

  @Post('appointments/:appointmentId/confirm') confirm(@Req() r: any, @Param('appointmentId') id: string, @Body(ValidatedBody(AIB_CONFIRM_BODY, { strict: true })) b: any) {
    const ctx = trusted(r, b?.source, b?.correlationId);
    return this.mutation.confirmAppointment(ctx, id, { confirm: b?.confirm, idempotencyKey: b?.idempotencyKey });
  }

  @Get('appointments/:appointmentId') getAppointment(@Req() r: any, @Param('appointmentId') id: string) {
    const ctx = trusted(r, r?.query?.source ?? 'FRONT_DESK_POS');
    // Phase 14 (live IDOR run): BookingService answers another salon's id (tenant-filtered) with "Booking not found" —
    // that is a 404, not a 500
    return Promise.resolve(this.svc.getAppointment(ctx, id)).catch((e) => {
      if (e instanceof BookingValidationError && /not found/i.test(e.message)) throw new HttpException({ code: 'RESOURCE_NOT_FOUND', message: e.message }, HttpStatus.NOT_FOUND);
      throw e;
    });
  }

  @Post('conversion-events') conversionEvent(@Req() r: any, @Body(ValidatedBody(AIB_CONVERSION_BODY, { strict: true })) b: any) {
    const ctx = trusted(r, b?.source, b?.correlationId);
    if (!b?.stage) throw new HttpException({ code: 'VALIDATION_ERROR', message: 'stage is required' }, HttpStatus.BAD_REQUEST);
    return this.conversion.record(ctx, { stage: b.stage as FunnelStage, outcome: b?.outcome, failureReason: b?.failureReason, appointmentId: b?.appointmentId }).then(() => ({ recorded: true }));
  }

  @Get('conversion/summary') summary(@Req() r: any) {
    const c = serverCtx(r);
    if (!c.tenantId) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'No context' }, HttpStatus.FORBIDDEN);
    return this.conversion.summary({ tenantId: c.tenantId });
  }

  @Get('conversion/metrics') metrics(@Req() r: any) {
    const c = serverCtx(r);
    if (!c.tenantId) throw new HttpException({ code: 'PERMISSION_DENIED', message: 'No context' }, HttpStatus.FORBIDDEN);
    return this.conversion.metrics({ tenantId: c.tenantId });
  }
}
