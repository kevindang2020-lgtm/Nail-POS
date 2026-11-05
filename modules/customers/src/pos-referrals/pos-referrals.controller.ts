// pos-referrals.controller.ts — tenant salon referral program. Route: pos/referrals.
// Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch server-derived from req.ctx.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { REFERRAL_RECORD_BODY, REFERRAL_REWARD_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
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

  @Post('record') @RequirePermission('pos.marketing.manage')
  record(@Req() r: any, @Body(ValidatedBody(REFERRAL_RECORD_BODY)) b: any) { return run(() => this.svc.record(ctxFrom(r), { code: b?.code, referredCustomerId: b?.referredCustomerId })); }

  @Post(':id/reward') @RequirePermission('pos.marketing.manage')
  reward(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REFERRAL_REWARD_BODY)) b: any) { return run(() => this.svc.reward(ctxFrom(r), id, Number(b?.rewardCents || 0))); }
}
