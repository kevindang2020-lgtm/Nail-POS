import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { PROMOTION_REDEEM_BODY, PROMOTION_VALIDATE_BODY, REASON_BODY } from '../request-schemas';
import { Controller, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PromotionsService, PromotionError } from './promotions.service';

function ctxFrom(r: any): { tenantId: string; branchId?: string | null } { return { tenantId: r?.ctx?.tenantId || r?.tenantId, branchId: r?.ctx?.branchId ?? null }; }
async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof PromotionError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'ineligible' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly svc: PromotionsService) {}
  @Post('validate') @RequirePermission('pos.checkout.apply_discount') validate(@Req() r: any, @Body(ValidatedBody(PROMOTION_VALIDATE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.validate(ctxFrom(r), { promotionId: b?.promotionId, customerId: b?.customerId, branchId: b?.branchId, eligibleSubtotalCents: +b?.eligibleSubtotalCents || 0 }));
  }
  @Post('redeem') @RequirePermission('pos.checkout.apply_discount') redeem(@Req() r: any, @Body(ValidatedBody(PROMOTION_REDEEM_BODY, { strict: true })) b: any) {
    return run(() => this.svc.redeem(ctxFrom(r), { promotionId: b?.promotionId, customerId: b?.customerId, branchId: b?.branchId, ticketId: b?.ticketId, checkoutId: b?.checkoutId, eligibleSubtotalCents: +b?.eligibleSubtotalCents || 0, idempotencyKey: b?.idempotencyKey }));
  }
  @Post('redemptions/:id/reverse') @RequirePermission('pos.checkout.apply_discount') reverse(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REASON_BODY, { strict: true })) b: any) {
    return run(() => this.svc.reverse(ctxFrom(r), id, b?.reason));
  }
}
