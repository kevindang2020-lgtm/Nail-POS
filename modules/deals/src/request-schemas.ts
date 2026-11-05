// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the deals module's request-body schemas (deals, coupons, settings, the
// approval decisions, customer estimates, bundles, promotions, salon coupon promotions), applied with
// @Body(ValidatedBody(SCHEMA)). Written from DealsService / BundlesService / PromotionsService / SalonPromotionsService
// (every field read — validateDealInput still checks each value's range) and the clients: pos-web (posDealsApi +
// DealWizard toBody / DealCouponsPanel, posBundlesApi, posSalonPromotionsApi + POSPromotionsScreen), owner-web
// (ownerDealsApi), tech-web (techDealsApi), customer-web (customerApi.dealEstimate). Unknown fields are stripped;
// tenantId / permissions are refused; a deal's `status` (and its money counters) are refused on a deal body — a deal
// moves only through its lifecycle routes (the DEAL machine).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const id: BodySchema = str(64);
const flag: BodySchema = S.nullable(S.boolean());
const int: BodySchema = S.nullable(S.number());
/** a value a handler Number()-coerces (+x / Number(x)) — a number or a numeric string */
const numeric: BodySchema = { type: ['number', 'string', 'null'], maxLength: 20 };
const ids = (max = 100): BodySchema => S.nullable(S.array(S.text(64), { maxItems: max }));
const DEAL_FORBIDDEN = { 'x-forbidden': ['status', 'redemptionCount', 'budgetReservedCents', 'budgetSpentCents', 'approvedByUserId', 'suspendedAt'] } as const;

const deal = {
  ownerType: str(16), branchId: id, technicianId: id, title: str(200), shortDescription: str(1000), terms: str(4000), imageUrl: str(2048),
  discountType: str(16), discountPercent: int, discountCents: int, originalPriceCents: int, serviceIds: ids(),
  startsAt: str(40), endsAt: str(40), newCustomersOnly: flag, memberOnly: flag, minSpendCents: int, depositCents: int,
  maxRedemptions: int, maxPerCustomer: int, stackable: flag, allowTechSubstitution: flag, kind: str(16),
  rules: S.nullable(S.freeObject()), priority: int, stackGroup: str(64), maxDiscountCents: int, budgetCents: int,
  channels: S.nullable(S.array(S.text(32), { maxItems: 10 })), requiresCode: flag, daysOfWeek: S.nullable(S.array(S.number(), { maxItems: 7 })),
  validFromMinute: int, validToMinute: int, bookingLeadMinutes: int, code: str(64),
};
export const DEAL_CREATE_BODY: BodySchema = S.object(deal, [], DEAL_FORBIDDEN);
export const DEAL_UPDATE_BODY: BodySchema = S.object(deal, [], DEAL_FORBIDDEN);
export const DEAL_PREVIEW_BODY: BodySchema = S.object({
  deal: S.nullable(S.object({ ...deal, dealId: id }, [], DEAL_FORBIDDEN)),
  sample: S.nullable(S.object({ serviceIds: ids(), customerId: id, paidVisits: int, isMember: flag, date: str(10), startTime: str(16), channel: str(32), otherOffers: S.nullable(S.array(S.freeObject(), { maxItems: 20 })) })),
});
export const REASON_BODY: BodySchema = S.object({ reason: str(1000) });
export const COUPON_GENERATE_BODY: BodySchema = S.object({
  quantity: numeric, prefix: str(16), singleUse: flag, maxUses: numeric, expiresAt: str(40), customerIds: S.nullable(S.array({ type: ['string', 'number'], maxLength: 64 }, { maxItems: 10000 })), purpose: str(64), campaignId: id,
});
export const DEAL_SETTINGS_BODY: BodySchema = S.object({
  allowTechnicianDeals: str(32), maxDiscountPercent: int, maxFixedDiscountCents: int, minServicePriceCents: int, maxActiveDealsPerTech: int,
  maxRedemptionsCap: int, maxCampaignDurationDays: int, allowedNewCustomer: flag, allowedExistingCustomer: flag, allowStackLoyalty: flag,
  allowStackMembership: flag, editableAfterRedemption: flag, stackingPolicy: str(32), priceFloorPercent: int, maxTotalDiscountPercent: int, dealsEnabled: flag,
});
export const DEAL_ESTIMATE_BODY: BodySchema = S.object({ serviceIds: S.nullable(S.array({ type: ['string', 'number'], maxLength: 64 }, { maxItems: 100 })), date: str(10), startTime: str(16) });
export const DEAL_TENANT_PLATFORM_BODY: BodySchema = S.object({ disabled: flag, reason: str(1000), maxActiveDeals: numeric });
export const TECH_DEAL_BODY: BodySchema = S.object(deal, [], DEAL_FORBIDDEN);

const bundleItem: BodySchema = S.object({ itemType: str(32), refId: id, label: str(200), quantity: int, unitPriceCents: int });
const bundle = { name: str(200), kind: str(32), label: str(200), priceCents: int, status: str(16), onlineBookingEnabled: flag, startsAt: str(40), endsAt: str(40), usageLimit: int, metricNote: str(1000), items: S.nullable(S.array(bundleItem, { maxItems: 100 })) };
/** a bundle's own active / inactive / archived flag is declared (the BUNDLE machine moves it) */
export const BUNDLE_CREATE_BODY: BodySchema = S.object(bundle);
export const BUNDLE_UPDATE_BODY: BodySchema = S.object(bundle);

const money = { eligibleSubtotalCents: numeric };
export const PROMOTION_VALIDATE_BODY: BodySchema = S.object({ promotionId: id, customerId: id, branchId: id, ...money });
export const PROMOTION_REDEEM_BODY: BodySchema = S.object({ promotionId: id, customerId: id, branchId: id, ticketId: id, checkoutId: id, idempotencyKey: str(200), ...money }, [], { 'x-forbidden': ['status', 'discountCents'] });
export const SALON_PROMOTION_CREATE_BODY: BodySchema = S.object({
  code: str(64), name: str(200), discountType: str(16), discountPercent: int, discountCents: int, minPurchaseCents: int, startsAt: str(40), endsAt: str(40), maxRedemptions: int,
}, [], { 'x-forbidden': ['status'] });
/** the coupon promotion's own lifecycle move (SALON_PROMOTION_STATUSES, the DEAL machine) */
export const SALON_PROMOTION_STATUS_BODY: BodySchema = S.object({ status: str(16) });
export const SALON_PROMOTION_REDEEM_BODY: BodySchema = S.object({ code: str(64), subtotalCents: numeric });
