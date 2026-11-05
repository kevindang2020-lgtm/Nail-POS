// salon-promotions.controller.ts — tenant salon promotions. DISTINCT route: pos/salon-promotions.
// Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch server-derived from req.ctx.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { SALON_PROMOTION_CREATE_BODY, SALON_PROMOTION_REDEEM_BODY, SALON_PROMOTION_STATUS_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SalonPromotionsService, SalonPromotionForbiddenError, SalonPromotionValidationError } from './salon-promotions.service';
import type { SalonPromotionsContext } from './salon-promotions.dto';

function ctxFrom(req: any): SalonPromotionsContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof SalonPromotionForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof SalonPromotionValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/salon-promotions')
export class SalonPromotionsController {
  constructor(private readonly svc: SalonPromotionsService) {}

  @Get('state') @RequirePermission('pos.marketing.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  @Post() @RequirePermission('pos.marketing.manage')
  create(@Req() r: any, @Body(ValidatedBody(SALON_PROMOTION_CREATE_BODY)) b: any) { return run(() => this.svc.create(ctxFrom(r), b || {})); }

  @Post(':id/status') @RequirePermission('pos.marketing.manage')
  setStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SALON_PROMOTION_STATUS_BODY)) b: any) { return run(() => this.svc.setStatus(ctxFrom(r), id, b?.status)); }

  @Post('redeem') @RequirePermission('pos.marketing.manage')
  redeem(@Req() r: any, @Body(ValidatedBody(SALON_PROMOTION_REDEEM_BODY)) b: any) { return run(() => this.svc.redeem(ctxFrom(r), b?.code, Number(b?.subtotalCents || 0))); }
}
