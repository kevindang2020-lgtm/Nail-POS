// booking-verification-override.controller.ts — the manual staff bypass.
//
// `pos.booking.override_verification` — a permission of its own, NOT bundled into a broader booking tier. A
// receptionist who can create appointments must not silently also be able to bypass the fraud control that
// protects them: the receptionist is exactly who a social engineer calls.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { VERIFICATION_OVERRIDE_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Post, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { BookingVerificationOverrideService, OverrideError } from './booking-verification-override.service';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/booking/verification-override')
export class BookingVerificationOverrideController {
  constructor(private readonly svc: BookingVerificationOverrideService) {}

  /** The bookings waiting for a phone code right now (masked numbers only) — what a manager may override. */
  @Get('pending')
  @RequirePermission('pos.booking.verification_pending')
  async pending(@Req() r: any) {
    const c = r?.ctx || {};
    try { return { items: await this.svc.pending({ tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions ?? [] }) }; }
    catch (e: any) { throw toHttp(e); }
  }

  @Post()
  @RequirePermission('pos.booking.override_verification')
  async override(@Req() r: any, @Body(ValidatedBody(VERIFICATION_OVERRIDE_BODY, { strict: true })) b: any) {
    const c = r?.ctx || {};
    try {
      return await this.svc.authorize(
        { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions ?? [] },
        { verificationId: String(b?.verificationId ?? ''), reason: String(b?.reason ?? ''), contactMethod: b?.contactMethod },
      );
    } catch (e: any) { throw toHttp(e); }
  }
}

function toHttp(e: any): any {
  if (!(e instanceof OverrideError)) return e;
  const status = e.code === 'forbidden' ? HttpStatus.FORBIDDEN : e.code === 'not_found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
  return new HttpException({ code: e.code === 'invalid' ? 'VALIDATION_FAILED' : e.code === 'forbidden' ? 'FORBIDDEN' : 'NOT_FOUND', message: e.message }, status);
}
