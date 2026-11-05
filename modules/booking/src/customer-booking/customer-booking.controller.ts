// customer-booking.controller.ts — customer self-booking HTTP surface (/customer/booking). Derives the customer from
// the session (no ids from the client). GET options lists bookable services + technicians; POST creates the booking.
import { sealBookingSession } from './booking-session-token';
import { Controller, Get, Post, Body, Param, Query, Req, HttpException, HttpStatus } from '@nestjs/common';
import { CustomerBookingService, NotCustomerError, BookingValidationError, BookingConflictError, PhoneVerificationRequiredError, PhoneVerificationUnavailableError, SalonUnavailableError } from './customer-booking.service';
import type { CustomerBookingContext } from './customer-booking.repository';
import { ListQueries } from '@aipowersalon/database';
import { Idempotent } from '@aipowersalon/database/nest';   // BUILD_PLAN Phase 13: a retried booking create never books twice
import { CustomerBookingControllerListQueries } from './customer-booking.list-queries';

import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CUSTOMER_BOOK_BODY, CUSTOMER_RESCHEDULE_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): CustomerBookingContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId };
}

@ListQueries(CustomerBookingControllerListQueries)
@Controller('customer/booking')
export class CustomerBookingController {
  constructor(private readonly svc: CustomerBookingService) {}

  @Get('options')
  options(@Req() r: any, @Query('salonId') salonId?: string) { return this.svc.getOptions(ctxFrom(r), salonId); }

  @Get('availability')
  async availability(@Req() r: any, @Query('serviceId') serviceId: string, @Query('date') date: string, @Query('technicianId') technicianId?: string, @Query('salonId') salonId?: string) {
    try {
      return await this.svc.availability(ctxFrom(r), { serviceId, date, technicianId, salonId });
    } catch (e: any) {
      if (e instanceof NotCustomerError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      if (e instanceof BookingValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }

  @Post() @Idempotent()
  async book(@Req() r: any, @Body(ValidatedBody(CUSTOMER_BOOK_BODY)) body: any) {
    try {
      return await this.svc.book(ctxFrom(r), body ?? {});
    } catch (e: any) {
      // 428 Precondition Required — the appointment was NOT created; prove the phone, then retry. The payload
      // carries ONLY a booking session id and a MASKED phone. Never the full number (the spec forbids echoing
      // it back once a code has been sent) and never anything about the code itself.
      // Constitution 7 §19 — suspended / closed salon: 409, nothing created
      if (e instanceof SalonUnavailableError) throw new HttpException({ code: 'salon_unavailable', message: e.message }, HttpStatus.CONFLICT);
      if (e instanceof PhoneVerificationRequiredError) {
        // Constitution 3 Step 10c: the session leaves as a token signed for this salon and this customer (or none at all)
        const c = r?.ctx || {};
        const token = e.bookingSessionId ? sealBookingSession(e.bookingSessionId, { tenantId: String(c.tenantId ?? ''), customerId: c.customerId ?? c.userId ?? null }) : '';
        throw new HttpException(
          { code: 'phone_verification_required', message: e.message, bookingSessionId: token, maskedPhone: e.maskedPhone, reason: e.policyReason, holdExpiresAt: e.holdExpiresAt ? new Date(e.holdExpiresAt).toISOString() : null },
          HttpStatus.PRECONDITION_REQUIRED,
        );
      }
      // 503 — verification is required and we cannot perform it. The booking is REFUSED rather than quietly
      // let through, which would switch the feature off during exactly the incident it exists for. The message
      // comes from the policy and never mentions Twilio.
      if (e instanceof PhoneVerificationUnavailableError) {
        throw new HttpException(
          { code: 'phone_verification_unavailable', message: e.message, reason: e.policyReason },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (e instanceof NotCustomerError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      if (e instanceof BookingConflictError) {
        let freshAvailability: any = null;
        try {
          const b = r?.body;
          const sid = b?.serviceId || (b?.services && b.services[0]?.serviceId);
          if (b?.date && sid) {
            freshAvailability = await this.svc.availability(ctxFrom(r), {
              serviceId: sid,
              date: b.date,
              technicianId: b.technicianId || undefined,
              salonId: b.branchId || ctxFrom(r).branchId,
            });
          }
        } catch { /* best-effort */ }
        throw new HttpException({
          code: 'APPOINTMENT_CONFLICT',
          message: e.message,
          conflictingAppointmentId: e.conflictingAppointmentId,
          freshAvailability: freshAvailability ?? undefined,
        }, HttpStatus.CONFLICT);
      }
      if (e instanceof BookingValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }

  @Post('appointments/:id/reschedule')
  async reschedule(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(CUSTOMER_RESCHEDULE_BODY)) body: any) {
    try {
      return await this.svc.reschedule(ctxFrom(r), id, body ?? {});
    } catch (e: any) {
      if (e instanceof SalonUnavailableError) throw new HttpException({ code: 'salon_unavailable', message: e.message }, HttpStatus.CONFLICT);
      if (e instanceof NotCustomerError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      if (e instanceof BookingConflictError) {
        let freshAvailability: any = null;
        try {
          if (body?.date) {
            freshAvailability = await this.svc.availability(ctxFrom(r), {
              date: body.date,
              salonId: r?.ctx?.branchId,
            });
          }
        } catch { /* best-effort */ }
        throw new HttpException({
          code: 'APPOINTMENT_CONFLICT',
          message: e.message,
          conflictingAppointmentId: e.conflictingAppointmentId,
          freshAvailability: freshAvailability ?? undefined,
        }, HttpStatus.CONFLICT);
      }
      if (e instanceof BookingValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }
}
