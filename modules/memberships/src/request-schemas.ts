// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the memberships module's request-body schemas (plans + versions,
// enrollment, benefit reserve / release / redeem, cancel / pause / resume, renewal reminders, the internal billing
// runner), applied with @Body(ValidatedBody(SCHEMA)). Written from MembershipsService / MembershipEnrollService /
// MembershipBillingService and pos-web (posMembershipsApi, posMembershipEnrollApi). Unknown fields are stripped;
// tenantId / permissions are refused; a membership `status` is refused on the staff routes (it moves only through the
// CUSTOMER_MEMBERSHIP machine). The internal billing runner's `status` IS the processor's renewal result — declared there.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const id: BodySchema = str(64);
const flag: BodySchema = S.nullable(S.boolean());
const int: BodySchema = S.nullable(S.number());
/** a value the handler Number()-coerces */
const numeric: BodySchema = { type: ['number', 'string', 'null'], maxLength: 20 };
const MEMBERSHIP_FORBIDDEN = { 'x-forbidden': ['status', 'balanceCents', 'creditsUsed'] } as const;
const obj = (props: Record<string, BodySchema>): BodySchema => S.object(props, [], MEMBERSHIP_FORBIDDEN);

export const PLAN_CREATE_BODY: BodySchema = obj({ name: str(200), planCode: str(64), productType: str(32), description: str(4000), badge: str(64), isPopular: flag, isFeatured: flag, memberVisible: flag, branchId: id });
const benefit: BodySchema = S.object({
  benefitType: str(32), label: str(200), serviceId: id, categorySnapshot: str(200), creditsPerCycle: numeric, valueCents: numeric, percent: numeric,
  allocatedValueCents: numeric, minDaysBetween: numeric, maxPerCycle: numeric, rolloverAllowed: flag, sortOrder: numeric,
});
export const PLAN_VERSION_BODY: BodySchema = obj({
  billingInterval: str(16), intervalCount: numeric, priceCents: numeric, isCustomPricing: flag, enrollmentFeeCents: numeric, setupFeeCents: numeric, trialDays: numeric,
  autoRenew: flag, billingCycles: numeric, termType: str(16), termDays: numeric, rolloverAllowed: flag, rolloverMaxCycles: numeric, creditExpiryDays: numeric,
  techCommissionBasis: str(32), techSplitPct: numeric, ownerSplitPct: numeric, techFixedCents: numeric, allocationTiming: str(32), cancellationPolicy: str(64),
  minCommitmentCycles: numeric, pauseMaxPerYear: numeric, pauseMaxDays: numeric, termsVersion: str(64), autoRenewDisclosure: str(4000), estMarginCents: numeric,
  benefits: S.nullable(S.array(benefit, { maxItems: 50 })),
});
export const ENROLL_BODY: BodySchema = obj({ customerId: id, planId: id, planVersionId: id, assignedTechnicianId: id, autoRenewConsent: flag, agreementVersion: str(64), channel: str(32) });
export const MEMBERS_BY_CUSTOMERS_BODY: BodySchema = S.object({ customerIds: S.nullable(S.array(S.text(64), { maxItems: 500 })) });
export const RESERVE_BODY: BodySchema = obj({ membershipId: id, benefitId: id, ticketId: id, quantity: int });
export const RELEASE_BODY: BodySchema = obj({ reservationRef: str(200) });
export const REDEEM_BODY: BodySchema = obj({ membershipId: id, benefitId: id, ticketId: id, serviceLineId: id, technicianId: id, reservationRef: str(200), upgradeChargeCents: int });
export const CANCEL_BODY: BodySchema = obj({ membershipId: id, atPeriodEnd: flag, reason: str(1000), expectedVersion: int });
export const PAUSE_BODY: BodySchema = obj({ membershipId: id, resumesAt: str(40), expectedVersion: int });
export const RESUME_BODY: BodySchema = obj({ membershipId: id, expectedVersion: int });
export const REMINDERS_BODY: BodySchema = S.object({ withinDays: numeric });
// ── the internal billing runner (cron / processor bridge; guarded by its own secret) ──
export const BILLING_RUN_BODY: BodySchema = S.object({ limit: numeric, withinDays: numeric });
/** CardPointe's own response fields (respstat / resptext / retref / amount …): kept whole, each a scalar */
const providerResult: BodySchema = S.nullable(S.object({}, [], { additionalProperties: { type: ['string', 'number', 'boolean', 'null'], maxLength: 2000 } }));
export const BILLING_CARDPOINTE_BODY: BodySchema = S.object({ membershipId: id, charge: providerResult, attempt: numeric });
export const BILLING_APPLY_BODY: BodySchema = S.object({ membershipId: id, status: str(32), amountCents: int, processor: str(32), processorRef: str(200), declineReason: str(500), attempt: numeric });
export const BILLING_PRORATION_BODY: BodySchema = S.object({ membershipId: id, newPriceCents: numeric, changeAt: str(40) });
