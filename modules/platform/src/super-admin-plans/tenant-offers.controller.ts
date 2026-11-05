// tenant-offers.controller.ts — Super Admin tenant offers surface (under SuperAdminGuard). All mutations are
// permission-gated in the service and audited.
import { Controller, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { TenantOffersService, OffersForbiddenError, OffersNotFoundError, OffersConflictError, OffersValidationError, type OffersActor } from './tenant-offers.service';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ADD_ON_BODY, ADD_ON_CANCEL_BODY, PROMOTION_BODY, TRIAL_BODY } from '../request-schemas';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans/tenants/:tenantId/offers')
export class TenantOffersController {
  constructor(private readonly svc: TenantOffersService) {}

  private actor(req: any): OffersActor { return { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] }; }
  private wrap(e: any): never {
    if (e instanceof OffersForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof OffersNotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    if (e instanceof OffersConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    if (e instanceof OffersValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw new HttpException(e?.message || 'Offer action failed', HttpStatus.BAD_REQUEST);
  }

  @Post('add-ons')
  async assignAddOn(@Param('tenantId') tenantId: string, @Body(ValidatedBody(ADD_ON_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.assignAddOn(this.actor(req), tenantId, String(body?.addOnCode || ''), body?.quantity, body?.priceCents); } catch (e) { this.wrap(e); }
  }
  @Post('add-ons/cancel')
  async cancelAddOn(@Param('tenantId') tenantId: string, @Body(ValidatedBody(ADD_ON_CANCEL_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.cancelAddOn(this.actor(req), tenantId, String(body?.addOnCode || '')); } catch (e) { this.wrap(e); }
  }
  @Post('trials')
  async startTrial(@Param('tenantId') tenantId: string, @Body(ValidatedBody(TRIAL_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.startTrial(this.actor(req), tenantId, String(body?.trialCode || '')); } catch (e) { this.wrap(e); }
  }
  @Post('promotions')
  async applyPromotion(@Param('tenantId') tenantId: string, @Body(ValidatedBody(PROMOTION_BODY)) body: any, @Req() req: any) {
    try { return await this.svc.applyPromotion(this.actor(req), tenantId, String(body?.promoCode || '')); } catch (e) { this.wrap(e); }
  }
}
