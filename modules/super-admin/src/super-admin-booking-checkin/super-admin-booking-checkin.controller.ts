// super-admin-booking-checkin.controller.ts — SuperAdminGuard-only platform Booking & Check-In Monitor. All routes are
// read-only monitoring EXCEPT one deliberately-scoped write: POST :id/retry, a controlled, idempotent, audited retry
// of a recorded *failed technical event*. That is an authorized Super Admin action (§28) — it reprocesses a failure,
// it does NOT perform receptionist actions (create appointment, manual check-in, assign technician, reorder queue,
// start/complete service, checkout) and cannot create a booking/check-in itself. The boundary is enforced structurally
// (guard + eligibility/idempotency logic), not merely shown as text.
import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { SuperAdminBookingCheckinService, type AdminCtx } from './super-admin-booking-checkin.service';
import { SuperAdminBookingCheckinControllerListQueries } from './super-admin-booking-checkin.list-queries';
import { BOOKING_RETRY_EVENT_BODY } from '../request-schemas-catalog';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminBookingCheckinControllerListQueries)
@Controller('super-admin/booking-checkin')
export class SuperAdminBookingCheckinController {
  constructor(private readonly svc: SuperAdminBookingCheckinService) {}

  @Get('overview') overview(@Req() r: any, @Query() q: any) {
    return this.svc.getOverview(ctxFrom(r), q || {});
  }

  @Get('failed-events') failedEvents(@Req() r: any, @Query() q: any) {
    return this.svc.getFailedEvents(ctxFrom(r), q || {});
  }

  @Get('devices') devices(@Req() r: any, @Query() q: any) {
    return this.svc.getDevices(ctxFrom(r), q || {});
  }

  @Get('ai-handoffs') aiHandoffs(@Req() r: any, @Query() q: any) {
    return this.svc.getHandoffs(ctxFrom(r), q || {});
  }

  @Get('booking-sources') bookingSources(@Req() r: any, @Query() q: any) {
    return this.svc.getBookingSources(ctxFrom(r), q || {});
  }

  @Get('check-in-performance') checkinPerformance(@Req() r: any, @Query() q: any) {
    return this.svc.getCheckinPerformance(ctxFrom(r), q || {});
  }

  @Get('wait-time-analysis') waitTimeAnalysis(@Req() r: any, @Query() q: any) {
    return this.svc.getWaitTimeAnalysis(ctxFrom(r), q || {});
  }

  /** Server-side, authorized, audited export (§44). CSV real; XLSX/PDF honestly reported as not-yet-available. */
  @AsyncExport({ kind: 'super-admin.booking-checkin.export' }) @Get('export') export(@Req() r: any, @Query() q: any) {
    return this.svc.exportReport(ctxFrom(r), q || {});
  }

  /** Controlled, idempotent, audited retry of a recorded failed event (the only write path; not a receptionist action). */
  @Post('failed-events/:id/retry') async retry(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(BOOKING_RETRY_EVENT_BODY, { strict: true })) body: any) {
    const res = await this.svc.retryFailedEvent(ctxFrom(r), id, body || {});
    if (res.ok) return res;
    if (res.code === 'not_found') throw new NotFoundException(res.message);
    throw new ConflictException({ code: res.code, reason: res.reason, message: res.message });
  }
}
