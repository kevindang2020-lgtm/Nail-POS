// request-schemas-ai.ts — BUILD_PLAN Phase 12 (#17): super-admin AI routes (packages, plans, insights, AI reports,
// scheduling optimizer, AI usage config) + the tenant AI trial route. Clients: admin-web superAdminAiApi.ts /
// superAdminApi.ts (AiSubscriptionsScreen), pos-web posAiUsageApi.ts, owner-web ownerApi.ts. The AI-report and
// optimizer routes have no UI caller today (ops / automation) — their schemas follow the handler + the core validators.
import { S, blob, bool, flag, id, ids, num, obj, scalar, str, type BodySchema } from './request-schemas-fields';

const period: BodySchema = str(20);
// /super-admin/ai/tenants/:tenantId/subscriptions — normalizeAssign / normalizeUpdate (ai-admin-core.ts)
export const AI_SUB_ASSIGN_BODY: BodySchema = obj({ packageCode: str(80), status: str(20), trial: flag, billingPeriod: period, priceCents: num, usageLimit: num, trialDays: num, overageEnabled: flag });
export const AI_SUB_UPDATE_BODY: BodySchema = obj({ status: str(20), usageLimit: num, overageEnabled: flag, billingPeriod: period, priceCents: num });
// /super-admin/ai-plans
export const AI_PLAN_ASSIGN_BODY: BodySchema = obj({ tenantId: scalar(64), trial: flag, billingPeriod: period });
export const AI_PLAN_CONVERT_BODY: BodySchema = obj({ tenantId: scalar(64), billingPeriod: period });
export const AI_PLAN_UPDATE_BODY: BodySchema = obj({ priceCentsOverride: { type: ['number', 'string', 'null'], maxLength: 16 }, discountType: str(10), discountValue: { type: ['number', 'string', 'null'], maxLength: 16 }, active: flag, annualMonths: { type: ['number', 'string', 'null'], maxLength: 4 } });
export const AI_PLAN_UNASSIGN_BODY: BodySchema = obj({ tenantId: scalar(64) });
// /super-admin/ai-insights
export const AI_INSIGHTS_IDS_BODY: BodySchema = obj({ ids: ids(1000) });
export const AI_INSIGHTS_ASSIGN_BODY: BodySchema = obj({ ids: ids(1000), assignedToUserId: id });
export const AI_INSIGHT_DISMISS_BODY: BodySchema = obj({ reason: str(2000) });
export const AI_INSIGHT_FEEDBACK_BODY: BodySchema = obj({ verdict: str(20), comment: str(2000) });
// AI reports (no UI caller: ops) — report-template-core / report-delivery-core shapes
export const AI_NARRATIVE_MODEL_BODY: BodySchema = obj({ modelName: str(200), promptVersion: str(100), promptText: str(50000), notes: str(5000) });
export const AI_NARRATIVE_COMMIT_BODY: BodySchema = obj({ modelName: str(200) });
const recipient: BodySchema = obj({ id: scalar(254), type: str(40), tenantId: id, isPlatform: flag, active: flag, suppressed: flag, external: flag });
export const AI_REPORT_DELIVER_BODY: BodySchema = obj({ recipients: S.nullable(S.array(recipient, { maxItems: 500 })), allowExternal: flag, channel: str(20) });
export const AI_REPORT_GENERATE_BODY: BodySchema = obj({ reportKey: str(100), scopeType: str(20), tenantId: id, branchId: id, start: str(40), end: str(40), source: str(40) });
export const AI_REPORT_SCHEDULE_BODY: BodySchema = obj({ name: str(200), reportKey: str(100), frequency: str(20), runAtTime: str(10), timezone: str(64), scopeType: str(20), tenantId: id, branchId: id, owner: str(200) });
const section: BodySchema = obj({ id: scalar(100), title: scalar(300), metricKeys: S.nullable(S.array({ type: ['string', 'number'], maxLength: 200 }, { maxItems: 200 })), text: str(10000) });
export const AI_REPORT_TEMPLATE_BODY: BodySchema = obj({ reportKey: str(100), name: str(200), sections: S.nullable(S.array(section, { maxItems: 100 })) });
// AI scheduling optimizer (SaSchedActionRequest / SaSchedPlatformSwitch in api-contracts)
export const AI_SCHED_ACTION_BODY: BodySchema = obj({ reason: str(2000) });
export const AI_SCHED_SWITCH_BODY: BodySchema = obj({ killed: flag, reason: str(2000) });
// AI usage config — the provider apiKey is a secret the service encrypts; never echoed back
export const AI_PROVIDER_BODY: BodySchema = obj({ providerKey: str(80), displayName: str(200), apiKey: str(4096), defaultModel: str(200), status: str(20) });
export const AI_PROVIDER_STATUS_BODY: BodySchema = obj({ providerKey: str(80), status: str(20) });
export const AI_PROMPT_BODY: BodySchema = obj({ promptKey: str(120), name: str(200), body: str(50000), status: str(20) });
// /tenant/ai/subscriptions (pos-web + owner-web: start a trial)
export const TENANT_AI_TRIAL_BODY: BodySchema = obj({ packageCode: scalar(80) });
// AI Usage & Limits Complete Build Guide (Oct 30 2026): /tenant/ai/usage-screen/packages/:code/{trial,cancel} and the
// Super Admin global availability switch /super-admin/ai/packages/:code/availability
export const AI_USAGE_TRIAL_BODY: BodySchema = S.object({ idempotencyKey: S.text(100), confirm: S.boolean() }, ['idempotencyKey', 'confirm']);
export const AI_USAGE_CANCEL_BODY: BodySchema = S.object({ idempotencyKey: S.text(100), confirm: S.boolean(), expectedStatus: str(20) }, ['idempotencyKey', 'confirm']);
export const AI_PACKAGE_AVAILABILITY_BODY: BodySchema = S.object({ enabled: S.boolean(), reason: str(300), expectedVersion: S.integer() }, ['enabled', 'expectedVersion']);
// Four-Module Completion Guide (Oct 30 2026): Setup Health run + platform release evidence
/** Run Health Check is salon-wide (every authorized branch's rows are refreshed); the screen's branch is a view filter */
export const SETUP_HEALTH_RUN_BODY: BodySchema = S.object({});
export const RELEASE_EVIDENCE_BODY: BodySchema = S.object({ kind: S.text(30), appVersion: S.text(40), commitSha: str(64), reference: S.text(300), outcome: S.text(10), summary: str(2000) }, ['kind', 'appVersion', 'reference', 'outcome']);
// Four-Module Completion Guide (Oct 30 2026): AI-02 branch operational override (settings validated per package by
// validateBranchSettings — booleans only) and AI-01 read-only invoice reconciliation (never charges).
export const AI_BRANCH_SETTING_BODY: BodySchema = S.object({ overrideEnabled: bool, settings: blob, expectedVersion: S.integer({ minimum: 0 }), reason: str(300) }, ['overrideEnabled', 'expectedVersion']);
export const AI_INVOICE_RECONCILE_BODY: BodySchema = S.object({ idempotencyKey: S.text(100) }, ['idempotencyKey']);
