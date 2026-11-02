// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the request-body schemas of the platform module's mutating routes
// (Super Admin → Plans & Feature Limits, the feature registry, platform approvals, automation rules), applied with
// @Body(ValidatedBody(SCHEMA)). Each was written from the handler / the pure normalizer it calls (plan-mutations-core,
// overage-core, entitlements.service, automation-actions.service — which keep their own range / enum / uniqueness
// rules) AND from every client that calls the route today (admin-web superAdminPlansApi, superAdminAutomationApi,
// FeatureRegistryScreen, ApprovalsScreen) — so every body sent today still passes. Unknown fields are stripped;
// tenantId / permissions / platformRole sent where undeclared are refused.
//
// The normalizers already refuse wrong types with a precise 400; the schema adds the declared shape, the length bounds
// and the field-level VALIDATION_FAILED envelope in front of them. Where a normalizer is deliberately lenient (a
// limitValue of 'unlimited', a strategy string checked by the service) the schema stays as lenient.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => ({ type: ['string', 'null'], maxLength: max });
const int = (o: Omit<BodySchema, 'type'> = {}): BodySchema => ({ type: ['integer', 'null'], ...o });
/** a limit value: a non-negative integer, null (= unlimited) or the literal 'unlimited' */
const limitValue: BodySchema = { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }, { enum: ['unlimited'] }] };
const dateish: BodySchema = { type: ['string', 'null'], maxLength: 40 };
const reason = (max = 2000): BodySchema => ({ type: ['string', 'null'], maxLength: max });

// ── plans (plans.controller.ts → plan-mutations-core) ──────────────────────────────────────────────────────────────
/** POST /super-admin/plans — CreatePlanBody (admin-web) */
export const CREATE_PLAN_BODY: BodySchema = S.object({
  code: str(40), name: str(80), subtitle: str(80), description: str(1000), planType: str(40), status: str(40),
  monthlyPriceCents: int(), annualPriceCents: int(), setupFeeCents: int(), currency: str(8), billingInterval: str(16),
  isRecommended: { type: ['boolean', 'null'] }, isPublic: { type: ['boolean', 'null'] }, displayOrder: int(),
  limits: S.nullable({ type: 'object', additionalProperties: { anyOf: [{ type: 'integer' }, { type: 'null' }] } }),
  features: S.nullable(S.array(S.object({ featureKey: str(60), state: str(20) }), { maxItems: 500 })),
});
/** PATCH /super-admin/plans/:id — details only; the pricing fields are DECLARED so the normalizer's precise "use the
 *  pricing-change workflow" 400 still answers a client that sends them (they are not stripped silently). */
export const UPDATE_PLAN_BODY: BodySchema = S.object({
  name: str(80), subtitle: str(80), description: str(1000), planType: str(40), status: str(40),
  isRecommended: { type: ['boolean', 'null'] }, isPublic: { type: ['boolean', 'null'] }, displayOrder: int(),
  monthlyPriceCents: S.any(), annualPriceCents: S.any(), setupFeeCents: S.any(),
});
/** POST /super-admin/plans/:id/pricing — ChangePricingBody */
export const PLAN_PRICING_BODY: BodySchema = S.object({
  monthlyPriceCents: int(), annualPriceCents: int(), reason: reason(500), confirm: { type: ['boolean', 'null'] }, effectiveFrom: dateish,
});
const LIMIT_CHANGE = S.object({
  metric: str(60), limitValue, enforcement: str(10), overageAllowed: { type: ['boolean', 'null'] }, overagePriceCents: int(),
});
/** PUT /super-admin/plans/:id/limits — { reason, changes[] } */
export const PLAN_LIMITS_BODY: BodySchema = S.object({ reason: reason(500), changes: S.nullable(S.array(LIMIT_CHANGE, { maxItems: 50 })) });

// ── tenant entitlements (entitlements.controller.ts → entitlements.service) ────────────────────────────────────────
/** PUT /super-admin/plans/tenants/:tenantId/limits — one override (or { clear: true }); approvalReason when the
 *  two-person policy is on */
export const TENANT_LIMIT_BODY: BodySchema = S.object({
  metric: str(60), limitValue, enforcement: str(10), reason: reason(500), approvalReason: reason(500), clear: { type: ['boolean', 'null'] }, expiresAt: dateish,
});
/** PUT /super-admin/plans/tenants/:tenantId/features — { featureKey, state: enabled|disabled|clear, reason } */
export const TENANT_FEATURE_BODY: BodySchema = S.object({ featureKey: str(80), state: str(20), reason: reason(500) });
/** POST /super-admin/plans/tenants/:tenantId/usage — { metric, amount, period? (YYYY-MM) } */
export const TENANT_USAGE_BODY: BodySchema = S.object({ metric: str(60), amount: int(), period: str(7) });

