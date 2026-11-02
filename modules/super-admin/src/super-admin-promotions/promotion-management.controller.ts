import { Controller, Post, Body, Param, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { PromotionManagementService, PromotionManagementError } from './promotion-management.service';
import { PROMO_REASON_BODY, PROMO_TRANSITION_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

async function run<T>(fn: () => Promise<T> | T): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof PromotionManagementError) throw new HttpException(e.message, e.code === 'not_found' ? HttpStatus.NOT_FOUND : e.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Error', HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/promotions')
export class PromotionManagementController {
  constructor(private readonly svc: PromotionManagementService) {}
  @Post(':id/approve') approve(@Param('id') id: string) { return run(() => this.svc.approve(id)); }
  @Post(':id/reject') reject(@Param('id') id: string, @Body(ValidatedBody(PROMO_REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.reject(id, b?.reason)); }
  @Post(':id/disable') disable(@Param('id') id: string, @Body(ValidatedBody(PROMO_REASON_BODY, { strict: true })) b: any) { return run(() => this.svc.disable(id, b?.reason)); }
  @Post(':id/transition') transition(@Param('id') id: string, @Body(ValidatedBody(PROMO_TRANSITION_BODY, { strict: true })) b: any) { return run(() => this.svc.transition(id, b?.status)); }
}
