// loyalty.controller.ts — GET /pos/loyalty/state. Guards: TenantAuthGuard + RolePermissionGuard.
// Tenant/branch server-derived from req.ctx. Gate is a customer-view capability.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { REWARD_BODY } from './request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { LoyaltyService, ForbiddenError, NotFoundError, RewardValidationError } from './loyalty.service';
import type { LoyaltyContext } from './loyalty.dto';

function ctxFrom(req: any): LoyaltyContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof NotFoundError) throw new HttpException({ message: e.message }, HttpStatus.NOT_FOUND);
    if (e instanceof RewardValidationError) throw new HttpException({ code: 'VALIDATION_ERROR', message: e.message }, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('loyalty')   // BUILD_PLAN Phase 12 (#13): plan-gated — observe by default (feature-entitlement.ts)
@Controller('pos/loyalty')
export class LoyaltyController {
  constructor(private readonly svc: LoyaltyService) {}

  @Get('state') @RequirePermission('pos.customers.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  // Decision 15: the rewards catalog (owners / managers).
  @Post('rewards') @RequirePermission('pos.settings.edit')
  createReward(@Req() r: any, @Body(ValidatedBody(REWARD_BODY, { strict: true })) b: any) { return run(() => this.svc.createReward(ctxFrom(r), rewardBody(b))); }
  @Patch('rewards/:rewardId') @RequirePermission('pos.settings.edit')
  updateReward(@Req() r: any, @Param('rewardId') id: string, @Body(ValidatedBody(REWARD_BODY, { strict: true })) b: any) { return run(() => this.svc.updateReward(ctxFrom(r), id, rewardBody(b))); }
}

/** Only the reward fields pass through; anything else in the body is ignored. */
function rewardBody(b: any) {
  const o = b || {};
  return { title: o.title, description: o.description, pointsCost: o.pointsCost, rewardType: o.rewardType, valueCents: o.valueCents, percent: o.percent, validDays: o.validDays, active: o.active };
}
