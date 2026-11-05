// request-schemas-audit.ts — BUILD_PLAN Phase 12 (#17): super-admin alerts + audit-log routes (legal holds,
// investigations, evidence exports, tamper controls, export flags, retention). Clients: admin-web superAdminApi.ts
// (alerts) and superAdminAuditLogsApi.ts; fields from the services (audit-*.service.ts) that read the body.
import { id, ids, numish, obj, str, type BodySchema } from './request-schemas-fields';

export const ALERT_NOTE_BODY: BodySchema = obj({ note: str(5000) });
export const ALERT_STATUS_BODY: BodySchema = obj({ status: str(30) });
export const AL_PLACE_HOLD_BODY: BodySchema = obj({ scopeType: str(40), scopeValue: str(500), reason: str(2000), legalAuthority: str(500), reviewDate: str(40), expirationDate: str(40) });
export const AL_RELEASE_HOLD_BODY: BodySchema = obj({ reason: str(2000) });
export const AL_OPEN_INVESTIGATION_BODY: BodySchema = obj({ title: str(300), severity: str(20), tenantId: id, assignee: str(254), description: str(10000), eventRefs: ids(500) });
export const AL_LINK_EVENT_BODY: BodySchema = obj({ eventRef: str(200) });
export const AL_INVESTIGATION_NOTE_BODY: BodySchema = obj({ note: str(10000) });
export const AL_INVESTIGATION_STATUS_BODY: BodySchema = obj({ status: str(30), reason: str(2000) });
export const AL_EXPORT_EVIDENCE_BODY: BodySchema = obj({ tenantId: id });
export const AL_TAMPER_CONTROL_BODY: BodySchema = obj({ controlKey: str(100), value: str(2000), status: str(30), detail: str(2000) });
export const AL_REVIEW_FLAG_BODY: BodySchema = obj({ status: str(30), note: str(2000) });
export const AL_RETENTION_POLICY_BODY: BodySchema = obj({ category: str(100), hotDays: numish, archiveDays: numish, reason: str(2000) });
