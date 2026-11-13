// checkout-price-preview.controller.ts — SERVICE PRICING 08, Live Price Preview: GET /pos/checkout/price-preview.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / branch from the session (req.ctx), never the client. pos.services.view —
// the Service Pricing screen's own permission. Read only: nothing is charged, reserved, counted or written.
import { ListQuery } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import type { PricePreviewResponse } from '@aipowersalon/api-contracts/tenant';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { CheckoutPricePreview, PricePreviewError, type PricePreviewCtx } from './checkout-price-preview';

export const CHECKOUT_PRICE_PREVIEW = 'CheckoutPricePreview';
const PREVIEW = { filters: { serviceId: { type: 'id' }, addOns: { type: 'text', maxLength: 400 }, priceCents: { type: 'text', maxLength: 10 } }, search: false } as const;
function ctxFrom(req: any): PricePreviewCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId ?? null, role: c.role ?? null, permissions: c.permissions || [] };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/checkout')
export class CheckoutPricePreviewController {
  constructor(@Inject(CHECKOUT_PRICE_PREVIEW) private readonly pp: CheckoutPricePreview | null) {}

  /** how a service (+ add-ons, at its price or a proposed one) would ring up for a walk-in: deals, tax, total — nothing charged */
  @Get('price-preview') @RequirePermission('pos.services.view') @ListQuery(PREVIEW)
  async pricePreview(@Req() req: any, @Query() q: any): Promise<PricePreviewResponse> {
    const c = ctxFrom(req);
    if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED');
    if (!this.pp) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The price preview needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);
    try { return await this.pp.preview(c, { serviceId: q?.serviceId, addOns: q?.addOns, priceCents: q?.priceCents }); }
    catch (e) { if (e instanceof PricePreviewError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
  }
}
