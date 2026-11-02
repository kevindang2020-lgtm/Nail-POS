// ttp-onboarding.controller.ts — SuperAdminGuard-only surface for recording a tenant's Tap to Pay onboarding.
//
// This is the operator switch that flips readiness on: once a Super Admin records Apple entitlement = approved and
// CommerceHub = active for a tenant (and the CommerceHub credentials exist), GET /mobile-checkout/readiness for that
// tenant reports Tap to Pay `ok`. It records STATUS only — never credentials, never a faked charge. Role is enforced
// by SuperAdminGuard (only SUPER_ADMIN reaches these routes); the service re-checks defensively.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { TTP_ONBOARDING_BODY } from '../request-schemas';
import { type Ctx } from '@aipowersalon/permissions';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MobileCheckoutService, AttemptError } from './mobile-checkout.service';
import type { AppleEntitlementStatus, CommerceHubStatus } from './ttp-onboarding';

function ctxFrom(req: any): Ctx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId ?? null, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof AttemptError) {
      const status = e.code === 'forbidden' ? HttpStatus.FORBIDDEN : e.code === 'invalid' ? HttpStatus.BAD_REQUEST : e.code === 'unavailable' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.CONFLICT;
      throw new HttpException({ error: e.code, message: e.message }, status);
    }
    // validateOnboardingInput throws a plain Error on a bad status enum.
    throw new HttpException({ error: 'validation', message: e?.message || 'Invalid onboarding input.' }, HttpStatus.BAD_REQUEST);
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/tap-to-pay')
export class TtpOnboardingAdminController {
  constructor(private readonly svc: MobileCheckoutService) {}

  /** Read a tenant's Tap to Pay onboarding status (Apple entitlement + CommerceHub + whether it flips readiness). */
  @Get('tenants/:tenantId/onboarding')
  get(@Param('tenantId') tenantId: string) {
    return run(() => this.svc.getTapToPayOnboardingForTenant(tenantId));
  }

  /** Record a tenant's onboarding progress — the switch that flips readiness on once the credentials also exist. */
  @Post('tenants/:tenantId/onboarding')
  set(@Req() req: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(TTP_ONBOARDING_BODY, { strict: true })) body: any) {
    return run(() => this.svc.setTapToPayOnboarding(ctxFrom(req), tenantId, {
      appleEntitlementStatus: body?.appleEntitlementStatus as AppleEntitlementStatus,
      commerceHubStatus: (body?.pspEnrollmentStatus ?? body?.commerceHubStatus) as CommerceHubStatus,   // the admin screen sends pspEnrollmentStatus
      notes: typeof body?.notes === 'string' ? body.notes : null,
    }));
  }

  /** A tenant's registered Tap to Pay devices (oversight of the approval lifecycle). */
  @Get('tenants/:tenantId/devices')
  devices(@Param('tenantId') tenantId: string) {
    return run(() => this.svc.listDevices(tenantId));
  }

  /** Approve a registered device → 'active' (it may then take Tap to Pay payments, once the tenant is onboarded). */
  @Post('tenants/:tenantId/devices/:deviceId/approve')
  approveDevice(@Req() req: any, @Param('tenantId') tenantId: string, @Param('deviceId') deviceId: string) {
    return run(() => this.svc.setDeviceStatus(ctxFrom(req), tenantId, deviceId, 'active'));
  }

  /** Revoke a device → 'revoked' (immediately blocks it from taking any further payment). */
  @Post('tenants/:tenantId/devices/:deviceId/revoke')
  revokeDevice(@Req() req: any, @Param('tenantId') tenantId: string, @Param('deviceId') deviceId: string) {
    return run(() => this.svc.setDeviceStatus(ctxFrom(req), tenantId, deviceId, 'revoked'));
  }
}
