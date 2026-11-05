// request-schemas-workforce.ts — BUILD_PLAN Phase 12 (#17): super-admin smart reminders, global technician admin,
// workforce oversight (access support, deactivation, duplicates, transfers, payroll sync, security review, saved
// views) and the support center. Clients: admin-web superAdminSmartRemindersApi.ts, superAdminTechniciansApi.ts,
// superAdminStaffApi.ts, superAdminSupportApi.ts; fields from the *-core.ts validators each service runs.
import { S, flag, id, ids, numish, obj, scalar, str, strs, type BodySchema } from './request-schemas-fields';

// ── smart reminders ────────────────────────────────────────────────────────────────────────────────────────────────
const content = { sms: str(2000), emailSubject: str(300), emailBody: str(50000), pushTitle: str(200), pushBody: str(1000) };
export const SR_TEMPLATE_BODY: BodySchema = obj({ ...content, name: str(200), reminderType: str(60), tenantId: id });
export const SR_TEMPLATE_VERSION_BODY: BodySchema = obj(content);
export const SR_PREVIEW_BODY: BodySchema = obj({ sms: str(2000), emailBody: str(50000), pushBody: str(1000), values: S.nullable({ type: 'object', additionalProperties: { type: ['string', 'number', 'null'], maxLength: 2000 } }) });
export const SR_TIMING_BODY: BodySchema = obj({ reminderType: str(60), direction: str(10), offsetMinutes: numish, minOffsetMinutes: numish, maxOffsetMinutes: numish, quietHoursStart: numish, quietHoursEnd: numish, quietHoursPolicy: str(30), timezoneSource: str(30), enabled: flag, tenantId: id });
export const SR_OVERRIDE_BODY: BodySchema = obj({ reminderType: str(60), enabled: flag, direction: str(10), offsetMinutes: numish, channels: strs(20, 10), quietHoursPolicy: str(30), approvalState: str(20) });
/** a flow's kill state — `status` is the flow state the operator sets (disabled / paused), not a money row */
export const SR_FLOW_DISABLE_BODY: BodySchema = obj({ reminderType: str(60), reason: str(2000), status: str(20), tenantId: id });
export const SR_FLOW_ENABLE_BODY: BodySchema = obj({ reminderType: str(60), tenantId: id });
export const SR_CHANNELS_BODY: BodySchema = obj({ reminderType: str(60), primaryChannel: str(20), fallbackChannels: strs(20, 10), fallbackOn: str(30), maxFallbackAttempts: numish, stopOnSuccess: flag, recheckSuppression: flag, recheckQuietHours: flag, tenantId: id });
export const SR_PREVIEW_FALLBACK_BODY: BodySchema = obj({ primaryChannel: str(20), fallbackChannels: strs(20, 10), attempts: S.nullable(S.array(S.freeObject(), { maxItems: 20 })) });
export const SR_PLAN_FEATURE_BODY: BodySchema = obj({ planCode: str(60), featureKey: str(100), state: str(20) });
export const SR_EXPORT_BODY: BodySchema = obj({ dataset: str(60), tenantId: id });
// ── global technician admin ────────────────────────────────────────────────────────────────────────────────────────
export const TECH_REASON_BODY: BodySchema = obj({ reason: scalar(2000) });
export const TECH_PAUSE_BODY: BodySchema = obj({ reason: scalar(2000), expiresAt: str(40) });
export const TECH_SCOPED_PAUSE_BODY: BodySchema = obj({ scope: str(20), paused: flag, reason: str(2000) });
export const TECH_DELETE_REQUEST_BODY: BodySchema = obj({ reason: str(2000), requesterKind: str(30), legalHold: flag });
export const TECH_DELETE_DECISION_BODY: BodySchema = obj({ decision: str(10), note: str(2000) });
export const TECH_MERGE_BODY: BodySchema = obj({ duplicateId: scalar(128), reason: scalar(2000) });
// ── workforce oversight ────────────────────────────────────────────────────────────────────────────────────────────
export const WF_ACCESS_SUPPORT_BODY: BodySchema = obj({ action: str(40), reason: str(2000) });
export const WF_REASON_BODY: BodySchema = obj({ reason: str(2000) });
export const WF_DUPLICATE_REVIEW_BODY: BodySchema = obj({ canonicalId: id, memberIds: ids(200), reason: str(2000) });
export const WF_TRANSFER_BODY: BodySchema = obj({ toBranchId: id, reason: str(2000) });
export const WF_DECISION_BODY: BodySchema = obj({ decision: str(10), note: str(2000) });
/** a cross-salon transfer: toTenantId is the destination salon (declared; the service checks the Super Admin's scope) */
export const WF_CROSS_TRANSFER_BODY: BodySchema = obj({ toTenantId: id, toBranchId: id, effectiveDate: str(40), reason: str(2000) });
export const WF_SECURITY_REVIEW_BODY: BodySchema = obj({ alertKey: str(200), resolution: str(30), reason: str(2000) });
export const WF_SAVED_VIEW_BODY: BodySchema = obj({ name: str(120), isDefault: flag, filters: S.nullable(obj({ role: str(40), status: str(30), tenantId: id, search: str(200), sort: str(40), dir: str(4), pageSize: numish })) });
// ── support center ─────────────────────────────────────────────────────────────────────────────────────────────────
export const SUP_TICKET_BODY: BodySchema = obj({ tenantId: id, branchId: id, subject: str(300), description: str(20000), category: str(60), subcategory: str(60), priority: str(20) });
export const SUP_BODY_BODY: BodySchema = obj({ body: scalar(20000) });
export const SUP_STATUS_BODY: BodySchema = obj({ to: scalar(30), note: str(2000) });
