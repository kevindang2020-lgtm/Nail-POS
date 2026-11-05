// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the checkout module's request-body schemas (money first), applied
// with @Body(ValidatedBody(SCHEMA)). Written from each handler + CheckoutService method (the fields actually read) and
// from pos-web (posCheckoutApi + POSCheckoutScreen, TicketRefundPanel, POSSellGiftCardScreen, CustomerDisplayCard,
// POSServiceDoneScreen) — every body sent today passes. Money is integer cents ≥ 0; a `status` on a money body is
// refused (x-forbidden), never silently dropped; unknown fields are stripped.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
/** integer cents ≥ 0, or null (an empty amount field serialises NaN → null; the service answers it) */
const cents: BodySchema = S.nullable(S.integer({ minimum: 0 }));
const bool: BodySchema = S.nullable(S.boolean());
const MONEY: BodySchema['x-forbidden'] = ['status', 'state', 'paymentStatus', 'capturedCents', 'refundedCents', 'approvedAmountCents'];
const money = (props: Record<string, BodySchema>): BodySchema => S.object(props, [], { 'x-forbidden': MONEY });

export const RATING_BODY: BodySchema = S.object({ rating: { type: ['number', 'string', 'null'], maxLength: 4 } });
export const SEND_TO_DISPLAY_BODY: BodySchema = S.object({ stationId: str(64), deviceId: str(64) });
export const MOVE_TICKET_BODY: BodySchema = S.object({ registerId: scalar(64) });
export const SET_TIP_BODY: BodySchema = money({ tipType: str(16), tipPercent: S.nullable(S.number({ minimum: 0, maximum: 100 })), tipAmountCents: cents, source: str(32) });
export const APPLY_DISCOUNT_BODY: BodySchema = money({ discountCents: S.nullable(S.number()), reason: str(500), managerPin: scalar(32) });
export const PROMO_CODE_BODY: BodySchema = S.object({ code: scalar(64) });
export const APPLY_OFFER_BODY: BodySchema = S.object({ dealId: str(64), code: str(64), couponId: str(64), fromAppointment: bool });
export const RECALCULATE_BODY: BodySchema = S.object({ paymentMethod: str(20) });
export const REOPEN_SERVICE_BODY: BodySchema = S.object({ reason: scalar(1000), managerPin: scalar(32) });
export const PAY_CASH_BODY: BodySchema = money({ amountReceivedCents: cents, tipCents: cents, lockedTotalCents: cents });
export const PAY_CARD_BODY: BodySchema = money({ tipCents: cents, lockedTotalCents: cents, idempotencyKey: str(128), cardToken: str(4096), expiry: str(10), terminalId: str(64) });
export const PAY_GIFT_CARD_BODY: BodySchema = money({ giftCardCode: scalar(64), pin: scalar(16), tipCents: cents, lockedTotalCents: cents });
export const PAY_SPLIT_BODY: BodySchema = money({
  segments: S.nullable(S.array(S.object({ method: str(20), amountCents: cents, giftCardCode: scalar(64), pin: scalar(16), terminalId: str(64) }, [], { 'x-forbidden': MONEY }), { maxItems: 20 })),
  tipCents: cents, cardToken: str(4096), expiry: str(10), terminalId: str(64),
});
export const ISSUE_GIFT_CARD_BODY: BodySchema = money({ amountCents: cents, code: scalar(64), customerId: str(64), idempotencyKey: str(128) });
export const GIFT_CARD_SALE_BODY: BodySchema = money({
  amountCents: cents, customerId: str(64), cardNumber: scalar(64), pin: scalar(16),
  recipient: S.nullable(S.object({ name: str(200), phone: str(40), email: str(254), message: str(1000) })),
});
export const GIFT_CARD_RELOAD_BODY: BodySchema = money({ code: scalar(64), amountCents: cents });
export const GIFT_CARD_INPUT_BODY: BodySchema = S.object({ input: scalar(64), number: scalar(64), code: scalar(64) });
export const RELOAD_GIFT_CODE_BODY: BodySchema = money({ amountCents: cents });
export const RECEIPT_SEND_ALL_BODY: BodySchema = S.object({ channels: S.nullable(S.array(S.text(10), { maxItems: 4 })) });
export const TICKET_REFUND_BODY: BodySchema = money({ reason: scalar(1000), amountCents: cents, managerPin: scalar(32), serviceLineIds: S.nullable(S.array(scalar(64), { maxItems: 200 })), tipRefunded: bool });
export const PAYMENT_REFUND_BODY: BodySchema = TICKET_REFUND_BODY;
export const PAYMENT_VOID_BODY: BodySchema = money({ reason: scalar(1000), managerPin: scalar(32) });
export const DISPLAY_SESSION_CREATE_BODY: BodySchema = S.object({ ticketId: scalar(64), deviceId: str(64) });
export const DISPLAY_SESSION_UPDATE_BODY: BodySchema = S.object({ state: str(32), selectedTipCents: cents, expiresAt: str(40) });

