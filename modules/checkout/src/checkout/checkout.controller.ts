// checkout.controller.ts — tenant POS Checkout & Payment HTTP surface.
// Two controllers: `/pos/checkout/*` and `/pos/customer-display/*`. Guards: TenantAuthGuard + RolePermissionGuard.
// tenant/branch/role from req.ctx. Pay/refund/void routes carry base perms; method-specific perms are enforced in the service.
import type { UnsettledTender, GiftCardAdjustResult } from '@aipowersalon/api-contracts/tenant';
import { Idempotent } from '@aipowersalon/database/nest';   // Constitution 5 §61–66
import { CodeLookupLimited, bodyHasCode, splitHasGiftCardCode } from '@aipowersalon/security/nest';   // Phase 14 (Constitution 12): per-caller lookup-by-code limit
import { DealRefusedError } from '@aipowersalon/deals';
import { recordConflict } from '@aipowersalon/observability';
import { ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';   // wave 3 PAYI §134
import { CheckoutInProgressError, CustomerDisplayError, DisplayBusyError, PaymentInProgressError } from './checkout.dto';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { CheckoutService, ForbiddenError, ValidationError } from './checkout.service';
import type { CheckoutContext } from './checkout.repository';
import type { CheckoutFilters } from './checkout.dto';
import type { PaymentMethod } from './checkout-display.dto';
import { ListQueries } from '@aipowersalon/database';
import { CheckoutControllerListQueries } from './checkout.list-queries';

import { APPLY_DISCOUNT_BODY, APPLY_OFFER_BODY, DISPLAY_SESSION_CREATE_BODY, DISPLAY_SESSION_UPDATE_BODY, GIFT_CARD_INPUT_BODY, GIFT_CARD_ADJUST_BODY, GIFT_CARD_RELOAD_BODY, GIFT_CARD_SALE_BODY, ISSUE_GIFT_CARD_BODY, MOVE_TICKET_BODY, PAYMENT_REFUND_BODY, PAYMENT_VOID_BODY, PAY_CARD_BODY, PAY_CASH_BODY, PAY_GIFT_CARD_BODY, PAY_REWARDS_BODY, EMPTY_REWARDS_BODY, PAY_SPLIT_BODY, PROMO_CODE_BODY, RATING_BODY, RECALCULATE_BODY, RECEIPT_SEND_ALL_BODY, REFUND_SETTLE_BODY, REOPEN_SERVICE_BODY, SEND_TO_DISPLAY_BODY, SET_TIP_BODY, TICKET_REFUND_BODY, GIFT_CARD_ISSUE_BODY, GIFT_CARD_SCREEN_RELOAD_BODY, GIFT_CARD_VOID_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): CheckoutContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): CheckoutFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { search: q.search, status: q.status, station: q.station, technicianId: q.technicianId, paymentMethod: q.paymentMethod, page: n(q.page), pageSize: n(q.pageSize) }; }
/** a rewards-network refusal (GlobalRewardsError from modules/loyalty, recognised by name — checkout never imports loyalty) */
function asRewardsRefusal(e: unknown): { message: string; code: keyof typeof ERROR_REGISTRY; details?: Record<string, unknown> } | null {
  if (!(e instanceof Error) || e.name !== 'GlobalRewardsError') return null;
  const c = (e as Error & { code?: unknown; details?: Record<string, unknown> });
  return typeof c.code === 'string' && isRegisteredCode(c.code) ? { message: e.message, code: c.code as keyof typeof ERROR_REGISTRY, details: c.details } : null;
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof PaymentInProgressError) { recordConflict('checkout', e.code); throw new HttpException({ message: e.message, code: e.code, serverTime: new Date().toISOString() }, HttpStatus.CONFLICT); }
    if (e instanceof CheckoutInProgressError) { recordConflict('checkout', e.code); throw new HttpException({ message: e.message, code: e.code, serverTime: new Date().toISOString() }, HttpStatus.CONFLICT); }   // spec §76
    if (e instanceof DisplayBusyError) { recordConflict('checkout', e.code); throw new HttpException({ message: e.message, code: e.code, busyState: e.busyState }, HttpStatus.CONFLICT); }   // spec §85–§86
    if (e instanceof CustomerDisplayError) throw new HttpException({ message: e.message, code: e.code, ...(e.reason ? { reason: e.reason } : {}) }, e.status);   // Dual-Screen §104
    if (e instanceof ValidationError) {
      // V-5 (Oct 27 2026): a refusal with its own registry code keeps the specific English sentence and adds the code + params
      if (e.code && isRegisteredCode(e.code)) throw new HttpException({ message: e.message, code: e.code, ...(e.params ? { details: e.params } : {}) }, ERROR_REGISTRY[e.code].status);
      // wave 3 PAYI §134–135: a refusal thrown AS a taxonomy code (TERMINAL_BUSY, PAYMENT_ALREADY_COMPLETED, …) answers
      // with the registry's status + sentence and the code, so the register shows the right words, not the bare code
      if (isRegisteredCode(e.message)) {
        const def = ERROR_REGISTRY[e.message];
        if (def.status === 409) recordConflict('checkout', e.message);
        throw new HttpException({ message: def.message, code: e.message }, def.status);
      }
      throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    }
    // BUILD_PLAN Phase 5: a deal/coupon refusal carries its status (400 not for this ticket, 409 not now, 429 too many
    // wrong codes) and EVERY reason, so the POS can show "why not"
    if (e instanceof DealRefusedError) throw new HttpException({ message: e.message, code: e.code, reasons: e.reasons }, e.status);
    // Global Loyalty (Oct 30 2026): a rewards-network refusal from the hold port (not enough points, not opted in, …) keeps
    // its registry code — checkout never imports loyalty, so it is recognised by name + a registered code
    const gr = asRewardsRefusal(e);
    if (gr) throw new HttpException({ message: gr.message, code: gr.code, details: gr.details ?? {} }, ERROR_REGISTRY[gr.code].status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(CheckoutControllerListQueries)
@Controller('pos/checkout')
export class CheckoutController {
  constructor(private readonly svc: CheckoutService) {}

  @Get('state') @RequirePermission('pos.checkout.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get('kpis') @RequirePermission('pos.checkout.view') kpis(@Req() r: any) { return run(() => this.svc.getKpis(ctxFrom(r))); }
  @Get('settings') @RequirePermission('pos.checkout.view') settings(@Req() r: any) { return run(() => this.svc.getSettings(ctxFrom(r))); }
  @Get('tickets') @RequirePermission('pos.checkout.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.tickets(ctxFrom(r), filtersFrom(q))); }
  @Get('tickets/:ticketId') @RequirePermission('pos.checkout.view') detail(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }
  @Get('tickets/:ticketId/signature') @RequirePermission('pos.checkout.view') signature(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.getPaymentSignature(ctxFrom(r), id)); }
  // Technician-split review preview (spec §13) — per-tech earnings + tip allocation; POS shows it when >2 techs participate.
  @Get('tickets/:ticketId/technician-split') @RequirePermission('pos.checkout.view') techSplit(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.technicianSplit(ctxFrom(r), id)); }
  @Get('tickets/:ticketId/tip-selection') @RequirePermission('pos.checkout.view') tipSelection(@Req() r: any, @Param('ticketId') id: string) { return run(async () => ({ selection: await this.svc.tipSelection(ctxFrom(r), id) })); }   // G4: the customer's per-technician tips, live

  @Post('tickets/:ticketId/review') @RequirePermission('pos.checkout.view') review(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.review(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/rating') @RequirePermission('pos.checkout.view') rating(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(RATING_BODY, { strict: true })) b: any) { return run(() => this.svc.recordSatisfaction(ctxFrom(r), id, Number(b?.rating))); }
  // 23-inch spec §9–§11, §82: body { stationId?: this POS's register, deviceId?: Switch Display — exactly that display }
  @Post('tickets/:ticketId/send-to-customer-display') @RequirePermission('pos.customer_display.operate') send(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(SEND_TO_DISPLAY_BODY, { strict: true })) b: any) { return run(() => this.svc.sendToCustomerDisplay(ctxFrom(r), id, { stationId: typeof b?.stationId === 'string' ? b.stationId : null, deviceId: typeof b?.deviceId === 'string' ? b.deviceId : null })); }
  // Oct 6 2026: Hold Ticket / Resume / Move to Front Desk (body { registerId: one of this branch's registers }) — they used to only show a message
  @Post('tickets/:ticketId/hold') @RequirePermission('pos.checkout.take_payment') hold(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.holdTicket(ctxFrom(r), id, true)); }
  @Post('tickets/:ticketId/resume') @RequirePermission('pos.checkout.take_payment') resume(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.holdTicket(ctxFrom(r), id, false)); }
  @Post('tickets/:ticketId/move') @RequirePermission('pos.checkout.take_payment') move(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(MOVE_TICKET_BODY, { strict: true })) b: any) { return run(() => this.svc.moveToRegister(ctxFrom(r), id, b?.registerId)); }
  @Post('tickets/:ticketId/apply-tip') @RequirePermission('pos.checkout.add_tip') tip(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(SET_TIP_BODY, { strict: true })) b: any) { return run(() => this.svc.applyTip(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/apply-discount') @RequirePermission('pos.checkout.apply_discount') discount(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(APPLY_DISCOUNT_BODY, { strict: true })) b: any) { return run(() => this.svc.applyDiscount(ctxFrom(r), id, b)); }
  // BUILD_PLAN Phase 5 — deals and coupons: the front desk's key (pos.deals.apply → deals.apply), not the manager's
  // manual-discount key (bug 2). Both legacy routes now go through the deals engine.
  @CodeLookupLimited('coupon') @Post('tickets/:ticketId/apply-promotion') @RequirePermission('pos.deals.apply') applyPromotion(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(PROMO_CODE_BODY, { strict: true })) b: any) { return run(() => this.svc.applyPromotion(ctxFrom(r), id, String(b?.code || ''))); }
  @Post('tickets/:ticketId/apply-deal') @RequirePermission('pos.deals.apply') applyDeal(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.applyDeal(ctxFrom(r), id)); }
  @Get('tickets/:ticketId/offers') @RequirePermission('pos.checkout.view') offers(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.ticketOffers(ctxFrom(r), id)); }
  @CodeLookupLimited('coupon', { when: bodyHasCode('code') }) @Post('tickets/:ticketId/offers') @RequirePermission('pos.deals.apply') applyOffer(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(APPLY_OFFER_BODY, { strict: true })) b: any) {
    return run(() => this.svc.applyOffer(ctxFrom(r), id, { dealId: typeof b?.dealId === 'string' ? b.dealId : null, code: typeof b?.code === 'string' ? b.code : null, couponId: typeof b?.couponId === 'string' ? b.couponId : null, fromAppointment: b?.fromAppointment === true, source: 'pos' }));
  }
  @Post('tickets/:ticketId/offers/best') @RequirePermission('pos.deals.apply') applyBest(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.applyBestOffers(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/offers/:redemptionId/remove') @RequirePermission('pos.deals.apply') removeOffer(@Req() r: any, @Param('ticketId') id: string, @Param('redemptionId') rid: string) { return run(() => this.svc.removeOffer(ctxFrom(r), id, rid)); }
  @Post('tickets/:ticketId/recalculate') @RequirePermission('pos.checkout.view') recalc(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(RECALCULATE_BODY, { strict: true })) b: any) { return run(() => this.svc.recalculate(ctxFrom(r), id, b?.paymentMethod as PaymentMethod)); }
  @Post('tickets/:ticketId/reopen-service') @RequirePermission('pos.checkout.reopen_service') reopen(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(REOPEN_SERVICE_BODY, { strict: true })) b: any) { return run(() => this.svc.reopen(ctxFrom(r), id, b)); }

  @Idempotent() @Post('tickets/:ticketId/pay/cash') @RequirePermission('pos.checkout.take_payment') payCash(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(PAY_CASH_BODY, { strict: true })) b: any) { return run(() => this.svc.payCash(ctxFrom(r), id, b)); }
  @Post('tickets/:ticketId/pay/card') @RequirePermission('pos.checkout.take_payment') payCard(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(PAY_CARD_BODY, { strict: true })) b: any) { return run(() => this.svc.payCard(ctxFrom(r), id, b)); }
  // Functional Decision 22: ask the processor what happened to a charge whose answer was lost — never re-charges or voids.
  @Get('tickets/:ticketId/unsettled-tenders') @RequirePermission('pos.checkout.view') unsettledTenders(@Req() r: any, @Param('ticketId') id: string): Promise<UnsettledTender[]> { return run(() => this.svc.unsettledTenders(ctxFrom(r), id)); }   // B-81
  @Post('tickets/:ticketId/pay/card/verify') @RequirePermission('pos.checkout.take_payment') verifyCard(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.verifyCardPayment(ctxFrom(r), id)); }
  // Global Loyalty (Final Completion guide §04): use AI PowerSalon Rewards points as one tender. The hold commits with its
  // tender row; the paid-ticket event finalizes it; removing it (unpaid ticket only) releases the points.
  @Get('tickets/:ticketId/rewards') @RequirePermission('pos.checkout.view') rewardsQuote(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.rewardsQuote(ctxFrom(r), id)); }
  @Idempotent({ required: true }) @Post('tickets/:ticketId/pay/rewards') @RequirePermission('pos.checkout.take_payment') payRewards(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(PAY_REWARDS_BODY, { strict: true })) b: any) { return run(() => this.svc.payGlobalReward(ctxFrom(r), id, { blocks: Number(b?.blocks), idempotencyKey: String(r?.headers?.['idempotency-key'] ?? '') })); }
  @Post('tickets/:ticketId/rewards/remove') @RequirePermission('pos.checkout.take_payment') removeRewards(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(EMPTY_REWARDS_BODY, { strict: true })) _b: any) { return run(() => this.svc.removeGlobalReward(ctxFrom(r), id)); }
  @CodeLookupLimited('gift_card') @Idempotent() @Post('tickets/:ticketId/pay/gift-card') @RequirePermission('pos.checkout.take_payment') payGift(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(PAY_GIFT_CARD_BODY, { strict: true })) b: any) { return run(() => this.svc.payGiftCard(ctxFrom(r), id, b)); }
  // Oct 28 2026 (Platform Architecture mandate audit, §142 / §226 — the same defect as B-02): this route minted an ACTIVE
  // card with its full balance and no payment, no ticket, no step-up — under a permission the front desk holds — and wrote
  // the card and its ledger row outside one transaction. No app called it (UNUSED_ROUTE_INVENTORY). Retired, like the
  // direct reload before it: a gift card is sold payment-first (POST tickets/:ticketId/gift-card-sale, activated when the
  // ticket is paid). The route stays declared (validated body, manifest) and answers 410 ENDPOINT_RETIRED.
  @Post('gift-cards') @RequirePermission('pos.checkout.gift_card_issue') issueGift(@Req() _r: any, @Body(ValidatedBody(ISSUE_GIFT_CARD_BODY, { strict: true })) _b: any): never {
    throw new HttpException({ code: 'ENDPOINT_RETIRED', message: 'Issuing a gift card without a payment has been retired. Sell it on a ticket (gift-card sale): it is activated when the ticket is paid.' }, HttpStatus.GONE);
  }
  @Post('tickets/:ticketId/gift-card-sale') @RequirePermission('pos.checkout.gift_card_issue') giftSale(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(GIFT_CARD_SALE_BODY, { strict: true })) b: any) { return run(() => this.svc.createGiftCardSale(ctxFrom(r), id, b)); }
  @CodeLookupLimited('gift_card') @Post('tickets/:ticketId/gift-card-reload') @RequirePermission('pos.checkout.gift_card_issue') giftReload(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(GIFT_CARD_RELOAD_BODY, { strict: true })) b: any) { return run(() => this.svc.createGiftCardReload(ctxFrom(r), id, b)); }
  @CodeLookupLimited('gift_card') @Post('gift-cards/lookup') @RequirePermission('pos.checkout.gift_card_payment') giftLookup(@Req() r: any, @Body(ValidatedBody(GIFT_CARD_INPUT_BODY, { strict: true })) b: any) { return run(() => this.svc.giftCardLookup(ctxFrom(r), b?.input ?? b?.number ?? b?.code ?? '')); }
  @CodeLookupLimited('gift_card') @Post('gift-cards/replace') @RequirePermission('pos.checkout.gift_card_payment') giftReplace(@Req() r: any, @Body(ValidatedBody(GIFT_CARD_INPUT_BODY, { strict: true })) b: any) { return run(() => this.svc.replaceGiftCard(ctxFrom(r), b?.input ?? b?.number ?? b?.code ?? '')); }
  @CodeLookupLimited('gift_card') @Get('gift-cards/:code') @RequirePermission('pos.checkout.gift_card_payment') giftBalance(@Req() r: any, @Param('code') code: string) { return run(() => this.svc.giftCardBalance(ctxFrom(r), code)); }
  // Mandate P0 §142 (Oct 20 2026): the direct `POST gift-cards/:code/reload` route was REMOVED — it credited stored value with
  // no payment, no idempotency and a ledger row written outside the transaction. The one reload path is payment-first:
  // `tickets/:ticketId/gift-card-reload` (a hold on the ticket, credited by afterPaid exactly once).
  // Gift Cards mandate §15 (Oct 29 2026): the void-by-code route (front-desk permission, no reason, no step-up, the redeemable
  // code in the URL) is retired — no app called it. A card is voided from the Gift Cards screen by id, with a reason, by a
  // manager (pos.checkout.void), step-up: POST gift-cards/:cardId/void-card. The route stays declared and answers 410.
  @CodeLookupLimited('gift_card') @Idempotent() @Post('gift-cards/:code/void') @RequirePermission('pos.checkout.gift_card_issue') voidGift(@Req() _r: any, @Param('code') _code: string): never {
    throw new HttpException({ code: 'ENDPOINT_RETIRED', message: 'Void a gift card from the Gift Cards screen (by card, with a reason).' }, HttpStatus.GONE);
  }
  // Gift Cards mandate §11 / §15: the Gift Cards screen's payment-first Issue and Reload (each opens its own ticket, paid at
  // Checkout; idempotent by request key) and the reasoned manager void.
  @Idempotent() @Post('gift-cards/issue') @RequirePermission('pos.checkout.gift_card_issue') issueFromScreen(@Req() r: any, @Body(ValidatedBody(GIFT_CARD_ISSUE_BODY, { strict: true })) b: any) { return run(() => this.svc.issueGiftCardFromScreen(ctxFrom(r), b)); }
  @Idempotent() @Post('gift-cards/:cardId/reload-ticket') @RequirePermission('pos.checkout.gift_card_issue') reloadFromScreen(@Req() r: any, @Param('cardId') id: string, @Body(ValidatedBody(GIFT_CARD_SCREEN_RELOAD_BODY, { strict: true })) b: any) { return run(() => this.svc.reloadGiftCardFromScreen(ctxFrom(r), id, b)); }
  @Idempotent() @RequireStepUp() @Post('gift-cards/:cardId/adjust') @RequirePermission('pos.checkout.void') adjustFromScreen(@Req() r: any, @Param('cardId') id: string, @Body(ValidatedBody(GIFT_CARD_ADJUST_BODY, { strict: true })) b: any): Promise<GiftCardAdjustResult> { return run(() => this.svc.adjustGiftCardFromScreen(ctxFrom(r), id, b?.amountCents, b?.reason)); }
  @Idempotent() @RequireStepUp() @Post('gift-cards/:cardId/void-card') @RequirePermission('pos.checkout.void') voidFromScreen(@Req() r: any, @Param('cardId') id: string, @Body(ValidatedBody(GIFT_CARD_VOID_BODY, { strict: true })) b: any) { return run(() => this.svc.voidGiftCardFromScreen(ctxFrom(r), id, b?.reason)); }
  @CodeLookupLimited('gift_card', { when: splitHasGiftCardCode }) @Idempotent() @Post('tickets/:ticketId/pay/split') @RequirePermission('pos.checkout.take_payment') paySplit(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(PAY_SPLIT_BODY, { strict: true })) b: any) { return run(() => this.svc.paySplit(ctxFrom(r), id, b)); }

  @Post('tickets/:ticketId/receipt/sms') @RequirePermission('pos.receipts.send') rcptSms(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.receiptSms(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/receipt/email') @RequirePermission('pos.receipts.send') rcptEmail(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.receiptEmail(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/receipt/app') @RequirePermission('pos.receipts.send') rcptApp(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.receiptApp(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/receipt/send-all') @RequirePermission('pos.receipts.send') rcptAll(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(RECEIPT_SEND_ALL_BODY, { strict: true })) b: any) { return run(() => this.svc.receiptSendAll(ctxFrom(r), id, b)); }

  // Functional Decision 20 on the POS (Oct 2 2026 — the POS had no refund screen; only Manager Pay could split a refund):
  // preview how an amount splits across the ticket's original payments, then refund it (cards first, stops at the first
  // tender that does not complete). GET is read-only and named so the CSRF guard (no mutation-named GET) holds.
  @Get('tickets/:ticketId/refund-preview') @RequirePermission('pos.checkout.refund') previewRefundSplit(@Req() r: any, @Param('ticketId') id: string, @Query('amountCents') amountCents: string) { return run(() => this.svc.refundAllocationPreview(ctxFrom(r), id, Number(amountCents))); }
  // Security Deep Scan C7: server-enforced step-up
  @Idempotent() @RequireStepUp() @Post('tickets/:ticketId/refund') @RequirePermission('pos.checkout.refund') refundTicket(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(TICKET_REFUND_BODY, { strict: true })) b: any) { return run(() => this.svc.refundTicket(ctxFrom(r), id, { reason: b?.reason, amountCents: b?.amountCents, managerPin: b?.managerPin, serviceLineIds: Array.isArray(b?.serviceLineIds) ? b.serviceLineIds.map(String).slice(0, 50) : undefined, tipRefunded: b?.tipRefunded === true })); }
  // Mandate P0 §228 (Oct 20 2026): a refund whose processor answer was lost waits in 'processing'; the sweep settles it from the
  // processor's record, or — when it cannot decide — a manager does, here, with the processor portal open (step-up, note).
  @Get('tickets/:ticketId/refunds/unsettled') @RequirePermission('pos.checkout.view') unsettledRefunds(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.unsettledRefunds(ctxFrom(r), id)); }
  @Idempotent() @RequireStepUp() @Post('tickets/:ticketId/refunds/:refundId/settle') @RequirePermission('pos.checkout.refund') settleRefund(@Req() r: any, @Param('ticketId') id: string, @Param('refundId') refundId: string, @Body(ValidatedBody(REFUND_SETTLE_BODY, { strict: true })) b: any) { return run(() => this.svc.settleUnknownRefundManually(ctxFrom(r), id, refundId, { outcome: b?.outcome, processorRefundId: b?.processorRefundId, note: b?.note })); }
  // Decision 15 loyalty step: a customer's reward code on the ticket (whoever takes payment).
  @CodeLookupLimited('reward_code') @Post('tickets/:ticketId/reward-code') @RequirePermission('pos.checkout.redeem_reward') applyRewardCode(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(PROMO_CODE_BODY, { strict: true })) b: any) { return run(() => this.svc.applyRewardCode(ctxFrom(r), id, b?.code)); }
  @Post('tickets/:ticketId/reward-code/remove') @RequirePermission('pos.checkout.redeem_reward') removeRewardCode(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.removeRewardCode(ctxFrom(r), id)); }
  // Security Deep Scan C7: server-enforced step-up
  @Idempotent() @RequireStepUp() @Post('payments/:paymentId/refund') @RequirePermission('pos.checkout.refund') refund(@Req() r: any, @Param('paymentId') pid: string, @Body(ValidatedBody(PAYMENT_REFUND_BODY, { strict: true })) b: any) { return run(() => this.svc.refund(ctxFrom(r), pid, b)); }
  @Idempotent() @RequireStepUp() @Post('payments/:paymentId/void') @RequirePermission('pos.checkout.void') void(@Req() r: any, @Param('paymentId') pid: string, @Body(ValidatedBody(PAYMENT_VOID_BODY, { strict: true })) b: any) { return run(() => this.svc.void(ctxFrom(r), pid, b)); }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-display')
export class POSCustomerDisplayController {
  constructor(private readonly svc: CheckoutService) {}
  // 23-inch spec §82: operating the display is front-desk work (pos.customer_display.operate → the checkout capability)
  @Get('devices') @RequirePermission('pos.customer_display.operate') devices(@Req() r: any) { return run(() => this.svc.devices(ctxFrom(r))); }
  @Post('sessions') @RequirePermission('pos.customer_display.operate') create(@Req() r: any, @Body(ValidatedBody(DISPLAY_SESSION_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createSession(ctxFrom(r), b?.ticketId, b?.deviceId)); }
  @Patch('sessions/:sessionId') @RequirePermission('pos.customer_display.operate') update(@Req() r: any, @Param('sessionId') sid: string, @Body(ValidatedBody(DISPLAY_SESSION_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.updateSession(ctxFrom(r), sid, b)); }
  @Post('sessions/:sessionId/close') @RequirePermission('pos.customer_display.operate') close(@Req() r: any, @Param('sessionId') sid: string) { return run(() => this.svc.closeSession(ctxFrom(r), sid)); }
}