// ── subscription change + offers (subscription-change / tenant-offers controllers) ─────────────────────────────────
/** POST …/subscription/preview — { toPlanCode, strategy } */
export const SUBSCRIPTION_PREVIEW_BODY: BodySchema = S.object({ toPlanCode: str(40), strategy: str(40) });
/** POST …/subscription/change — { toPlanCode, strategy, reason } */
export const SUBSCRIPTION_CHANGE_BODY: BodySchema = S.object({ toPlanCode: str(40), strategy: str(40), reason: reason(1000) });
/** POST …/offers/add-ons — { addOnCode, quantity?, priceCents? } */
export const ADD_ON_BODY: BodySchema = S.object({ addOnCode: str(60), quantity: int({ minimum: 0 }), priceCents: int({ minimum: 0 }) });
/** POST …/offers/add-ons/cancel — { addOnCode } */
export const ADD_ON_CANCEL_BODY: BodySchema = S.object({ addOnCode: str(60) });
/** POST …/offers/trials — { trialCode } */
export const TRIAL_BODY: BodySchema = S.object({ trialCode: str(60) });
/** POST …/offers/promotions — { promoCode } */
export const PROMOTION_BODY: BodySchema = S.object({ promoCode: str(60) });

// ── grandfathering + overage ──────────────────────────────────────────────────────────────────────────────────────
/** POST /super-admin/plans/grandfathered — the target tenantId IS this platform route's payload (declared) */
export const GRANDFATHER_BODY: BodySchema = S.object({
  tenantId: str(64), planVersionId: str(64), lockedMonthlyPriceCents: int(), migrationTargetPlanCode: str(40),
  effectiveFrom: dateish, endDate: dateish, reason: reason(500),
});
/** PUT /super-admin/plans/overage/rules — { reason, changes: [{ metric, unitPriceCents, graceAmount?, warningThresholdPct? }] } */
export const OVERAGE_RULES_BODY: BodySchema = S.object({
  reason: reason(500),
  changes: S.nullable(S.array(S.object({ metric: str(60), unitPriceCents: int(), graceAmount: int(), warningThresholdPct: int() }), { maxItems: 50 })),
});

// ── feature registry + approvals ─────────────────────────────────────────────────────────────────────────────────
/** PATCH /super-admin/features/:key — { status, reason } (FeatureRegistryScreen); the registry checks the vocabulary */
export const FEATURE_STATUS_BODY: BodySchema = S.object({ status: str(40), reason: reason(1000) });
/** POST /super-admin/approvals/:id/approve — {} or { note } */
export const APPROVAL_DECISION_BODY: BodySchema = S.object({ note: reason(2000) });
/** POST /super-admin/approvals/policies/:action — { required, reason } */
export const APPROVAL_POLICY_BODY: BodySchema = S.object({ required: { type: ['boolean', 'null'] }, reason: reason(2000) });

// ── automation rules (automation-actions.service — the trigger / action allowlists stay there) ────────────────────
const CONDITIONS: BodySchema = S.nullable(S.freeObject());
const ACTIONS: BodySchema = S.nullable(S.array(S.object({ type: str(80), config: S.any() }), { maxItems: 50 }));
/** POST /super-admin/automation-rules/rules — the rule's scope tenant / branch IS the payload (declared) */
export const AUTOMATION_RULE_BODY: BodySchema = S.object({
  name: str(160), description: reason(2000), ruleType: str(40), triggerId: str(80), conditions: CONDITIONS, actions: ACTIONS,
  scopeKind: str(20), tenantId: str(64), branchId: str(64), timeoutMs: { type: ['integer', 'number', 'string', 'null'], maxLength: 12 }, cooldownSeconds: { type: ['integer', 'number', 'string', 'null'], maxLength: 12 },
});
/** POST /super-admin/automation-rules/test and rules/:id/test — a dry run */
export const AUTOMATION_TEST_BODY: BodySchema = S.object({ triggerId: str(80), conditions: CONDITIONS, actions: ACTIONS, context: S.nullable(S.freeObject()) });
/** POST /super-admin/automation-rules/rules/:id/status — { to, reason? } */
export const AUTOMATION_STATUS_BODY: BodySchema = S.object({ to: str(20), reason: reason(2000) });
/** POST /super-admin/automation-rules/exceptions — the exception's tenant IS the payload (declared) */
export const AUTOMATION_EXCEPTION_BODY: BodySchema = S.object({
  ruleId: str(64), tenantId: str(64), branchId: str(64), exceptionType: str(60), overrideValue: str(200), notes: reason(2000), reason: reason(2000),
});