// ── cash drawer (pos-web posCashDrawerApi) — amounts are Number()-coerced by the service, so a numeric string passes ──
const amount: BodySchema = { type: ['integer', 'string', 'null'], maxLength: 16 };
const drawer = (props: Record<string, BodySchema>): BodySchema => S.object({ ...props, date: str(10), registerId: str(64) }, [], { 'x-forbidden': MONEY });
export const DRAWER_OPEN_BODY: BodySchema = drawer({ openingFloatCents: amount });
export const DRAWER_RECONCILE_BODY: BodySchema = drawer({ countedCents: amount, notes: str(2000) });
export const DRAWER_MOVEMENT_BODY: BodySchema = drawer({ direction: str(8), amountCents: amount, reason: str(500), note: str(2000) });
export const DRAWER_VOID_MOVEMENT_BODY: BodySchema = drawer({ movementId: scalar(64) });

// ── Manager Pay / Tap to Pay (manager-pay-web mobileCheckoutApi) ───────────────────────────────────────────────────
export const MC_REGISTER_DEVICE_BODY: BodySchema = S.object({ deviceId: scalar(200), label: str(200), platform: str(32), osVersion: str(64), appVersion: str(64), tapToPayCapable: { type: ['boolean', 'string', 'number', 'null'], maxLength: 10 } });
export const MC_ADD_RETAIL_BODY: BodySchema = S.object({ productId: scalar(64), quantity: S.nullable(S.number({ minimum: 0 })) });
export const MC_DISCOUNT_BODY: BodySchema = money({ discountCents: S.nullable(S.number()), reason: str(500), managerPin: scalar(32) });
export const MC_LOCK_BODY: BodySchema = S.object({ sessionId: scalar(200), deviceId: str(200), reason: str(200) });
const segmentPlan: BodySchema = S.object({ amountCents: S.nullable(S.number()), method: str(20) }, [], { 'x-forbidden': MONEY });
export const MC_PROCEED_BODY: BodySchema = money({
  sessionId: scalar(200), deviceId: str(200), expectedVersion: str(64),
  tip: S.nullable({ anyOf: [S.enumOf(['none', 'p15', 'p20', 'p25']), S.object({ customCents: S.nullable(S.number()) })] }),
  segments: S.nullable(S.array(segmentPlan, { maxItems: 20 })),
});
export const MC_CREATE_ATTEMPT_BODY: BodySchema = money({ sessionId: scalar(200), idempotencyKey: scalar(200), amountCents: { type: ['number', 'string', 'null'], maxLength: 16 }, deviceId: str(200), expectedVersion: str(64) });
// Owner & Manager Payment App mandate (wave 3 / TTP): cash tender of a split (§83–§84), claim takeover (§46), device revoke / reassign (§138, §17), heartbeat (§149)
export const MC_CASH_TENDER_BODY: BodySchema = money({ sessionId: scalar(200), idempotencyKey: scalar(200), amountCents: cents, deviceId: str(200) });
export const MC_TAKEOVER_BODY: BodySchema = S.object({ sessionId: scalar(200), deviceId: str(200), reason: scalar(500) });
export const MC_DEVICE_STATUS_BODY: BodySchema = S.object({ reason: str(500) });
export const MC_DEVICE_REBIND_BODY: BodySchema = S.object({ userId: scalar(64) });
export const MC_HEARTBEAT_BODY: BodySchema = S.object({ deviceId: scalar(200), appVersion: str(64) });
export const MC_VERIFY_BODY: BodySchema = S.object({ deviceId: str(200) });
export const MC_REFUND_PAYMENT_BODY: BodySchema = money({ reason: scalar(1000), amountCents: cents, serviceLineIds: S.nullable(S.array(scalar(64), { maxItems: 200 })), tipRefunded: bool });
export const MC_REFUND_TICKET_BODY: BodySchema = money({ reason: scalar(1000), amountCents: cents });
export const MC_VOID_BODY: BodySchema = money({ reason: scalar(1000) });
export const MC_DEVICE_BODY: BodySchema = S.object({ deviceId: str(200) });
/** the native capture result: outcome is clamped by the handler; capturedAmountCents is the processor's figure */
export const MC_CAPTURE_RESULT_BODY: BodySchema = S.object({ outcome: str(16), processorRef: str(200), authCode: str(64), brand: str(32), last4: scalar(4), capturedAmountCents: S.nullable(S.number()) }, [], { 'x-forbidden': ['status', 'state'] });
export const MC_RECONCILE_BODY: BodySchema = S.object({ resolution: str(16), processorRef: str(200), brand: str(32), last4: scalar(4), capturedAmountCents: S.nullable(S.number()) }, [], { 'x-forbidden': ['status', 'state'] });
export const MC_RECEIPT_BODY: BodySchema = S.object({ channel: str(8), destination: str(100) });

