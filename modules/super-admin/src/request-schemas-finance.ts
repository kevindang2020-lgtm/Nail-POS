// request-schemas-finance.ts — BUILD_PLAN Phase 12 (#17): super-admin revenue & residuals (agreements, versions,
// residual statements, partner payouts, tenant incentives, adjustments, accounting periods, export jobs) and the
// security console (privileged access, incidents, IP blocks, lockdowns, policies, retention rules, session revoke).
// Clients: admin-web superAdminRevenueResidualsApi.ts and superAdminApi.ts (security*); fields from the handlers and
// super-admin-revenue-residuals.service.ts / policy-core.ts. Money is integer cents (numeric strings are Number()-ed by
// the service where the handler passes them through); a client never sets an adjustment's / payout's status.
import { S, centsish, flag, id, money, num, numish, obj, str, type BodySchema } from './request-schemas-fields';

// ── revenue & residuals ────────────────────────────────────────────────────────────────────────────────────────────
const pct: BodySchema = numish;
const version = { aiPct: pct, processorPct: pct, salonPct: pct, effectiveDate: str(40), expirationDate: str(40), currency: str(3), roundingPolicy: str(30), refundAllocation: str(30), changeReason: str(2000) };
/** a new agreement — `status` is the agreement's draft / active state an operator chooses (validated by the service) */
export const RR_AGREEMENT_BODY: BodySchema = obj({ ...version, name: str(200), agreementType: str(40), tenantId: id, branchId: id, processor: str(60), revenueSource: str(60), minimumVolumeCents: centsish, maximumVolumeCents: centsish, status: str(20) });
export const RR_VERSION_BODY: BodySchema = obj(version);
const stmtLine: BodySchema = obj({ merchantAccount: str(64), tenantId: id, grossVolumeCents: centsish, eligibleRevenueCents: centsish, residualCents: centsish, note: str(2000) });
const costLine: BodySchema = obj({ category: str(60), amountCents: centsish, note: str(2000) });
export const RR_IMPORT_STATEMENT_BODY: BodySchema = money({
  processor: str(60), statementRef: str(200), merchantAccount: str(64), tenantId: id, branchId: id, periodStart: str(40), periodEnd: str(40), currency: str(3),
  transactionVolumeCents: centsish, eligibleRevenueCents: centsish, processingResidualCents: centsish, feesCents: centsish, refundsCents: centsish,
  chargebacksCents: centsish, adjustmentsCents: centsish, processorCalculatedCents: centsish, applicableCostsCents: centsish, sourceFile: str(300),
  lines: S.nullable(S.array(stmtLine, { maxItems: 50000 })), costLines: S.nullable(S.array(costLine, { maxItems: 500 })),
  eligibilityOverrides: S.nullable({ type: 'object', additionalProperties: flag }),
});
/** a statement's REVIEW status (reviewed / disputed …) — the import status is the service's */
export const RR_REVIEW_STATEMENT_BODY: BodySchema = obj({ status: str(30), notes: str(5000) });
export const RR_NOTES_BODY: BodySchema = obj({ notes: str(5000) });
export const RR_PARTNER_PAYOUT_BODY: BodySchema = money({ agreementId: id, periodStart: str(40), periodEnd: str(40), priorBalanceCents: num });
export const RR_TENANT_INCENTIVE_BODY: BodySchema = money({ agreementId: id, tenantId: id, periodStart: str(40), periodEnd: str(40), priorUnpaidBalanceCents: num });
export const RR_ADJUSTMENT_BODY: BodySchema = money({ revenueRecordId: id, agreementId: id, accountingPeriodId: id, tenantId: id, branchId: id, processor: str(60), adjustmentType: str(40), amountCents: num, reason: str(2000), supportingEvidence: str(5000) });
export const RR_REASON_BODY: BodySchema = obj({ reason: str(2000) });
export const RR_PERIOD_BODY: BodySchema = obj({ name: str(200), startDate: str(40), endDate: str(40), currency: str(3) });
/** an export job's filters — `status` filters the exported rows */
export const RR_EXPORT_JOB_BODY: BodySchema = obj({ dataset: str(30), format: str(10), q: str(200), agreementId: id, tenantId: id, branchId: id, processor: str(60), startDate: str(40), endDate: str(40), revenueType: str(40), status: str(30) });

// ── security console ───────────────────────────────────────────────────────────────────────────────────────────────
export const SEC_GRANT_REQUEST_BODY: BodySchema = obj({ userId: id, privilege: str(80), scope: str(40), target: str(200), reason: str(2000), expiresAt: str(40) });
export const SEC_REASON_BODY: BodySchema = obj({ reason: str(2000) });
export const SEC_INCIDENT_BODY: BodySchema = obj({ title: str(300), description: str(10000), category: str(60), severity: str(20), detectionSource: str(60), tenantId: id, branchId: id, assignedTo: id, correlationId: str(200) });
export const SEC_INCIDENT_TRANSITION_BODY: BodySchema = obj({ toStatus: str(30), reason: str(2000) });
export const SEC_IP_PREVIEW_BODY: BodySchema = obj({ target: str(100) });
export const SEC_IP_BLOCK_BODY: BodySchema = obj({ target: str(100), threatType: str(60), source: str(60), reason: str(2000), country: str(4), tenantId: id, expiresAt: str(40) });
export const SEC_IP_ALLOW_BODY: BodySchema = obj({ target: str(100), reason: str(2000) });
export const SEC_LOCKDOWN_PROPOSE_BODY: BodySchema = obj({ scope: str(30), target: str(200), reason: str(2000) });
export const SEC_LOCKDOWN_CONFIRM_BODY: BodySchema = obj({ confirmationPhrase: str(200), stepUpVerified: flag });
/** a security policy document (mfa / password / session) — stored whole as the new policy version; validatePolicy()
 *  checks the keys it knows. Sent flat or as `{ config }`. */
const policyValue: BodySchema = { type: ['string', 'number', 'boolean', 'null', 'array'], maxLength: 200, maxItems: 50 };
export const SEC_POLICY_BODY: BodySchema = { type: 'object', properties: { config: S.nullable({ type: 'object', additionalProperties: policyValue }) }, additionalProperties: policyValue };
export const SEC_RETENTION_RULE_BODY: BodySchema = obj({ retentionDays: numish, action: str(30) });
export const SEC_SESSION_REVOKE_BODY: BodySchema = obj({ scope: str(30), target: str(200), reason: str(2000), currentSessionId: id, includeCurrent: flag });
