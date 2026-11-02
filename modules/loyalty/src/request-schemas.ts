// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the loyalty module's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). From the controller's rewardBody (the fields read) and pos-web posLoyaltyApi
// (RewardInput, the api-contracts wire type). Unknown fields are stripped; tenantId / permissions are refused.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
/** the service range-checks these numbers (pointsCost ≥ 1, percent 1..100 …) */
const num: BodySchema = S.nullable(S.number());
export const REWARD_BODY: BodySchema = S.object({
  title: str(200), description: str(2000), pointsCost: num, rewardType: str(32), valueCents: num, percent: num, validDays: num, active: S.nullable(S.boolean()),
});

// ── Global Loyalty & Rewards Network (LoyaltyTokens.pdf v1.0 + LoyaltyRules.pdf v2.0) ───────────────────────────────
// The repository validates every value against the platform limits; these only shape the body. tenantId / walletId /
// ruleVersionId are never accepted from a client (addendum §2.2: server-resolved identity only).
const bool: BodySchema = S.nullable(S.boolean());
const RATE = { spendIncrementCents: num, pointTenthsPerIncrement: num, minEligibleCents: num, perTicketCapTenths: num, roundingMode: str(32) };
export const GR_PREVIEW_BODY: BodySchema = S.object(RATE);
export const GR_DRAFT_BODY: BodySchema = S.object({ ...RATE, draftId: str(40), expectedVersion: num });
export const GR_ACTIVATE_BODY: BodySchema = S.object({ ...RATE, draftId: str(40), effectiveFrom: str(40), reason: str(500) });
export const GR_USE_GLOBAL_BODY: BodySchema = S.object({ effectiveFrom: str(40), reason: str(500), confirm: bool });
export const GR_BUY_TOKENS_BODY: BodySchema = S.object({ tokens: num });
export const GR_EMPTY_BODY: BodySchema = S.object({});
// Super Admin
export const GR_GLOBAL_RULE_BODY: BodySchema = S.object({ spendIncrementCents: num, pointTenthsPerIncrement: num, minEligibleCents: num, perTicketCapTenths: num, effectiveFrom: str(40), reason: str(500) });
export const GR_PROGRAM_BODY: BodySchema = S.object({
  expectedVersion: num, earn_paused: bool, redeem_paused: bool, purchases_paused: bool, reimbursements_paused: bool,
  custom_min_spend_increment_cents: num, custom_max_spend_increment_cents: num, custom_max_point_tenths_per_increment: num, custom_min_eligible_floor_cents: num,
  max_point_tenths_per_ticket: num, low_balance_cents: num, critical_balance_cents: num, reservation_ttl_seconds: num, max_purchase_tokens: num,
});
export const GR_ENROLLMENT_BODY: BodySchema = S.object({ status: str(20), earningSuspended: bool, purchasingSuspended: bool, reason: str(500) });
export const GR_SANDBOX_ADVANCE_BODY: BodySchema = S.object({ status: str(40) });
// Final Completion guide §05–§09 (Super Admin): a review needs a reason; payout actions carry no amount (the server owns it)
export const GR_REVIEW_BODY: BodySchema = S.object({ to: str(20), note: str(1000) });
export const GR_PAYABLE_HOLD_BODY: BodySchema = S.object({ reason: str(500) });
// Customer App opt-in / withdrawal (Final Completion guide §10)
export const GR_OPT_IN_BODY: BodySchema = S.object({ termsVersion: str(40), accept: bool });
export const GR_WITHDRAW_BODY: BodySchema = S.object({ reason: str(300) });
