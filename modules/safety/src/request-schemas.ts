// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the safety module's request-body schemas (Tenant Safety Community,
// its Super Admin moderation console, AI OCR receipts), applied with @Body(ValidatedBody(SCHEMA)). Written from the
// parsers each handler reaches (community-input.ts parseAdvisory / parseIncident / parseReport / parseSettingsUpdate,
// community-moderation.service validatePostAction & co., the interactions service, the OCR service), from the wire types
// in api-contracts (tenant/community.ts, platform/community-moderation.ts) and from pos-web / admin-web
// (posCommunityApi, posAiOcrReceiptApi, superAdminCommunityModerationApi). The parsers keep their rules (lengths after
// trimming, enums, numeric strings) and their own field-named errors; the schema fixes the shape, with types as loose
// as the parsers accept (expectedVersion and booleans may arrive as strings). Unknown fields are stripped — except on
// the two settings routes, whose parsers REFUSE an unknown key today (kept, so they still do).
import { S, type BodySchema } from '@aipowersalon/permissions';

const text = (max: number): BodySchema => S.nullable(S.text(max));
const id: BodySchema = text(64);
/** the parsers' int(): a number or a numeric string */
const intish: BodySchema = { type: ['number', 'string', 'null'], maxLength: 16 };
/** the parsers' bool(): true / false / 'true' / 'false' */
const boolish: BodySchema = { type: ['boolean', 'string', 'null'], maxLength: 5 };
const list = (max: number, len = 64): BodySchema => S.nullable(S.array(S.text(len), { maxItems: max }));
const POST_FORBIDDEN: BodySchema['x-forbidden'] = ['status', 'visibility', 'version', 'originTenantId', 'approvedByUserId', 'verificationLabel'];

// ── Tenant Safety Community (pos-web) ───────────────────────────────────────────────────────────────────────────────
const ADVISORY: Record<string, BodySchema> = {
  category: text(64), severity: text(32), title: text(1000), body: text(20000),
  region: text(200), incidentDate: text(32), scamMethod: text(1000), channels: list(20, 40),
  recommendation: text(8000), tags: list(20, 200), paymentProcessor: text(500), amountRange: text(32),
  officialReference: text(2000), authorDisplay: text(32),
  /** create only — an update that sends it is refused by parseAdvisory (kept declared so it still is) */
  fromIncidentId: id,
};
export const COMMUNITY_ADVISORY_CREATE_BODY: BodySchema = S.object(ADVISORY, [], { 'x-forbidden': POST_FORBIDDEN });
export const COMMUNITY_ADVISORY_UPDATE_BODY: BodySchema = S.object({ ...ADVISORY, expectedVersion: intish, changeNote: text(2000) }, [], { 'x-forbidden': POST_FORBIDDEN });
export const COMMUNITY_RULES_ACK_BODY: BodySchema = S.object({ rulesVersion: text(200) });
export const COMMUNITY_ASSIST_BODY: BodySchema = S.object({ body: text(20000) });
export const COMMUNITY_SUBMIT_BODY: BodySchema = S.object({ expectedVersion: intish, officialReportReferenced: boolish }, [], { 'x-forbidden': POST_FORBIDDEN });
export const COMMUNITY_VERSIONED_BODY: BodySchema = S.object({ expectedVersion: intish }, [], { 'x-forbidden': POST_FORBIDDEN });
export const COMMUNITY_VERSIONED_NOTE_BODY: BodySchema = S.object({ expectedVersion: intish, note: text(4000) }, [], { 'x-forbidden': POST_FORBIDDEN });
export const COMMUNITY_POST_UPDATE_BODY: BodySchema = S.object({ body: text(8000) });
export const COMMUNITY_REPORT_BODY: BodySchema = S.object({ reason: text(64), detail: text(4000) });
export const COMMUNITY_DISPUTE_BODY: BodySchema = S.object({ reason: text(4000), raisedByKind: text(16) });
export const COMMUNITY_APPEAL_BODY: BodySchema = S.object({ subject: text(64), reason: text(8000), commentId: id }, [], { 'x-forbidden': ['status'] });
export const COMMUNITY_INCIDENT_BODY: BodySchema = S.object({ category: text(64), severity: text(32), occurredOn: text(32), rawDetail: text(20000) });
/** parseSettingsUpdate refuses an unknown key itself (400 not_allowed) — so unknown keys are KEPT for it to see (a reviewed §40
 *  open schema: the settings plus the notify / roleGrants / roleRemovals maps, bounded to 4 levels and 2,000 keys + items) */
export const COMMUNITY_SETTINGS_BODY: BodySchema = S.bounded(S.object({
  expectedVersion: intish, enabled: boolish, receptionistApprovalRequired: boolish, managerApprovalRequired: boolish, allowAnonymous: boolish,
  displayName: text(500), authorDisplay: text(32), branchVisibility: text(32), retentionDays: intish, regionPreferences: list(50, 200),
  notify: S.nullable(S.freeObject()), roleGrants: S.nullable(S.freeObject()), roleRemovals: S.nullable(S.freeObject()),
}, [], { additionalProperties: true }), 4, 2000);

