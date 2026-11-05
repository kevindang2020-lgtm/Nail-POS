// booking-verification-oversight.controller.ts — Super Admin: Booking Verification Oversight.
//
// Behind SuperAdminGuard. Nothing here can return a verification code, a Twilio credential, or a full customer
// phone number -- not because the controller filters them out, but because the service never has them: codes are
// held by Twilio, tokens are encrypted at rest and never decrypted on this path, and phones are stored hashed
// with only a mask for display. A privacy guarantee that depends on a controller remembering to strip a field is
// not a guarantee.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { VERIFICATION_EMERGENCY_BODY, VERIFICATION_MODULE_BODY, VERIFICATION_TENANT_POLICY_BODY } from '../request-schemas';
import { Body, Controller, Get, HttpException, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequireStepUp } from '@aipowersalon/permissions/guards';
import { BookingVerificationOversightService, OversightError } from './booking-verification-oversight.service';
import { ListQueries } from '@aipowersalon/database';
import { BookingVerificationOversightControllerListQueries } from './booking-verification-oversight.list-queries';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof OversightError) {
      throw new HttpException({ code: e.code, message: e.message }, e.code === 'not_found' ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST);
    }
    throw e;
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(BookingVerificationOversightControllerListQueries)
@Controller('super-admin/booking-verification')
export class BookingVerificationOversightController {
  constructor(private readonly svc: BookingVerificationOversightService) {}

  @Get('policy')
  policy() { return run(() => this.svc.platformPolicy()); }

  @Get('tenants')
  tenants(@Query('limit') limit?: string) { return run(() => this.svc.tenants(Math.min(500, Number(limit) || 200))); }

  @Get('health')
  health(@Query('hours') hours?: string) { return run(() => this.svc.health(Math.min(720, Number(hours) || 24))); }

  /**
   * The GLOBAL kill switch.
   *
   * It disables VERIFICATION, not BOOKING. If it stopped bookings, the button meant to protect tenants from a
   * verification outage would instead take every salon on the platform offline -- the most destructive possible
   * reading of "emergency disable".
   */
  @RequireStepUp()   // Constitution 7 §34: kill switches need step-up — the booking verification emergency switch
  @Post('emergency-disable')
  emergency(@Req() r: any, @Body(ValidatedBody(VERIFICATION_EMERGENCY_BODY)) b: any) {
    return run(() => this.svc.setEmergencyDisabled(r?.ctx?.userId, b?.disabled !== false, String(b?.reason ?? '')));
  }

  /** Phase 4: the module itself, platform-wide. Step-up, and a reason. */
  @RequireStepUp()
  @Post('module')
  module(@Req() r: any, @Body(ValidatedBody(VERIFICATION_MODULE_BODY)) b: any) {
    return run(() => this.svc.setModuleEnabled(r?.ctx?.userId, b?.enabled !== false, String(b?.reason ?? '')));
  }

  /** Force verification on at one tenant, or forbid it; forbid its managers' override. Each needs a reason -- the tenant WILL ask why. */
  @Patch('tenants/:tenantId')
  tenantPolicy(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(VERIFICATION_TENANT_POLICY_BODY)) b: any) {
    return run(() => this.svc.setTenantPolicy(r?.ctx?.userId, tenantId, { required: !!b?.required, blocked: !!b?.blocked, reason: b?.reason, bypassBlocked: typeof b?.bypassBlocked === 'boolean' ? b.bypassBlocked : undefined }));
  }
}
