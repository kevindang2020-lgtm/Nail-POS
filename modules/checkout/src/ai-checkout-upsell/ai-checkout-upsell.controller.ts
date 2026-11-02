// ai-checkout-upsell.controller.ts — tenant POS surface for the AI Checkout Upsell Assistant. Guards:
// TenantAuthGuard + RolePermissionGuard; tenant/branch/role/permissions come from req.ctx (never the body/query). Read
// endpoints return recommendations/context; mutation endpoints require confirm:true + an idempotency key and map the
// service's stable error codes (§80) to HTTP. Payment stays entirely in CheckoutController — nothing here charges a card.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { UPSELL_APPROVAL_BODY, UPSELL_DISMISS_BODY, UPSELL_FEEDBACK_BODY, UPSELL_SETTINGS_BODY } from '../request-schemas';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Put, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { RequiresAiPackage } from '@aipowersalon/ai';
import { AiCheckoutUpsellService, AiCheckoutUpsellForbiddenError } from './ai-checkout-upsell.service';
import type { AiCheckoutUpsellContext } from './ai-checkout-upsell.dto';

function ctxFrom(req: any): AiCheckoutUpsellContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], deviceId: c.deviceId ?? null };
}

// Map the service's stable error taxonomy to HTTP status codes (§80). Anything unknown → 500 without leaking internals.
const STATUS: Record<string, number> = {
  HUMAN_CONFIRMATION_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  CHECKOUT_NOT_FOUND: HttpStatus.NOT_FOUND,
  CHECKOUT_NOT_EDITABLE: HttpStatus.CONFLICT,
  BRANCH_NOT_AUTHORIZED: HttpStatus.FORBIDDEN,
  CUSTOMER_NOT_FOUND: HttpStatus.NOT_FOUND,
  SERVICE_ADDON_INCOMPATIBLE: HttpStatus.CONFLICT,
  ADDON_SCHEDULE_CONFLICT: HttpStatus.CONFLICT,   // Decision 27: the add-on would run into the technician's next appointment
  DUPLICATE_CART_ACTION: HttpStatus.CONFLICT,
  MEMBERSHIP_ALREADY_ACTIVE: HttpStatus.CONFLICT,
  MEMBERSHIP_NOT_ELIGIBLE: HttpStatus.CONFLICT,
  LOYALTY_NOT_ELIGIBLE: HttpStatus.CONFLICT,
  LOYALTY_BALANCE_INSUFFICIENT: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  // §163 run 3 (Oct 27 2026): the service's remaining codes — each was a 500 (INVALID_FEEDBACK on a bad rating)
  INVALID_FEEDBACK: HttpStatus.BAD_REQUEST,
  INVALID_RECOMMENDATION_TRANSITION: HttpStatus.CONFLICT,
  BOOKING_OPEN_NOT_AVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  LOYALTY_ENROLL_NOT_AVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  LOYALTY_REDEEM_NOT_AVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  SETTINGS_NOT_PERSISTED: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof AiCheckoutUpsellForbiddenError) throw new HttpException('INSUFFICIENT_PERMISSION', HttpStatus.FORBIDDEN);
    const code = String(e?.message || 'INTERNAL_ERROR');
    // an error outside the taxonomy goes to the platform filter as it is (a malformed id there is a 400 INVALID_INPUT)
    if (!(code in STATUS)) throw e;
    throw new HttpException(code in STATUS ? code : 'INTERNAL_ERROR', STATUS[code] ?? HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
const approval = (b: any) => ({ confirm: b?.confirm === true, idempotencyKey: String(b?.idempotencyKey || '') });

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// Gated on the tenant's AI subscription. Ships in OBSERVE mode: the call still runs, but a tenant who is
// unsubscribed / expired / over-limit is RECORDED as a would-be denial in ai_usage_logs. Nobody's access
// changes until AI_ENTITLEMENT_ENFORCEMENT=enforce is set deliberately - see ai-entitlement.guard.ts.
@RequiresAiPackage('ai_checkout_upsell_assistant')
@Controller('pos/ai-checkout-upsell')
export class AiCheckoutUpsellController {
  constructor(private readonly svc: AiCheckoutUpsellService) {}

  // ---- read ----
  @Get('checkout/:checkoutId/context') @RequirePermission('pos.ai_checkout_upsell.view')
  context(@Req() r: any, @Param('checkoutId') id: string) { return run(() => this.svc.context(ctxFrom(r), id)); }

  @Get('checkout/:checkoutId/recommendations') @RequirePermission('pos.ai_checkout_upsell.view')
  recommendations(@Req() r: any, @Param('checkoutId') id: string) { return run(() => this.svc.recommendations(ctxFrom(r), id)); }

  // ---- confirmation-gated mutations (each delegates to an existing domain service) ----
  @Post('checkout/:checkoutId/addons/:addOnId/add') @RequirePermission('pos.ai_checkout_upsell.view') /* per-action authority enforced in the service */
  addAddon(@Req() r: any, @Param('checkoutId') id: string, @Param('addOnId') addOnId: string, @Body(ValidatedBody(UPSELL_APPROVAL_BODY, { strict: true })) b: any) {
    return run(() => this.svc.addServiceAddon(ctxFrom(r), id, addOnId, approval(b)));
  }
  @Post('checkout/:checkoutId/membership/:planId/enroll') @RequirePermission('pos.ai_checkout_upsell.view') /* per-action authority enforced in the service */
  enrollMembership(@Req() r: any, @Param('checkoutId') id: string, @Param('planId') planId: string, @Body(ValidatedBody(UPSELL_APPROVAL_BODY, { strict: true })) b: any) {
    return run(() => this.svc.enrollMembership(ctxFrom(r), id, planId, approval(b)));
  }
  @Post('checkout/:checkoutId/loyalty/:rewardId/redeem') @RequirePermission('pos.ai_checkout_upsell.view') /* per-action authority enforced in the service */
  redeemLoyalty(@Req() r: any, @Param('checkoutId') id: string, @Param('rewardId') rewardId: string, @Body(ValidatedBody(UPSELL_APPROVAL_BODY, { strict: true })) b: any) {
    return run(() => this.svc.redeemLoyalty(ctxFrom(r), id, rewardId, approval(b)));
  }
  @Post('checkout/:checkoutId/promotions/:promotionId/apply') @RequirePermission('pos.ai_checkout_upsell.view') /* per-action authority enforced in the service */
  applyPromotion(@Req() r: any, @Param('checkoutId') id: string, @Param('promotionId') promotionId: string, @Body(ValidatedBody(UPSELL_APPROVAL_BODY, { strict: true })) b: any) {
    return run(() => this.svc.applyPromotion(ctxFrom(r), id, promotionId, approval(b)));
  }
  @Post('checkout/:checkoutId/next-appointment/:serviceId') @RequirePermission('pos.ai_checkout_upsell.view') /* per-action authority enforced in the service */
  nextAppointment(@Req() r: any, @Param('checkoutId') id: string, @Param('serviceId') serviceId: string, @Body(ValidatedBody(UPSELL_APPROVAL_BODY, { strict: true })) b: any) {
    return run(() => this.svc.openNextAppointment(ctxFrom(r), id, serviceId, approval(b)));
  }

  // ---- settings (§70) ----
  @Get('settings') @RequirePermission('pos.ai_checkout_upsell.view')
  settings(@Req() r: any) { return run(() => this.svc.getEffectiveSettings(ctxFrom(r))); }
  @Put('settings/:level') @RequirePermission('pos.settings.edit')
  updateSettings(@Req() r: any, @Param('level') level: string, @Body(ValidatedBody(UPSELL_SETTINGS_BODY, { strict: true })) b: any) {
    const lvl = (['tenant', 'branch', 'device', 'user'].includes(level) ? level : 'tenant') as any;
    return run(() => this.svc.updateSettings(ctxFrom(r), lvl, { enabled: b?.enabled, tunables: b?.tunables }));
  }

  // ---- feedback (no charge; metadata only) ----
  @Post('checkout/:checkoutId/dismiss') @RequirePermission('pos.ai_checkout_upsell.view')
  dismiss(@Req() r: any, @Param('checkoutId') id: string, @Body(ValidatedBody(UPSELL_DISMISS_BODY, { strict: true })) b: any) {
    return run(() => this.svc.dismiss(ctxFrom(r), id, String(b?.targetId || ''), String(b?.reason || '')));
  }
  @Post('checkout/:checkoutId/feedback') @RequirePermission('pos.ai_checkout_upsell.view')
  feedback(@Req() r: any, @Param('checkoutId') id: string, @Body(ValidatedBody(UPSELL_FEEDBACK_BODY, { strict: true })) b: any) {
    return run(() => this.svc.recordFeedback(ctxFrom(r), id, String(b?.recommendationId || ''), String(b?.rating || ''), String(b?.reason || '')));
  }
}