// ── community interactions (comments, similar, follows, evidence) ─────────────────────────────────────────────────
export const COMMUNITY_COMMENT_BODY: BodySchema = S.object({ body: text(8000), parentId: id });
export const COMMUNITY_COMMENT_EDIT_BODY: BodySchema = S.object({ body: text(8000), expectedVersion: intish });
export const COMMUNITY_SIMILAR_BODY: BodySchema = S.object({ note: text(4000), occurredOn: text(32) });
export const COMMUNITY_FOLLOW_BODY: BodySchema = S.object({ category: text(64), region: text(200), severityMin: text(32), channels: list(8, 16) });
export const COMMUNITY_EVIDENCE_UPLOAD_BODY: BodySchema = S.object({ postId: id, incidentId: id, mimeType: text(200), sizeBytes: S.nullable(S.number()), sha256: text(128) }, [], { 'x-forbidden': ['uploadStatus', 'scanStatus', 'redactionStatus'] });

// ── Super Admin moderation console (admin-web superAdminCommunityModerationApi) ────────────────────────────────────
const reason = text(4000);
export const MOD_POST_ACTION_BODY: BodySchema = S.object({
  action: text(32), reason, caseId: id, expectedVersion: intish, label: text(64), severity: text(32), targetPostId: id, messageToTenant: text(4000),
  redactions: S.nullable(S.array(S.object({ field: text(64), find: text(1000), replaceWith: { type: ['string', 'number', 'null'], maxLength: 200 } }), { maxItems: 50 })),
});
export const MOD_COMMENT_ACTION_BODY: BodySchema = S.object({ action: text(32), reason, caseId: id, find: text(1000), replaceWith: { type: ['string', 'number', 'null'], maxLength: 200 } });
export const MOD_OPEN_CASE_BODY: BodySchema = S.object({ kind: text(32), reason, priority: text(16), postId: id, commentId: id, targetTenantId: id, incidentId: id });
export const MOD_CASE_UPDATE_BODY: BodySchema = S.object({ assignToMe: S.nullable(S.boolean()), status: text(32), priority: text(16), resolutionNote: text(4000) });
export const MOD_REPORT_RESOLVE_BODY: BodySchema = S.object({ resolution: text(32), reason, caseId: id });
export const MOD_DISPUTE_DECISION_BODY: BodySchema = S.object({ decision: text(32), note: text(4000), caseId: id });
export const MOD_APPEAL_DECISION_BODY: BodySchema = S.object({ decision: text(32), note: text(4000), caseId: id, allowSameDecider: S.nullable(S.boolean()) });
export const MOD_EVIDENCE_REVIEW_BODY: BodySchema = S.object({ decision: text(32), reason, caseId: id });
export const MOD_INCIDENT_ACCESS_BODY: BodySchema = S.object({ caseId: id, reason });
export const MOD_TENANT_ACTION_BODY: BodySchema = S.object({ action: text(32), reason, caseId: id, userId: id, expiresAt: text(40), restrictionId: id, message: text(4000) });
export const MOD_SETTINGS_BODY: BodySchema = S.object({ expectedVersion: intish, riskMatchingEnabled: S.nullable(S.boolean()), autoHideReportThreshold: S.nullable(S.number()), reason });

// ── AI OCR receipts (pos-web posAiOcrReceiptApi) ───────────────────────────────────────────────────────────────────
/** the file bytes: a JSON number[] or a serialised Uint8Array ({ "0": …, "1": … }); the service sniffs and sizes them */
const fileBytes: BodySchema = { anyOf: [{ type: 'array', maxItems: 26_214_400 }, S.freeObject()] };
export const OCR_UPLOAD_BODY: BodySchema = S.object({
  filename: text(500), mimeType: text(200), sizeBytes: S.nullable(S.number()), bytes: S.nullable(fileBytes),
  headerBytes: S.nullable(S.array(S.number(), { maxItems: 4096 })), pageCount: S.nullable(S.number()), width: S.nullable(S.number()), height: S.nullable(S.number()),
  // Oct 27 2026: §12 the channel the caller is; §17/§18 hold the automatic extraction until the pages are appended
  source: S.nullable(S.enumOf(['pos_upload', 'owner_app_upload', 'mobile_camera', 'web_upload', 'api_import'])), deferExtraction: S.nullable(S.boolean()),
}, [], { 'x-forbidden': ['pipelineState', 'status'] });
/** §17: one more page of an existing document — the same file shape as an upload */
export const OCR_PAGE_BODY: BodySchema = S.object({
  filename: text(500), mimeType: text(200), sizeBytes: S.nullable(S.number()), bytes: S.nullable(fileBytes),
  headerBytes: S.nullable(S.array(S.number(), { maxItems: 4096 })), width: S.nullable(S.number()), height: S.nullable(S.number()),
}, [], { 'x-forbidden': ['pipelineState', 'status', 'pageNumber'] });
export const OCR_CORRECT_FIELD_BODY: BodySchema = S.object({ field: text(64), value: { type: ['string', 'number', 'null'], maxLength: 2000 }, valueCents: S.nullable(S.number()), confirmOnly: S.nullable(S.boolean()) });
export const OCR_DECISION_BODY: BodySchema = S.object({ reason: text(4000) }, [], { 'x-forbidden': ['status', 'pipelineState'] });
export const OCR_POST_BODY: BodySchema = S.object({ destination: text(32) });
export const OCR_SETTINGS_BODY: BodySchema = S.object({ level: text(16), branchId: id, enabled: S.nullable(S.boolean()), config: S.nullable(S.freeObject()) });
