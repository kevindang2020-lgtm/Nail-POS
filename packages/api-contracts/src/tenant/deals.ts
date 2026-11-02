// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type DealStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'active'
  | 'paused' | 'sold_out' | 'expired' | 'rejected' | 'canceled' | 'archived';

export interface DealView {
  id: string;
  tenantId: string;
  branchId: string | null;
  ownerType: DealOwnerType;
  technicianId: string | null;
  title: string;
  shortDescription: string | null;
  terms: string | null;
  imageUrl: string | null;
  discountType: DiscountType;
  discountPercent: number | null;
  discountCents: number | null;
  originalPriceCents: number | null;
  finalPriceCents: number | null;
  savingsCents: number | null;
  serviceIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  newCustomersOnly: boolean;
  memberOnly: boolean;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  stackable: boolean;
  allowTechSubstitution: boolean;
  status: DealStatus;
  redemptionCount: number;
  version: number;
  createdAt: string;
  // BUILD_PLAN Phase 5 (deals_engine) — one domain for deals, coupons, automatic promotions and announcements
  kind?: DealKind;
  rules?: Record<string, unknown> | null;
  priority?: number;
  stackGroup?: string | null;
  maxDiscountCents?: number | null;
  budgetCents?: number | null;
  budgetReservedCents?: number;
  channels?: string[] | null;
  requiresCode?: boolean;
  daysOfWeek?: number[] | null;
  validFromMinute?: number | null;
  validToMinute?: number | null;
  minSpendCents?: number | null;
  bookingLeadMinutes?: number | null;
  suspendedReason?: string | null;
  suspendedAt?: string | null;
  publishedAt?: string | null;
  /** Deals & Offers guide §9: who created it and who approved it (self-approval of a technician proposal is refused). */
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
}

export type DealKind = 'deal' | 'coupon' | 'automatic' | 'announcement';
export type StackingPolicyMode = 'best_single' | 'stack_all' | 'stack_groups' | 'exclusive';

export interface DealSettings {
  allowTechnicianDeals: TechDealPolicy;
  maxDiscountPercent: number | null;
  maxFixedDiscountCents: number | null;
  minServicePriceCents: number | null;
  maxActiveDealsPerTech: number | null;
  maxRedemptionsCap: number | null;
  maxCampaignDurationDays: number | null;
  allowedNewCustomer: boolean;
  allowedExistingCustomer: boolean;
  // BUILD_PLAN Phase 5: these columns existed since migration 387 and nothing read them (bug 19) — now enforced
  allowStackLoyalty?: boolean;
  allowStackMembership?: boolean;
  editableAfterRedemption?: boolean;
  stackingPolicy?: StackingPolicyMode;
  priceFloorPercent?: number;
  maxTotalDiscountPercent?: number | null;
  dealsEnabled?: boolean;
  /** read-only: the platform's switches and limits for this salon */
  platformDisabled?: boolean;
  platformDisabledReason?: string | null;
  platformMaxActiveDeals?: number | null;
}

export interface DealAnalyticsRow { dealId: string; title: string; status: string; views: number; saves: number; bookingStarts: number; bookings: number; redemptions: number; discountedCents: number; }

export type DealOwnerType = 'salon' | 'technician';

export type DiscountType = 'percent' | 'fixed' | 'fixed_price';

export type TechDealPolicy = 'off' | 'on_with_approval' | 'on_auto';

// ── BUILD_PLAN Phase 5: the checkout deals panel (GET /pos/checkout/tickets/:id/offers — DealsCheckoutService.panel) ──
/** Why a deal can't be used — `code` is the deals engine's reason vocabulary (rule_*, sold_out, code_used, …). */
/** V-5 (Oct 27 2026): `params` hold the variable parts (days 0–6, fromMinute / toMinute, cents, count, max, minutes, sinceDays). */
export interface OfferReason { code: string; message: string; params?: Record<string, number | string | number[]> }
/** A deal or coupon the customer could use on this ticket, with what it would take off HERE (estimatedCents). */
export interface OfferSummary {
  dealId: string; title: string; kind: string; discountType: string; discountPercent: number | null; discountCents: number | null;
  estimatedCents: number; booked?: boolean; couponId?: string | null; codeHint?: string | null; endsAt: string | null; terms: string | null;
}
export interface TicketOffers {
  available: boolean;
  applied: { redemptionId: string; dealId: string; kind: string; status: string; discountCents: number; title: string }[];
  eligible: OfferSummary[];
  notEligible: (OfferSummary & { reasons: OfferReason[] })[];
  best: { dealIds: string[]; add: { dealId: string; couponId: string | null }[]; savingsCents: number; currentCents: number; better: boolean } | null;
  policy?: { mode: string };
}