// ── Phase 12 round 2: AI checkout upsell (pos-web posAiCheckoutUpsellApi), Tap-to-Pay onboarding (admin-web), skip-the-
// line checkout (customer-web skipLineApi, pos-web + admin-web settings, tech-web cash report) ─────────────────────────
const flag: BodySchema = S.nullable(S.boolean());
const intOrNull: BodySchema = S.nullable(S.number());
/** an AI suggestion is applied only with an explicit confirm + an idempotency key (the handler reads nothing else) */
export const UPSELL_APPROVAL_BODY: BodySchema = money({ confirm: { type: ['boolean', 'string', 'null'], maxLength: 8 }, idempotencyKey: str(200) });
export const UPSELL_DISMISS_BODY: BodySchema = S.object({ targetId: scalar(64), reason: scalar(500) });
export const UPSELL_FEEDBACK_BODY: BodySchema = S.object({ recommendationId: scalar(64), rating: scalar(16), reason: scalar(500) });
export const UPSELL_SETTINGS_BODY: BodySchema = S.object({
  enabled: flag,
  tunables: S.nullable(S.object({
    maxTotal: intOrNull, maxAddOn: intOrNull, maxProduct: intOrNull, maxMembership: intOrNull, addOnsEnabled: flag, productsEnabled: flag,
    membershipEnabled: flag, loyaltyEnrollEnabled: flag, loyaltyRedeemEnabled: flag, giftCardEnabled: flag, rebookingEnabled: flag,
    maxAddedValueCents: intOrNull, maxAddedPercent: intOrNull, allowAfterServiceDone: flag,
  })),
});
/** the platform's record of the two onboarding states — the TTP_* machines move them */
export const TTP_ONBOARDING_BODY: BodySchema = S.object({ appleEntitlementStatus: str(16), commerceHubStatus: str(16), pspEnrollmentStatus: str(16), notes: str(2000) });   // pspEnrollmentStatus = the admin screen's name for commerceHubStatus
/** a customer-app payment: the method + tip; the confirm carries the processor TOKEN (CardSecure) — never a raw card
 *  number (the service refuses one with looksLikeRawPan); `amountCents` / `status` are refused (the server prices it) */
const SKIP_FORBIDDEN = { 'x-forbidden': ['status', 'amountCents', 'totalCents', 'paid', 'cardNumber', 'pan', 'cvv'] } as const;
export const SKIP_START_BODY: BodySchema = S.object({ method: str(20), tipCents: cents }, [], SKIP_FORBIDDEN);
export const SKIP_CONFIRM_BODY: BodySchema = S.object({ intentId: str(64), method: str(20), token: str(4096), account: str(4096), paymentMethodId: str(200), expiry: str(10), tipCents: cents }, [], SKIP_FORBIDDEN);
export const SKIP_SETTINGS_BODY: BodySchema = S.object({
  featureEnabled: flag, autoSendPromptOnServiceDone: flag, requireFrontDeskApproval: flag, allowCashToTechnician: flag,
  requireTechConfirmationForCash: flag, managerApprovalOverCents: cents,
});
export const TECH_CASH_NOT_PAID_BODY: BodySchema = S.object({ notes: str(2000) });
