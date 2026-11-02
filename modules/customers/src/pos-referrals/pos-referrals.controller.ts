// pos-referrals.controller.ts — tenant salon referral program (legacy state read). Route: pos/referrals.
// Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch server-derived from req.ctx.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { ReferralsService, ReferralForbiddenError, ReferralValidationError } from './pos-referrals.service';
import type { ReferralsContext } from './pos-referrals.dto';

function ctxFrom(req: any): ReferralsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ReferralForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ReferralValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/referrals')
export class ReferralsController {
  constructor(private readonly svc: ReferralsService) {}

  @Get('state') @RequirePermission('pos.marketing.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  // Referral Program guide (Oct 30 2026): POST record / :id/reward are retired — recording goes through the ONE canonical path in
  // /pos/referral-program/referrals, and a hand-typed "reward paid" toggle is not allowed (rewards are approved + issued once there).
}
